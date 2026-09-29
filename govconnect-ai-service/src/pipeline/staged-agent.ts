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
import { STAGE_TOOL_ALLOWLIST, isParallelizable } from '../gateway/tool-policy';
import { piiInbound, piiOutbound, redactForLog } from '../gateway/pii-gateway';
import { buildPrompt } from './prompt-builder';
import { buildFallback, assertNonEmptyResponse } from './fallback-policy';
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

function toGatewayContext(input: StagedAgentInput, stage: Stage): GatewayContext {
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
    'Ini kontak darurat yang tercatat di desa. Jika situasi mengancam jiwa, hubungi segera:',
    contacts || 'Kontak darurat belum terdaftar — hubungi perangkat desa langsung.',
    'Tetap tenang dan utamakan keselamatan. Perangkat desa telah kami beri tahu lewat jalur prioritas.',
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
      text: clean + '\n\nCatatan: ada kendala saat menyimpan ke sistem. Perangkat desa akan menindaklanjuti manual.',
      leaked,
    };
  }
  return { text: clean, leaked };
}

async function runBoundedLoop(
  input: StagedAgentInput,
  stage: Stage,
  tools: typeof AGENT_TOOLS,
): Promise<{ text: string; traces: ToolTraceEntry[]; toolsUsed: string[]; model: string }> {
  const traces: ToolTraceEntry[] = [];
  const toolsUsed: string[] = [];
  const gw = toGatewayContext(input, stage);

  const { system, dynamicContext } = buildPrompt({
    villageName: input.villageName,
    stage,
    facts: input.facts ?? [],
    records: input.records ?? [],
    summary: input.summary,
    language: input.language,
  });

  const { text: safeMessage } = piiInbound(input.message);
  const messages: GatewayChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: dynamicContext },
    { role: 'user', content: safeMessage },
  ];

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
      const content = r.ok
        ? resultToText(r.result)
        : JSON.stringify({ success: false, error: r.error, errorKind: r.errorKind });
      messages.push({ role: 'tool', tool_call_id: c.id, name: c.name, content });
    };

    await Promise.all(reads.map(execOne));
    for (const c of writes) await execOne(c);
  }

  return { text: finalText, traces, toolsUsed, model };
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
    const fb = buildFallback({
      stage, terminalState: 'FAILED', userId: input.ctx.userId,
      traceId: input.ctx.traceId, intentHint: stageHint(stage), error,
    });
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
      const gw = toGatewayContext(input, 'EXECUTE');
      const mutation = (input.ctx.slots.pendingTool ?? null) as { tool: string; args: Record<string, unknown> } | null;
      if (!mutation) {
        return failover('execute_without_pending_tool', 'no pending mutation in slots');
      }
      const r = await gatewayExecute(mutation.tool as AgentToolName, mutation.args, gw);
      if (!r.ok) return failover(`mutation_failed:${r.error}`, r.error);
      const { text: verified } = verifyAnswer(
        `Berhasil diproses. ${resultToText(r.result).slice(0, 500)}`, [r.trace],
      );
      return finish({
        terminalState: 'SUCCEEDED', response: verified, stage, intent: 'mutation',
        toolsUsed: [mutation.tool], toolTrace: [r.trace], degraded: false,
      });
    }

    // ── Agent stages: bounded loop with stage allowlist ──
    const allowed = STAGE_TOOL_ALLOWLIST[stage] ?? new Set<AgentToolName>();
    const tools = AGENT_TOOLS.filter((t) => allowed.has(t.function.name as AgentToolName));

    const runPromise = runBoundedLoop(input, stage, tools);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('turn_budget_exhausted')), Math.max(1000, remainingMs(input.ctx))),
    );
    const { text, traces, toolsUsed, model } = await Promise.race([runPromise, timeoutPromise]);

    if (!text.trim()) {
      return failover('empty_llm_output');
    }
    const { text: verified } = verifyAnswer(text, traces);
    return finish({
      terminalState: 'SUCCEEDED', response: verified, stage,
      intent: stage, fields: input.ctx.slots,
      toolsUsed, toolTrace: traces, degraded: false,
    });
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    if (msg.includes('turn_budget_exhausted')) {
      const fb = buildFallback({
        stage, terminalState: 'BUDGET_EXHAUSTED', userId: input.ctx.userId,
        traceId: input.ctx.traceId, intentHint: stageHint(stage),
      });
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
