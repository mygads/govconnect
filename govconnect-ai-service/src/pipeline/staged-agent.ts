/**
 * Staged Agent — ONE bounded single-agent loop per turn.
 *
 * Design (arsitektur-final §2, §4):
 * - Single staged agent, not a swarm. The stage decides which tools exist;
 *   the agent only decides HOW to use them within the stage.
 * - Bounded: max iterations, total turn timeout, per-tool timeout (gateway).
 * - Deterministic stages (EMERGENCY, greeting) never touch the LLM.
 * - Mutations (EXECUTE) never run on LLM say-so: they go through the
 *   deterministic stage-runner path with explicit confirmation.
 * - Output passes the per-claim verifier + PII outbound gate + the
 *   never-empty guarantee before it leaves.
 */

import { callAIGatewayPrompt, type GatewayChatMessage, type GatewayPromptResult } from '../services/ai-gateway.service';
import { AGENT_TOOLS, type AgentToolName } from '../services/agent/tool-definitions';
import type { ToolCallResult } from '../services/agent/tool-executor';
import { gatewayExecute, type GatewayContext } from '../gateway/tool-gateway';
import {
  INTENT_SLOT_KEY, nextMissingSlot, isCollectComplete, renderVerifySummary,
  isCancellation, isCorrectionRequest,
  buildPendingMutation, type SlotIntent, type Slots,
} from './slot-fsm';
import { isPendingMutation, type PendingMutation } from './confirmation';
import { verifyAnswerClaims } from './claim-verifier';
import {
  precedenceOf, assertTenant, detectPrecedenceConflict,
  PRECEDENCE_LABEL, type EvidenceEntry,
} from './kb-precedence';
import { STAGE_TOOL_ALLOWLIST, isParallelizable } from '../gateway/tool-policy';
import { piiInbound, piiOutbound, redactForLog } from '../gateway/pii-gateway';
import { identityDenialCopy } from './identity-ladder';
import { buildPrompt } from './prompt-builder';
import { buildFallback, persistFallbackTicket, assertNonEmptyResponse } from './fallback-policy';
import {
  createPipelineContext, remainingMs,
  type PipelineContext, type Stage, type StageDecision, type ToolTraceEntry, type TurnResult,
} from './stage-types';
import logger from '../utils/logger';

const MAX_AGENT_ITERATIONS = Number(process.env.STAGED_AGENT_MAX_ITERATIONS ?? 3);

interface ParsedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

function parseToolCalls(message: GatewayPromptResult['message']): ParsedToolCall[] {
  const raw = message?.tool_calls as Array<{
    id?: string; type?: string;
    function?: { name?: string; arguments?: string };
  }> | undefined;
  if (!Array.isArray(raw)) return [];
  const out: ParsedToolCall[] = [];
  for (const tc of raw) {
    const name = tc?.function?.name;
    if (!name) continue;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function?.arguments || '{}') as Record<string, unknown>;
    } catch {
      logger.warn('[staged-agent] invalid tool arguments JSON', { tool: name });
    }
    out.push({ id: tc.id ?? `tc_${out.length}`, name, args });
  }
  return out;
}

export interface StagedAgentInput {
  message: string;
  decision: StageDecision;
  ctx: PipelineContext;
  villageName: string;
  /** Scoped facts (tenant-scoped KB/RAG snippets). */
  facts?: string[];
  /** DB records (most authoritative). */
  records?: string[];
  summary?: string;
  /** Explicit citizen confirmation captured by the deterministic UI layer. */
  confirmed?: boolean;
  language?: string;
}

function toGatewayContext(input: StagedAgentInput, stage: Stage, signal?: AbortSignal): GatewayContext {
  return {
    userId: input.ctx.userId,
    tenantId: input.ctx.tenantId,
    channel: input.ctx.channel,
    traceId: input.ctx.traceId,
    stage,
    confirmed: input.confirmed,
    isEvaluation: input.ctx.isEvaluation,
    sideEffectMode: input.ctx.sideEffectMode,
    idempotencyKeys: input.ctx.idempotencyKeys,
    recentSignatures: [],
    identityLevel: input.ctx.identityLevel,
    signal,
  };
}

