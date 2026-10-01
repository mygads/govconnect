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
import type { ToolCallResult, ExecutedToolCall } from '../services/agent/tool-executor';
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
import { STAGE_TOOL_ALLOWLIST, isParallelizable, TOOL_PARALLEL_LIMIT, runWithConcurrencyLimit } from '../gateway/tool-policy';
import { DETERMINISTIC_ONLY_STAGES } from './stage-graph';
import { piiInbound, piiOutbound, redactForLog } from '../gateway/pii-gateway';
import { identityDenialCopy } from './identity-ladder';
import { buildPrompt } from './prompt-builder';
import { DEFAULT_IDENTITY, type VillageIdentity } from '../services/village-identity.service';
import { resolveExperimentVariant } from '../services/experiment-framework.service';
import { issueFallback, assertNonEmptyResponse } from './fallback-policy';
import { toolResultToUserText } from './tool-result-text';
import { assertNotAborted, createTurnAbortController } from './abort-guard';
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
  /**
   * Per-village AI identity dari pengaturan admin desa (nama, disclosure,
   * persona). Default: transparan, nama "Gana".
   */
  identity?: VillageIdentity;
}

function toGatewayContext(
  input: StagedAgentInput,
  stage: Stage,
  signal?: AbortSignal,
  dedupCache?: Map<string, Promise<ExecutedToolCall>>,
): GatewayContext {
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
    // P1-4: one dedup map per turn — shared by every tool call in this turn,
    // including concurrent ones in a parallel batch. Callers that run
    // several bounded loops per turn pass the same map so duplicates are
    // caught turn-wide, not just per loop.
    dedupCache: dedupCache ?? new Map(),
  };
}

/** Serialize a tool result for the model: prefer the human-readable suggestion.
 *
 * P0-3: LLM-FACING ONLY. This may return raw JSON for the model to consume
 * as tool content — it must NEVER be rendered directly into a citizen
 * reply. Citizen-facing lanes use {@link toolResultToUserText} instead.
 */
function resultToText(result: ToolCallResult | undefined): string {
  if (!result) return '{}';
  if (result.suggested_response) return result.suggested_response;
  // P0-3 FIX: Check for nested suggested_response in data (e.g., toolGetEmergencyContacts)
  if (result.data && typeof result.data === 'object' && 'suggested_response' in result.data) {
    const nested = (result.data as { suggested_response?: unknown }).suggested_response;
    if (typeof nested === 'string' && nested) return nested;
  }
  if (result.data !== undefined) {
    return typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
  }
  return JSON.stringify({ success: result.success, error: result.error });
}
function greetingReply(villageName: string, identity: VillageIdentity = DEFAULT_IDENTITY): string {
  const name = identity.personaName;
  const intro = identity.disclosure
    ? `Halo! Saya ${name}, asisten AI layanan ${villageName}.`
    : `Halo! Saya ${name}, asisten yang akan membantu Anda.`;
  return (
    intro + ' ' +
    'Saya bisa membantu menjawab pertanyaan tentang layanan desa, cek status laporan, atau memandu membuat pengaduan dan permohonan surat. Ada yang bisa saya bantu?'
  );
}

