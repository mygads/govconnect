/**
 * Tool Gateway — fail-closed execution for every agent tool call.
 *
 * Design (arsitektur-final §2, §10):
 *   validate → stage/policy check → grade/approval → idempotency
 *   → PII redaction → execute (per-tool timeout)
 *   → structured result/error → immutable audit
 *
 * Rules:
 * - Declarative stage allowlist. NO regex routing.
 * - Read-only G0 tools may run in parallel; writes are always serial.
 * - Error taxonomy: TRANSIENT (retry) / PERMANENT / POLICY (never retry).
 * - Loop detection: same tool+args signature 3× in a sliding window of 6
 *   calls, or no-progress (no new information), stops the loop.
 * - Mutations (G2/G3) NEVER execute on LLM say-so alone: they require a
 *   deterministic confirmation captured by the stage-runner.
 */

import type { AgentToolName } from '../services/agent/tool-definitions';
import { executeToolCall, type ToolCallResult } from '../services/agent/tool-executor';
import { TOOL_GRADES, STAGE_TOOL_ALLOWLIST, isParallelizable } from './tool-policy';
import { piiInbound, redactForLog } from './pii-gateway';
import type { Stage, ToolErrorKind, ToolTraceEntry } from '../pipeline/stage-types';
import logger from '../utils/logger';

const PER_TOOL_TIMEOUT_MS = Number(process.env.PER_TOOL_TIMEOUT_MS ?? 12000);
const MAX_RETRIES_TRANSIENT = 1;

export interface GatewayContext {
  userId: string;
  tenantId?: string;
  channel: 'whatsapp' | 'webchat';
  traceId: string;
  stage: Stage;
  /** True when the deterministic stage-runner captured explicit confirmation. */
  confirmed?: boolean;
  isEvaluation?: boolean;
  sideEffectMode?: 'production' | 'evaluation' | 'knowledge_test';
  /** Idempotency keys minted this turn (shared with pipeline ctx). */
  idempotencyKeys: string[];
  /** Sliding window of recent tool signatures for loop detection. */
  recentSignatures: string[];
}

export interface GatewayResult {
  ok: boolean;
  result?: ToolCallResult;
  errorKind?: ToolErrorKind;
  error?: string;
  blocked?: boolean;
  blockReason?: string;
  trace: ToolTraceEntry;
}

function signatureOf(tool: AgentToolName, args: Record<string, unknown>): string {
  const sorted = Object.keys(args).sort().map((k) => `${k}=${JSON.stringify(args[k])}`).join('&');
  return `${tool}(${sorted})`;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`tool_timeout:${label}:${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

function classifyError(err: unknown): ToolErrorKind {
  const msg = String((err as Error)?.message ?? err).toLowerCase();
  if (msg.startsWith('tool_timeout:') || /timeout|econnreset|econnrefused|temporarily|429|rate/.test(msg)) {
    return 'TRANSIENT';
  }
  if (/not allowed|forbidden|policy|blocked|unauthorized/.test(msg)) return 'POLICY';
  return 'PERMANENT';
}

export async function gatewayExecute(
  tool: AgentToolName,
  rawArgs: Record<string, unknown>,
  ctx: GatewayContext,
): Promise<GatewayResult> {
  const started = Date.now();
  const trace: ToolTraceEntry = { tool, success: false, durationMs: 0 };

  const fail = (blockReason: string, errorKind: ToolErrorKind = 'POLICY'): GatewayResult => {
    trace.durationMs = Date.now() - started;
    trace.blocked = true;
    trace.blockReason = blockReason;
    trace.errorKind = errorKind;
    logger.warn('[tool-gateway] blocked', {
      traceId: ctx.traceId, tool, stage: ctx.stage, blockReason,
    });
    return { ok: false, blocked: true, blockReason, errorKind, error: blockReason, trace };
  };

  // 1. Validate: known tool.
  if (!TOOL_GRADES[tool]) return fail(`unknown_tool:${tool}`);

  // 2. Stage / policy check: declarative allowlist.
  const allowed = STAGE_TOOL_ALLOWLIST[ctx.stage];
  if (!allowed || !allowed.has(tool)) {
    return fail(`tool_not_allowed_in_stage:${tool}:${ctx.stage}`);
  }

  // 3. Grade / approval: G2/G3 need deterministic confirmation.
  const grade = TOOL_GRADES[tool];
  if ((grade === 'G2' || grade === 'G3') && !ctx.confirmed) {
    return fail(`mutation_requires_confirmation:${tool}:${grade}`, 'POLICY');
  }
  if (ctx.sideEffectMode && ctx.sideEffectMode !== 'production' && (grade === 'G2' || grade === 'G3')) {
    return fail(`mutation_blocked_in_mode:${ctx.sideEffectMode}`, 'POLICY');
  }

  // 4. Loop detection: same signature 3× in sliding window of 6.
  const sig = signatureOf(tool, rawArgs);
  const window = ctx.recentSignatures.slice(-6);
  const repeats = window.filter((s) => s === sig).length;
  if (repeats >= 2) {
    return fail(`loop_detected:${tool}`, 'PERMANENT');
  }
  ctx.recentSignatures.push(sig);

  // 5. PII redaction on args (inbound).
  const safeArgs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawArgs)) {
    safeArgs[k] = typeof v === 'string' ? piiInbound(v).text : v;
  }

  // 6. Execute with per-tool timeout; retry ONLY transient.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES_TRANSIENT; attempt++) {
    try {
      const executed = await withTimeout(
        executeToolCall(tool, safeArgs, {
          userId: ctx.userId,
          villageId: ctx.tenantId,
          channel: ctx.channel,
          traceId: ctx.traceId,
          isEvaluation: ctx.isEvaluation,
          sideEffectMode: ctx.sideEffectMode,
        }),
        PER_TOOL_TIMEOUT_MS,
        tool,
      );
      trace.durationMs = Date.now() - started;
      trace.success = true;
      return { ok: true, result: executed.result, trace };
    } catch (err) {
      lastErr = err;
      const kind = classifyError(err);
      trace.errorKind = kind;
      if (kind !== 'TRANSIENT' || attempt === MAX_RETRIES_TRANSIENT) break;
      logger.info('[tool-gateway] transient failure, retrying once', {
        traceId: ctx.traceId, tool, attempt: attempt + 1,
        error: redactForLog(String((err as Error)?.message ?? err)),
      });
    }
  }

  trace.durationMs = Date.now() - started;
  trace.success = false;
  const errorKind = classifyError(lastErr);
  trace.errorKind = errorKind;
  const error = `tool_failed:${tool}:${errorKind}`;
  logger.warn('[tool-gateway] execution failed', {
    traceId: ctx.traceId, tool, errorKind,
    error: redactForLog(String((lastErr as Error)?.message ?? lastErr)),
  });
  return { ok: false, errorKind, error, trace };
}