/** Serialize a tool result for the model: prefer the human-readable suggestion. */
function resultToText(result: ToolCallResult | undefined): string {
  if (!result) return '{}';
  if (result.suggested_response) return result.suggested_response;
  if (result.data !== undefined) {
    return typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
  }
  return JSON.stringify({ success: result.success, error: result.error });
}
function greetingReply(villageName: string): string {
  return (
    `Halo! Saya Gana, asisten AI layanan ${villageName}. ` +
    'Saya bisa membantu menjawab pertanyaan tentang layanan desa, cek status laporan, atau memandu membuat pengaduan dan permohonan surat. Ada yang bisa saya bantu?'
  );
}

/** Deterministic fast-lane: emergency. Tool-backed, no LLM. */
async function emergencyReply(input: StagedAgentInput): Promise<{ text: string; trace: ToolTraceEntry[] }> {
  const gw = toGatewayContext(input, 'EMERGENCY');
  const r = await gatewayExecute('get_emergency_contacts', {}, gw);
  const contacts = r.ok ? resultToText(r.result) : '';
  const text = [
    'Ini kontak darurat yang tercatat di desa. Jika situasi mengancam jiwa, hubungi nomor di atas segera dan utamakan keselamatan.',
    contacts || 'Kontak darurat belum terdaftar — hubungi perangkat desa langsung.',
  ].join('\n\n');
  return { text, trace: [r.trace] };
}

/**
 * Per-claim verifier (skeleton): hard checks the final answer must pass.
 * - non-empty (never-silent)
 * - no PII leakage (outbound gate)
 * - no success-claim when a mutation failed
 */
function verifyAnswer(text: string, traces: ToolTraceEntry[]): { text: string; leaked: boolean } {
  assertNonEmptyResponse(text, 'staged-agent.verify');
  const { text: clean, leaked } = piiOutbound(text);
  if (leaked) {
    logger.warn('[staged-agent] PII leak redacted from model output');
  }
  const mutationFailed = traces.some((t) => t.blocked || (!t.success && /create|update|cancel/.test(t.tool)));
  if (mutationFailed && /berhasil (dibuat|disimpan|dikirim)/i.test(clean)) {
    logger.warn('[staged-agent] success-claim with failed mutation — downgrading');
    return {
      text: clean + '\n\nCatatan: ada kendala saat menyimpan ke sistem. Petugas desa akan menindaklanjuti manual.',
      leaked,
    };
  }
  return { text: clean, leaked };
}