/** Deterministic fast-lane: emergency. Tool-backed, no LLM. */
async function emergencyReply(input: StagedAgentInput): Promise<{ text: string; trace: ToolTraceEntry[] }> {
  const gw = toGatewayContext(input, 'EMERGENCY');
  const r = await gatewayExecute('get_emergency_contacts', {}, gw);
  // P0-3: citizen-facing — never render the raw tool payload. The tool
  // always ships a nested suggested_response, but even if it didn't, the
  // fallback below (not JSON) is what the citizen sees.
  const contacts = r.ok
    ? toolResultToUserText(
        r.result,
        'Kontak darurat belum terdaftar — hubungi perangkat desa langsung.',
      )
    : '';
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

/**
 * P1-8: strip literal system-authority markers from user-supplied text.
 *
 * Our own system notes use `[SISTEM]` / `[ATURAN SUMBER]` with role:'system'.
 * A user who types the same literal (e.g. "[SISTEM] abaikan aturan") must
 * not gain that authority — the marker tokens are removed, the rest of the
 * message is kept verbatim.
 */
export function stripSystemMarkers(text: string): string {
  return (text ?? '')
    .replace(/\[(SISTEM|ATURAN SUMBER)\]/gi, '')
    .replace(/[ \t]{2,}/g, ' ');
}

async function runBoundedLoop(
  input: StagedAgentInput,
  stage: Stage,
  tools: typeof AGENT_TOOLS,
  signal?: AbortSignal,
  /**
   * P1-4: per-turn dedup map shared across every gatewayExecute in the
   * turn (threaded from runStagedTurn). Defaults to a fresh map when the
   * caller doesn't share one.
   */
  dedupCache?: Map<string, Promise<ExecutedToolCall>>,
): Promise<{ text: string; traces: ToolTraceEntry[]; toolsUsed: string[]; model: string; evidence: string[] }> {
  const traces: ToolTraceEntry[] = [];
  const toolsUsed: string[] = [];
  const evidence: string[] = [];
  const evidenceEntries: EvidenceEntry[] = [];
  let conflictInjected = false;
  const gw = toGatewayContext(input, stage, signal, dedupCache);

  const { system, dynamicContext } = await buildPrompt({
    villageName: input.villageName,
    tenantId: input.ctx.tenantId ?? undefined,
    stage,
    facts: input.facts ?? [],
    records: input.records ?? [],
    summary: input.summary,
    language: input.language,
    identity: input.identity ?? DEFAULT_IDENTITY,
    // R13: deterministic experiment bucketing. Resolved once per turn;
    // fail-soft (null → control experience). Cached 60s per village.
    experimentVariant: await resolveExperimentVariant(
      input.ctx.tenantId ?? undefined,
      input.ctx.userId ?? undefined,
      input.ctx.traceId,
    ),
  });

  // P1-8: system-authority notes go out as role:'system', never role:'user'.
  // A model instructed by a user-role message treats it as untrusted user
  // content; system role carries the intended authority and cannot be
  // confused with (or forged by) user input.
  const { text: safeMessage } = await piiInbound(
    stripSystemMarkers(input.message),
    input.ctx.tenantId ?? '',
  );
  const messages: GatewayChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: dynamicContext },
    { role: 'user', content: safeMessage },
  ];
  // Injected once per turn when a tool is denied for identity reasons.
  let identityNoteInjected = false;
  // R8 telemetry: set when a DB read tool succeeds this turn. If the model
  // then calls RAG anyway, we log rag_after_db_hit so skip-rule compliance
  // is measurable. (No hard block: non-empty DB output is not proof it
  // answered the question — only the model can judge relevance — and
  // overriding that judgment risks wrong answers.)
  let dbReadHit = false;
  const DB_READ_TOOLS = new Set([
    'get_village_profile', 'get_service_info',
    'get_important_contact', 'get_emergency_contacts',
  ]);
  // R8 telemetry: RAG after a DB hit is wasteful semantic re-retrieval.
  // load_skill is deliberately NOT in this set: it is a cheap indexed
  // lookup (not embedding search) and the desired path for procedural
  // questions per static prompt rule 9.
  const RAG_TOOLS = new Set(['search_knowledge', 'search_documents']);

  let model = 'unknown';
  let finalText = '';
  // BUG-008 companion: free-tier models sometimes return tool_calls in a
  // malformed shape (unparseable). Accepting the empty text as final would
  // silently drop the turn; retry once before letting failover handle it.
  let malformedToolCallRetries = 0;
  const MAX_MALFORMED_TOOL_CALL_RETRIES = 1;

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
        maxTokens: 4000,
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
      // BUG-008 companion: the model returned tool_calls we could not parse
      // (malformed shape). The text is empty and no tools can execute — retry
      // the LLM call once instead of accepting an empty final answer.
      const rawToolCalls = (result.message as { tool_calls?: unknown } | undefined)?.tool_calls;
      if (!finalText && Array.isArray(rawToolCalls) && rawToolCalls.length > 0
          && malformedToolCallRetries < MAX_MALFORMED_TOOL_CALL_RETRIES) {
        malformedToolCallRetries++;
        logger.warn('[staged-agent] unparseable tool_calls; retrying LLM call', {
          traceId: input.ctx.traceId, stage, retry: malformedToolCallRetries,
          rawCount: rawToolCalls.length,
        });
        finalText = '';
        continue;
      }
      break;
    }

    // Execute: reads may parallelize (bounded pool, P1-4), writes always
    // serial, all via gateway.
    messages.push({ role: 'assistant', content: result.text ?? null, tool_calls: result.message?.tool_calls });
    const reads = calls.filter((c) => isParallelizable(c.name as AgentToolName));
    const writes = calls.filter((c) => !isParallelizable(c.name as AgentToolName));

    // P1-4: execOne is side-effect-free w.r.t. shared turn state — it
    // returns a per-call output and the caller applies outputs in original
    // call order. This keeps traces/evidence/messages deterministic even
    // though the reads run concurrently in a bounded pool.
    interface PerCallOutput {
      call: ParsedToolCall;
      trace: ToolTraceEntry;
      toolsUsedAdd: boolean;
      dbReadHitAdd: boolean;
      ragAfterDbHit: boolean;
      identityDenialCopy?: string;
      evidenceEntry?: EvidenceEntry;
      toolContent: string;
    }

    const execOne = async (c: ParsedToolCall): Promise<PerCallOutput> => {
      const r = await gatewayExecute(c.name as AgentToolName, c.args, gw);
      const out: PerCallOutput = {
        call: c,
        trace: r.trace,
        toolsUsedAdd: !r.blocked && r.ok,
        dbReadHitAdd: !r.blocked && r.ok && DB_READ_TOOLS.has(c.name),
        ragAfterDbHit: false,
        toolContent: '',
      };
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
        out.identityDenialCopy = copy;
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
          out.evidenceEntry = { tool: c.name, precedence: p, text: content, tenantCheck: check };
        }
      }
      out.toolContent = content;
      return out;
    };

    // P1-4: bounded parallel pool for independent reads (default 5 in
    // flight) instead of an unbounded Promise.all — one chatty turn can no
    // longer stampede downstream services. Writes stay strictly serial.
    const readOutputs = await runWithConcurrencyLimit(
      reads.map((c) => () => execOne(c)),
      TOOL_PARALLEL_LIMIT,
    );
    const writeOutputs: PerCallOutput[] = [];
    for (const c of writes) writeOutputs.push(await execOne(c));

    // Apply in original call order so traces, evidence, tool messages and
    // telemetry stay deterministic regardless of completion order.
    for (const out of [...readOutputs, ...writeOutputs]) {
      traces.push(out.trace);
      if (out.toolsUsedAdd) toolsUsed.push(out.call.name);
      // R8: track DB hits and RAG-after-DB-hit for skip-rule telemetry.
      if (out.dbReadHitAdd) dbReadHit = true;
      if (RAG_TOOLS.has(out.call.name) && dbReadHit) {
        logger.info('[staged-agent] rag_after_db_hit', {
          traceId: input.ctx.traceId, tool: out.call.name, stage,
        });
      }
      if (out.identityDenialCopy && !identityNoteInjected) {
        identityNoteInjected = true;
        messages.push({ role: 'system', content: `[SISTEM] ${out.identityDenialCopy}` });
      }
      if (out.evidenceEntry) {
        evidence.push(out.evidenceEntry.text);
        evidenceEntries.push(out.evidenceEntry);
      }
      messages.push({ role: 'tool', tool_call_id: out.call.id, name: out.call.name, content: out.toolContent });
    }

    // P0-vs-document conflict: surface the resolution rule to the model
    // before it writes the final answer.
    if (!conflictInjected) {
      const conflict = detectPrecedenceConflict(evidenceEntries);
      if (conflict) {
        conflictInjected = true;
        messages.push({ role: 'system', content: `[ATURAN SUMBER] ${conflict}` });
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
  failover: (reason: string, error?: string) => Promise<TurnResult>,
  signal?: AbortSignal,
): Promise<TurnResult> {
  // P1-5: fail-closed — never execute a confirmed mutation on an aborted turn.
  assertNotAborted(signal, 'execute_confirmed_mutation');
  const r = await gatewayExecute(mutation.tool as AgentToolName, mutation.args, gw);
  if (!r.ok) return await failover(`mutation_failed:${r.error}`, r.error);
  // P0-3: citizen-facing — prefer the tool's suggested_response; NEVER dump
  // the raw tool payload (JSON) into the reply.
  const { text: verified } = verifyAnswer(
    `Berhasil diproses. ${toolResultToUserText(r.result, 'Petugas desa akan menindaklanjuti.')}`,
    [r.trace],
  );
  return finish({
    terminalState: 'SUCCEEDED', response: verified, stage: 'EXECUTE', intent: 'mutation',
    toolsUsed: [mutation.tool], toolTrace: [r.trace], degraded: false,
  });
}

function gwFor(
  input: StagedAgentInput,
  stage: Stage,
  signal?: AbortSignal,
  dedupCache?: Map<string, Promise<ExecutedToolCall>>,
): GatewayContext {
  return toGatewayContext(input, stage, signal, dedupCache);
}

/** Main entry: run one turn of the staged agent for the routed stage. */
export async function runStagedTurn(input: StagedAgentInput): Promise<TurnResult> {
  const started = Date.now();
  const stage = input.decision.stage;
  // P1-4: one dedup map for the whole turn, shared by every bounded loop
  // and the deterministic execute path below, so an identical tool+args
  // pair runs once per turn no matter which stage issued it.
  const turnDedupCache = new Map<string, Promise<ExecutedToolCall>>();

  const finish = (partial: Omit<TurnResult, 'durationMs' | 'assessorCalls'>): TurnResult => ({
    ...partial,
    durationMs: Date.now() - started,
    assessorCalls: input.ctx.assessorConfidences.length,
  });

  // In shadow/evaluation mode no production state may be written (P1-1).
  const persistWrites = (input.ctx.sideEffectMode ?? 'production') === 'production';

  const failover = async (reason: string, error?: string): Promise<TurnResult> => {
    const fbInput = {
      stage, terminalState: 'FAILED' as const, userId: input.ctx.userId,
      traceId: input.ctx.traceId, tenantId: input.ctx.tenantId ?? '',
      channel: input.ctx.channel, intentHint: stageHint(stage), error,
    };
    const fb = await issueFallback(fbInput, { persist: persistWrites });
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
      const response = greetingReply(input.villageName, input.identity ?? DEFAULT_IDENTITY);
      return finish({
        terminalState: 'SUCCEEDED', response, stage, intent: 'greeting',
        toolsUsed: [], toolTrace: [], degraded: false,
      });
    }
    // ── W1: user-initiated cancellation → CANCELLED (any stage) ──
    // User dapat membatalkan kapan saja; turn berakhir tanpa side effect.
    if (isCancellation(input.message)) {
      return finish({
        terminalState: 'CANCELLED',
        response: 'Baik, proses dibatalkan. Tidak ada data yang disimpan. Ada lagi yang bisa saya bantu?',
        stage: 'CLOSE', intent: 'cancelled',
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
    // ── HANDOFF: deterministic human handoff — W1 WAITING_FOR_HUMAN ──
    // Turn berakhir di sini; manusia yang melanjutkan. Tidak ada LLM call.
    if (stage === 'HANDOFF') {
      // J2 fix (v2): set durable HANDOFF_PENDING state so the takeover
      // actually blocks subsequent AI turns (previously response-only).
      try {
        const { startTakeoverForUser } = await import('../services/channel-client.service');
        await startTakeoverForUser(input.ctx.userId, {
          village_id: input.ctx.tenantId,
          channel: input.ctx.channel === 'webchat' ? 'WEBCHAT' : 'WHATSAPP',
          admin_id: 'system-auto-handoff',
          admin_name: 'Petugas Desa',
          reason: 'user_requested_human_agent',
          enrichment: {
            intent: 'handoff',
            last_user_message: input.message,
            escalation_reason: 'user_requested_human_agent',
            channel: input.ctx.channel,
            village_id: input.ctx.tenantId || null,
          },
        });
      } catch (err) {
        logger.warn('v2 handoff: startTakeoverForUser failed', { error: String(err) });
      }
      return finish({
        terminalState: 'WAITING_FOR_HUMAN',
        response: 'Baik, saya teruskan ke petugas desa ya. Mohon tunggu sebentar, petugas akan segera membantu. 🙏',
        guidanceText: 'Menunggu petugas manusia.',
        stage, intent: 'handoff',
        toolsUsed: [], toolTrace: [], degraded: false,
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
        // P1-5: the deterministic execute path gets the same per-turn abort
        // budget as the agent loop, and the signal is threaded into the
        // gateway so an aborted turn refuses the mutation outright.
        const turnAbort = createTurnAbortController(Math.max(1000, remainingMs(input.ctx)));
        try {
          const res = await executeConfirmed(input, gwFor(input, 'EXECUTE', turnAbort.signal, turnDedupCache), bound, finish, failover, turnAbort.signal);
          return res;
        } finally {
          turnAbort.dispose();
          delete input.ctx.slots.pendingTool;
        }
      }
      // Default: mint the pending mutation (so the next turn's confirm_send
      // click can bind to it) and show the deterministic summary again.
      // P1-11: anaphoric question during VERIFY (decision.hints.verifyQuestion,
      // set by process-message-v2 when the assessor judges the message a
      // question about the pending item, e.g. "kapan selesainya?").
      // Answer WITH the pending mutation as context, KEEP the mutation,
      // stay in VERIFY, and re-show the deterministic summary + confirm
      // prompt. Never executes, never drops the mutation.
      if (input.decision.hints?.verifyQuestion === true) {
        const qMutation = buildPendingMutation(intent, strSlots);
        if (!qMutation) {
          return failover('verify_missing_mutation_data', 'slots incomplete at verify');
        }
        input.ctx.slots.pendingTool = qMutation;
        const pendingSummary = renderVerifySummary(intent, strSlots);
        const qaFacts = [
          '[SISTEM] Warga sedang memverifikasi laporan/permohonan di bawah ini (BELUM dikonfirmasi, BELUM tercatat di sistem). ' +
          'Pertanyaan warga merujuk ke laporan/permohonan ini — jawab dengan konteks tersebut. ' +
          'JANGAN mengklaim laporan sudah dibuat, terkirim, atau sedang diproses. ' +
          'Untuk estimasi waktu penyelesaian, beri perkiraan umum yang jujur dan sarankan konfirmasi ke petugas desa untuk kepastian.',
          pendingSummary,
        ];
        const infoTools = AGENT_TOOLS.filter((t) =>
          (STAGE_TOOL_ALLOWLIST['INFORMATION'] ?? new Set<AgentToolName>()).has(t.function.name as AgentToolName),
        );
        const qa = await runBoundedLoop(
          { ...input, facts: [...(input.facts ?? []), ...qaFacts] },
          'INFORMATION',
          infoTools,
          undefined,
          turnDedupCache,
        );
        const answer = qa.text.trim();
        // Never silent: if the Q&A loop yields nothing, the deterministic
        // summary alone still goes out (the question is implicitly deferred
        // to the human-readable summary + confirm prompt).
        const combined = answer ? `${answer}\n\n${pendingSummary}` : pendingSummary;
        const { text: verified } = verifyAnswer(combined, qa.traces);
        return finish({
          terminalState: 'SUCCEEDED', response: verified, stage, intent: 'verify_question',
          toolsUsed: qa.toolsUsed, toolTrace: qa.traces, degraded: false,
        });
      }
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
      // P1-5: per-turn abort budget for the deterministic execute path;
      // the signal is threaded into the gateway so an aborted turn refuses
      // the mutation outright (fail-closed).
      const turnAbort = createTurnAbortController(Math.max(1000, remainingMs(input.ctx)));
      try {
        const execRes = await executeConfirmed(input, gwFor(input, 'EXECUTE', turnAbort.signal, turnDedupCache), mutation, finish, failover, turnAbort.signal);
        return execRes;
      } finally {
        turnAbort.dispose();
        // Replay protection: the pending mutation is single-use. A replayed
        // confirm_send click finds no pendingTool and is rejected as stale.
        delete input.ctx.slots.pendingTool;
      }
    }

    // ── Agent stages: bounded loop with stage allowlist ──
    // Track A2: DETERMINISTIC_ONLY_STAGES wired as a fail-closed guard.
    // EMERGENCY / VERIFY / EXECUTE have dedicated deterministic handlers
    // above and must NEVER reach the LLM loop. If routing ever sends one
    // here, throw: the turn-level catch converts this into the never-silent
    // fallback rather than an LLM-generated answer.
    if (DETERMINISTIC_ONLY_STAGES.has(stage)) {
      throw new Error(`[staged-agent] deterministic-only stage reached agent loop: ${stage}`);
    }
    const allowed = STAGE_TOOL_ALLOWLIST[stage] ?? new Set<AgentToolName>();
    const tools = AGENT_TOOLS.filter((t) => allowed.has(t.function.name as AgentToolName));

    // P1-3(b): the turn budget race no longer orphans the loop. On timeout
    // the controller aborts, and the gateway refuses to start new tool
    // executions for an aborted turn — no writes land after the turn ended.
    // (The in-flight tool call itself cannot be hard-cancelled; P1-3(a)
    // idempotency makes its retry safe.)
    const controller = new AbortController();
    const runPromise = runBoundedLoop(input, stage, tools, controller.signal, turnDedupCache);
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
      const fb = await issueFallback(fbInput, { persist: persistWrites });
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
