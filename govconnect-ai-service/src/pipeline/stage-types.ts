/**
 * Stage Types — core type contracts for the v2 staged-agent pipeline.
 *
 * Design (arsitektur-final §2, §4):
 * - SOP is an executable stage graph; the micro-LLM assessor only judges
 *   FUZZY transitions; administrative events and mutations are deterministic.
 * - Every turn ends in a terminal state. An empty string is NEVER a valid
 *   output (never-silent policy).
 */

import type { IdentityLevel } from './identity-ladder';

/** All stages in the executable SOP graph. */
export type Stage =
  | 'INGRESS'
  | 'TRIAGE'
  | 'COLLECT'
  | 'VERIFY'
  | 'EXECUTE'
  | 'CLOSE'
  // Fast lanes (bypass the full graph deterministically)
  | 'INFORMATION'
  | 'STATUS_CHECK'
  | 'EMERGENCY'
  | 'HANDOFF';

/** How the current stage was decided. */
export type DecisionSource = 'deterministic' | 'assessor' | 'fallback';

/** Terminal state of a turn — every turn MUST end in one of these. */
export type TerminalState =
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'BUDGET_EXHAUSTED'
  | 'WAITING_FOR_HUMAN';

/** Guardrail grades for tool calls (G0–G3). */
export type ToolGrade = 'G0' | 'G1' | 'G2' | 'G3';

/** Error taxonomy for the tool gateway. Only TRANSIENT may be retried. */
export type ToolErrorKind = 'TRANSIENT' | 'PERMANENT' | 'POLICY';

/** Result of routing one incoming message to a stage. */
export interface StageDecision {
  stage: Stage;
  source: DecisionSource;
  /** 0..1 — assessor confidence; <0.4 twice in a row suggests handoff. */
  confidence: number;
  reasons: string[];
  /** Free-form fields extracted deterministically (e.g. emergency keywords). */
  hints?: Record<string, unknown>;
}

/** Minimal per-turn pipeline context (deterministic session state, NOT memory). */
export interface PipelineContext {
  traceId: string;
  userId: string;
  /** Generic tenant id (village_id today; campus_id/coop_id after pivot). */
  tenantId?: string;
  channel: 'whatsapp' | 'webchat';
  messageId?: string;
  startedAtMs: number;
  /** Total per-turn budget in ms. Exceeding it forces FAILED + fallback. */
  totalTimeoutMs: number;
  /** Collected slot values for the active stage (deterministic state). */
  slots: Record<string, unknown>;
  /** Idempotency keys minted this turn. */
  idempotencyKeys: string[];
  /** Assessor confidences this turn (for the handoff heuristic). */
  assessorConfidences: number[];
  isEvaluation?: boolean;
  sideEffectMode?: 'production' | 'evaluation' | 'knowledge_test';
  /** Identity ladder level resolved at ingress (L0/L1/L2). */
  identityLevel?: IdentityLevel;
}

/** Structured outcome of one pipeline turn. */
export interface TurnResult {
  terminalState: TerminalState;
  /** NEVER empty — fallback-policy guarantees a degraded message instead. */
  response: string;
  guidanceText?: string;
  stage: Stage;
  intent: string;
  fields?: Record<string, unknown>;
  toolsUsed: string[];
  toolTrace: ToolTraceEntry[];
  durationMs: number;
  assessorCalls: number;
  degraded: boolean;
  degradationReason?: string;
  error?: string;
}

export interface ToolTraceEntry {
  tool: string;
  success: boolean;
  durationMs: number;
  errorKind?: ToolErrorKind;
  blocked?: boolean;
  blockReason?: string;
}

/** Create a fresh pipeline context for one turn. */
export function createPipelineContext(init: {
  traceId: string;
  userId: string;
  tenantId?: string;
  channel: 'whatsapp' | 'webchat';
  messageId?: string;
  totalTimeoutMs?: number;
  isEvaluation?: boolean;
  sideEffectMode?: 'production' | 'evaluation' | 'knowledge_test';
}): PipelineContext {
  return {
    traceId: init.traceId,
    userId: init.userId,
    tenantId: init.tenantId,
    channel: init.channel,
    messageId: init.messageId,
    startedAtMs: Date.now(),
    totalTimeoutMs: init.totalTimeoutMs ?? Number(process.env.PIPELINE_TOTAL_TIMEOUT_MS ?? 45000),
    slots: {},
    idempotencyKeys: [],
    assessorConfidences: [],
    isEvaluation: init.isEvaluation,
    sideEffectMode: init.sideEffectMode,
  };
}

/** Milliseconds remaining before the total turn budget is exhausted. */
export function remainingMs(ctx: PipelineContext): number {
  return Math.max(0, ctx.totalTimeoutMs - (Date.now() - ctx.startedAtMs));
}