async function runBoundedLoop(
  input: StagedAgentInput,
  stage: Stage,
  tools: typeof AGENT_TOOLS,
  signal?: AbortSignal,
): Promise<{ text: string; traces: ToolTraceEntry[]; toolsUsed: string[]; model: string; evidence: string[] }> {
  const traces: ToolTraceEntry[] = [];
  const toolsUsed: string[] = [];
  const evidence: string[] = [];
  const evidenceEntries: EvidenceEntry[] = [];
  let conflictInjected = false;
  const gw = toGatewayContext(input, stage, signal);

  const { system, dynamicContext } = await buildPrompt({
    villageName: input.villageName,
    tenantId: input.ctx.tenantId ?? undefined,
    stage,
    facts: input.facts ?? [],
    records: input.records ?? [],
    summary: input.summary,
    language: input.language,
  });

  const { text: safeMessage } = await piiInbound(input.message, input.ctx.tenantId ?? '');
  const messages: GatewayChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: dynamicContext },
    { role: 'user', content: safeMessage },
  ];
  // Injected once per turn when a tool is denied for identity reasons.
  let identityNoteInjected = false;

  let model = 'unknown';
  let finalText = '';

  for (let i = 0; i < MAX_AGENT_ITERATIONS; i++) {
    const budget = remainingMs(input.ctx);
    if (budget <= 2000) break;

    let result: GatewayPromptResult | null;
    try {
      result = await callAIGatewayPrompt({
        lane: 'llm',
        modelPriority: [],
        messages,
        temperature: 0.2,
        maxTokens: 1500,
        timeoutMs: Math.min(20000, budget - 1000),
        layerType: 'agent',
        callType: 'staged_agent',
        context: {
          village_id: input.ctx.tenantId ?? null,
          wa_user_id: input.ctx.userId,
          channel: input.ctx.channel,
          trace_id: input.ctx.traceId,
        },
        extraBody: tools.length > 0 ? { tools, tool_choice: 'auto' } : undefined,
      });
    } catch (err) {
      logger.warn('[staged-agent] LLM call failed', {
        traceId: input.ctx.traceId, error: redactForLog(String((err as Error)?.message ?? err)),
      });
      break;
    }
    if (!result) break;
    model = result.model || model;

    const calls = parseToolCalls(result.message);
    if (calls.length === 0) {
      finalText = (result.text || '').trim();
      break;
    }

    // Execute: reads may parallelize, writes always serial, all via gateway.
    messages.push({ role: 'assistant', content: result.text ?? null, tool_calls: result.message?.tool_calls });
    const reads = calls.filter((c) => isParallelizable(c.name as AgentToolName));
    const writes = calls.filter((c) => !isParallelizable(c.name as AgentToolName));

    const execOne = async (c: ParsedToolCall) => {
      const r = await gatewayExecute(c.name as AgentToolName, c.args, gw);
      traces.push(r.trace);
      if (!r.blocked && r.ok) toolsUsed.push(c.name);
      let content = r.ok
        ? resultToText(r.result)
        : JSON.stringify({ success: false, error: r.error, errorKind: r.errorKind });
      // Identity denial: surface a clear, user-facing explanation once so the
      // model relays it instead of silently dropping the action.
      if (r.blocked && r.blockReason?.startsWith('identity_level_insufficient')) {
        const copy = identityDenialCopy(c.name as AgentToolName);
        content = JSON.stringify({
          success: false, error: 'identity_verification_required',
          errorKind: 'POLICY', detail: copy,
        });
        if (!identityNoteInjected) {
          identityNoteInjected = true;
          messages.push({ role: 'user', content: `[SISTEM] ${copy}` });
        }
      }
      if (r.ok) {
        // Tenant assertion (fail-closed) + precedence labeling on retrieval.
        const check = assertTenant(r.result, input.ctx.tenantId ?? '');
        if (!check.ok) {
          logger.warn('[staged-agent] dropping cross-tenant retrieval result', {
            traceId: input.ctx.traceId, tool: c.name,
          });
          content = JSON.stringify({ success: false, error: 'tenant_mismatch', errorKind: 'PERMANENT' });
        } else {
          const p = precedenceOf(c.name);
          content = `${PRECEDENCE_LABEL[p]} (sumber: ${c.name})\n${content}`;
          evidence.push(content);
          evidenceEntries.push({ tool: c.name, precedence: p, text: content, tenantCheck: check });
        }
      }
      messages.push({ role: 'tool', tool_call_id: c.id, name: c.name, content });
    };

    await Promise.all(reads.map(execOne));
    for (const c of writes) await execOne(c);

    // P0-vs-document conflict: surface the resolution rule to the model
    // before it writes the final answer.
    if (!conflictInjected) {
      const conflict = detectPrecedenceConflict(evidenceEntries);
      if (conflict) {
        conflictInjected = true;
        messages.push({ role: 'user', content: `[ATURAN SUMBER] ${conflict}` });
        logger.info('[staged-agent] precedence conflict resolved to P0', { traceId: input.ctx.traceId });
      }
    }
  }

  return { text: finalText, traces, toolsUsed, model, evidence };
}

/** Shared confirmed-mutation runner for VERIFY→EXECUTE and EXECUTE. */
async function executeConfirmed(
  input: StagedAgentInput,
  gw: GatewayContext,
  mutation: { tool: string; args: Record<string, unknown> },
  finish: (partial: Omit<TurnResult, 'durationMs' | 'assessorCalls'>) => TurnResult,
  failover: (reason: string, error?: string) => TurnResult,
): Promise<TurnResult> {
  const r = await gatewayExecute(mutation.tool as AgentToolName, mutation.args, gw);
  if (!r.ok) return failover(`mutation_failed:${r.error}`, r.error);
  const { text: verified } = verifyAnswer(
    `Berhasil diproses. ${resultToText(r.result).slice(0, 500)}`, [r.trace],
  );
  return finish({
    terminalState: 'SUCCEEDED', response: verified, stage: 'EXECUTE', intent: 'mutation',
    toolsUsed: [mutation.tool], toolTrace: [r.trace], degraded: false,
  });
}

function gwFor(input: StagedAgentInput, stage: Stage): GatewayContext {
  return toGatewayContext(input, stage);
}

/** Main entry: run one turn of the staged agent for the routed stage. */
export async function runStagedTurn(input: StagedAgentInput): Promise<TurnResult> {
  const started = Date.now();
  const stage = input.decision.stage;

  const finish = (partial: Omit<TurnResult, 'durationMs' | 'assessorCalls'>): TurnResult => ({
    ...partial,
    durationMs: Date.now() - started,
    assessorCalls: input.ctx.assessorConfidences.length,
  });

  const failover = (reason: string, error?: string): TurnResult => {
    const fbInput = {
      stage, terminalState: 'FAILED' as const, userId: input.ctx.userId,
      traceId: input.ctx.traceId, tenantId: input.ctx.tenantId ?? '',
      channel: input.ctx.channel, intentHint: stageHint(stage), error,
    };
    const fb = buildFallback(fbInput);
    persistFallbackTicket(fbInput, fb.ticketRef);
    logger.warn('[staged-agent] turn failed → fallback', {
      traceId: input.ctx.traceId, stage, reason, error: error ? redactForLog(error) : undefined,
    });
    return finish({
      terminalState: 'FAILED', response: fb.response, stage,
      intent: stage, toolsUsed: [], toolTrace: [],
      degraded: true, degradationReason: reason, error,
    });
  };

  try {
    // ── Deterministic fast lanes (no LLM) ──
    if (input.decision.hints?.greeting) {
      const response = greetingReply(input.villageName);
      return finish({
        terminalState: 'SUCCEEDED', response, stage, intent: 'greeting',
        toolsUsed: [], toolTrace: [], degraded: false,
      });
    }
    if (stage === 'EMERGENCY') {
      const { text, trace } = await emergencyReply(input);
      const { text: verified } = verifyAnswer(text, trace);
      return finish({
        terminalState: 'SUCCEEDED', response: verified, stage, intent: 'emergency',
        toolsUsed: trace.filter((t) => t.success).map((t) => t.tool),
        toolTrace: trace, degraded: false,
      });
    }

    // ── VERIFY: deterministic confirmation gate, never LLM-directed ──
    if (stage === 'VERIFY') {
      const slots = input.ctx.slots as Record<string, unknown>;
      const intent = slots[INTENT_SLOT_KEY] as SlotIntent | undefined;
      const strSlots = slots as unknown as Slots;
      if (!intent || !isCollectComplete(intent, strSlots)) {
        const missing = intent ? nextMissingSlot(intent, strSlots) : null;
        return finish({
          terminalState: 'SUCCEEDED',
          response: missing
            ? `Sebelum verifikasi, saya masih butuh satu info: ${missing.prompt}`
            : 'Mohon maaf, saya belum tahu jenis laporan Anda. Bisa dijelaskan Anda ingin melapor atau mengurus surat?',
          stage: 'COLLECT', intent: 'collect_incomplete',
          toolsUsed: [], toolTrace: [], degraded: false,
        });
      }
      if (isCancellation(input.message)) {
        return finish({
          terminalState: 'SUCCEEDED',
          response: 'Baik, proses dibatalkan. Tidak ada data yang disimpan. Ada lagi yang bisa saya bantu?',
          stage: 'CLOSE', intent: 'cancelled',
          toolsUsed: [], toolTrace: [], degraded: false,
        });
      }
      if (isCorrectionRequest(input.message)) {
        return finish({
          terminalState: 'SUCCEEDED',
          response: 'Baik, bagian mana yang ingin diperbaiki? Sebutkan saja, misalnya lokasinya atau deskripsinya.',
          guidanceText: 'Menunggu koreksi warga.',
          stage: 'COLLECT', intent: 'correction',
          toolsUsed: [], toolTrace: [], degraded: false,
        });
      }
      // Execution happens ONLY on input.confirmed — bound by the orchestrator
      // to a confirm_send button.id matching the pending mutation (see
      // pipeline/confirmation.ts). Affirmative TEXT ("Ya", "✅ Benar, kirim")
      // falls through to the default path: the summary (and buttons) are
      // shown again. Text never executes a mutation.
      if (input.confirmed) {
        const raw = input.ctx.slots.pendingTool;
        const bound = (isPendingMutation(raw) ? raw : buildPendingMutation(intent, strSlots)) as PendingMutation | null;
        if (!bound) {
          return failover('verify_missing_mutation_data', 'slots incomplete at verify');
        }
        input.ctx.slots.pendingTool = bound;
        const res = await executeConfirmed(input, gwFor(input, 'EXECUTE'), bound, finish, failover);
        // Replay protection: the pending mutation is single-use.
        delete input.ctx.slots.pendingTool;
        return res;
      }
      // Default: mint the pending mutation (so the next turn's confirm_send
      // click can bind to it) and show the deterministic summary again.
      const mutation = buildPendingMutation(intent, strSlots);
      if (!mutation) {
        return failover('verify_missing_mutation_data', 'slots incomplete at verify');
      }
      input.ctx.slots.pendingTool = mutation;
      const { text: verified } = verifyAnswer(renderVerifySummary(intent, strSlots), []);
      return finish({
        terminalState: 'SUCCEEDED', response: verified, stage, intent: 'verify',
        toolsUsed: [], toolTrace: [], degraded: false,
      });
    }

    // ── EXECUTE: deterministic stage-runner, never LLM-directed ──
    if (stage === 'EXECUTE') {
      if (!input.confirmed) {
        return finish({
          terminalState: 'SUCCEEDED',
          response: 'Untuk melanjutkan, mohon konfirmasi dengan menekan tombol *Ya, lanjutkan*. Tanpa konfirmasi, saya tidak akan memproses perubahan data.',
          guidanceText: 'Tombol konfirmasi belum ditekan.',
          stage, intent: 'awaiting_confirmation',
          toolsUsed: [], toolTrace: [], degraded: false,
        });
      }
      // Confirmed: run the allowlisted mutation through the gateway, serially.
      const rawMutation = input.ctx.slots.pendingTool;
      const mutation = (isPendingMutation(rawMutation) ? rawMutation : null) as PendingMutation | null;
      if (!mutation) {
        return failover('execute_without_pending_tool', 'no pending mutation in slots');
      }
      const execRes = await executeConfirmed(input, gwFor(input, 'EXECUTE'), mutation, finish, failover);
      // Replay protection: the pending mutation is single-use. A replayed
      // confirm_send click finds no pendingTool and is rejected as stale.
      delete input.ctx.slots.pendingTool;
      return execRes;
    }

    // ── Agent stages: bounded loop with stage allowlist ──
    const allowed = STAGE_TOOL_ALLOWLIST[stage] ?? new Set<AgentToolName>();
    const tools = AGENT_TOOLS.filter((t) => allowed.has(t.function.name as AgentToolName));

    // P1-3(b): the turn budget race no longer orphans the loop. On timeout
    // the controller aborts, and the gateway refuses to start new tool
    // executions for an aborted turn — no writes land after the turn ended.
    // (The in-flight tool call itself cannot be hard-cancelled; P1-3(a)
    // idempotency makes its retry safe.)
    const controller = new AbortController();
    const runPromise = runBoundedLoop(input, stage, tools, controller.signal);
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('turn_budget_exhausted'));
      }, Math.max(1000, remainingMs(input.ctx)));
    });
    let raced: { text: string; traces: ToolTraceEntry[]; toolsUsed: string[]; model: string; evidence: string[] };
    try {
      raced = await Promise.race([runPromise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
    }
    const { text, traces, toolsUsed, model, evidence } = raced;

    if (!text.trim()) {
      return failover('empty_llm_output');
    }
    // Per-claim verification: every factual claim must be grounded in evidence.
    const claimCheck = verifyAnswerClaims(text, evidence);
    if (claimCheck.unsupportedCount > 0) {
      logger.warn('[staged-agent] unsupported claims hedged', {
        traceId: input.ctx.traceId, unsupportedCount: claimCheck.unsupportedCount,
      });
    }
    const { text: verified } = verifyAnswer(claimCheck.text, traces);
    return finish({
      terminalState: 'SUCCEEDED', response: verified, stage,
      intent: stage, fields: input.ctx.slots,
      toolsUsed, toolTrace: traces, degraded: false,
    });
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    if (msg.includes('turn_budget_exhausted')) {
      const fbInput = {
        stage, terminalState: 'BUDGET_EXHAUSTED' as const, userId: input.ctx.userId,
        traceId: input.ctx.traceId, tenantId: input.ctx.tenantId ?? '',
        channel: input.ctx.channel, intentHint: stageHint(stage),
      };
      const fb = buildFallback(fbInput);
      persistFallbackTicket(fbInput, fb.ticketRef);
      return finish({
        terminalState: 'BUDGET_EXHAUSTED', response: fb.response, stage,
        intent: stage, toolsUsed: [], toolTrace: [],
        degraded: true, degradationReason: 'turn_budget_exhausted',
      });
    }
    return failover('staged_turn_exception', msg);
  }
}

function stageHint(stage: Stage): string {
  switch (stage) {
    case 'COLLECT':
    case 'VERIFY':
    case 'EXECUTE':
      return 'complaint';
    case 'STATUS_CHECK':
      return 'status_check';
    case 'INFORMATION':
      return 'information';
    default:
      return '';
  }
}

export { createPipelineContext };
