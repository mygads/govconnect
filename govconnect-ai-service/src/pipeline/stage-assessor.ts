/**
 * Stage Assessor — micro-LLM that judges ONLY fuzzy stage transitions.
 *
 * Design (arsitektur-final §4):
 * - The assessor never decides administrative events or mutations.
 * - It answers one question: "given this message in this stage, which
 *   candidate next-stage fits best?" with a confidence.
 * - Confidence < 0.4 twice in a row → the pipeline suggests HANDOFF.
 *
 * This implementation ships with a deterministic keyword fallback so the
 * pipeline works end-to-end without an LLM. Wire `assessWithLLM` to the
 * cheap tier (assessor/classifier lane) when ready; the interface is stable.
 */

import type { Stage, StageDecision } from './stage-types';
import { transitionsFrom } from './stage-graph';
import logger from '../utils/logger';

export interface AssessorInput {
  message: string;
  fromStage: Stage;
  previousConfidence?: number;
  /**
   * Intent of an ACTIVE (incomplete) COLLECT session, if any.
   * When set, the deterministic fallback requires a strong explicit signal
   * to leave COLLECT — weak keyword hits must not abandon slot collection.
   */
  activeCollectIntent?: 'complaint' | 'service_request' | null;
  /**
   * P1-11: true when the previous turn left the citizen at VERIFY with a
   * minted pending mutation, and the current message is not a button click,
   * explicit confirmation, cancellation, or correction. The citizen is most
   * likely asking about the item under verification ("kapan selesainya?").
   * The deterministic fallback keeps VERIFY (fail-safe: the mutation is
   * never executed nor dropped without an explicit user decision).
   */
  verifyPending?: boolean;
}

/** Optional LLM hook — injected by wiring code, not imported directly. */
export type AssessorLLMFn = (input: AssessorInput, candidates: Stage[]) => Promise<{
  stage: Stage;
  confidence: number;
  reason: string;
} | null>;

let llmHook: AssessorLLMFn | null = null;

/** Register the real micro-LLM implementation (cheap tier). */
export function setAssessorLLM(fn: AssessorLLMFn): void {
  llmHook = fn;
}

/** Deterministic fallback: keyword scoring over candidate stages. */
function assessDeterministic(input: AssessorInput, candidates: Stage[]): StageDecision {
  // P1-11 fail-safe: an interrupted VERIFY keeps its pending mutation.
  // Without the LLM we cannot reliably tell a question about the pending
  // item from a brand-new topic; staying in VERIFY is the safe choice —
  // the mutation is never executed nor dropped, the citizen can still
  // confirm, correct, or cancel on the next turn.
  if (input.verifyPending && input.fromStage === 'VERIFY' && candidates.includes('VERIFY')) {
    return {
      stage: 'VERIFY',
      source: 'deterministic',
      confidence: 0.6,
      reasons: ['assessor_verify_pending_protected'],
    };
  }

  const text = input.message.toLowerCase();

  const scores = new Map<Stage, number>();
  for (const c of candidates) scores.set(c, 0);

  const bump = (stage: Stage, re: RegExp, w: number) => {
    if (candidates.includes(stage) && re.test(text)) {
      scores.set(stage, (scores.get(stage) ?? 0) + w);
    }
  };

  // Complaint / report intent → COLLECT
  bump('COLLECT', /\b(lapor|aduan|rusak|bocor|sampah|jalan|jembatan|lampu|air|banjir|kotor)\b/, 3);
  // Service request intent → COLLECT
  bump('COLLECT', /\b(surat|ktp|kk|domisili|skck|sktm|pengantar|permohonan|daftar|urus)\b/, 3);
  // Information intent → INFORMATION
  bump('INFORMATION', /\b(apa|bagaimana|gimana|kapan|dimana|berapa|siapa|jadwal|info|tanya)\b/, 2);
  // Status intent → STATUS_CHECK.
  // NOTE: "sudah" deliberately EXCLUDED — it is a temporal adverb ("sudah 2 minggu")
  // extremely common in complaint continuations, not a status-check signal.
  bump('STATUS_CHECK', /\b(status|cek|lacak|progress)\b/, 2);
  // Human request / frustration → HANDOFF
  bump('HANDOFF', /\b(manusia|orang|admin|petugas|operator|cs|kesal|kecewa|bodoh|lemot|tidak membantu|nggak membantu)\b/, 3);

  let best: Stage = candidates[0];
  let bestScore = -1;
  for (const [stage, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      best = stage;
    }
  }

  // Active COLLECT protection: when a complaint/service-request is mid-collection,
  // weak keyword signals must NOT yank the conversation to another stage.
  // INFORMATION / STATUS_CHECK drift (score ≤ 3, keyword level only) is blocked;
  // HANDOFF (explicit frustration) is still allowed through as a safety valve.
  if (
    input.activeCollectIntent &&
    best !== 'COLLECT' &&
    best !== 'HANDOFF' &&
    bestScore <= 3
  ) {
    return {
      stage: 'COLLECT',
      source: 'deterministic',
      confidence: 0.7,
      reasons: ['assessor_active_collect_protected'],
    };
  }

  // No signal at all → stay in TRIAGE and ask a clarifying question.
  if (bestScore <= 0) {
    return {
      stage: 'TRIAGE',
      source: 'deterministic',
      confidence: 0.3,
      reasons: ['assessor_no_signal'],
      hints: { needsClarification: true },
    };
  }

  return {
    stage: best,
    source: 'deterministic',
    confidence: Math.min(0.85, 0.45 + bestScore * 0.1),
    reasons: ['assessor_keyword_fallback'],
  };
}

export async function assessStage(input: AssessorInput): Promise<StageDecision> {
  if (isExplicitHandoffRequest(input.message)) {
    const { isAllowedTransition } = await import('./stage-graph');
    if (isAllowedTransition(input.fromStage, 'HANDOFF')) {
      return {
        stage: 'HANDOFF',
        source: 'deterministic',
        confidence: 0.95,
        reasons: ['explicit_handoff_request'],
      };
    }
    logger.warn('[assessor] Explicit handoff request but no HANDOFF transition', {
      fromStage: input.fromStage,
    });
  }

  const candidates = transitionsFrom(input.fromStage)
    .filter((t) => t.kind === 'fuzzy')
    .map((t) => t.to);

  if (candidates.length === 0) {
    return {
      stage: input.fromStage,
      source: 'deterministic',
      confidence: 1,
      reasons: ['no_fuzzy_transitions'],
    };
  }

  let decision: StageDecision;
  if (llmHook) {
    try {
      const r = await llmHook(input, candidates);
      if (r && candidates.includes(r.stage)) {
        decision = {
          stage: r.stage,
          source: 'assessor',
          confidence: Math.max(0, Math.min(1, r.confidence)),
          reasons: [r.reason],
        };
      } else {
        logger.warn('[assessor] LLM returned invalid stage, falling back', {
          returned: r?.stage,
          candidates,
        });
        decision = assessDeterministic(input, candidates);
      }
    } catch (err) {
      logger.warn('[assessor] LLM failed, using deterministic fallback', {
        error: (err as Error)?.message,
      });
      decision = assessDeterministic(input, candidates);
    }
  } else {
    decision = assessDeterministic(input, candidates);
  }

  // Active COLLECT protection also applies to the LLM-hook path: a low-confidence
  // drift away from an incomplete collection is overridden deterministically.
  if (
    input.activeCollectIntent &&
    decision.stage !== 'COLLECT' &&
    decision.stage !== 'HANDOFF' &&
    decision.confidence < 0.8
  ) {
    return {
      stage: 'COLLECT',
      source: 'deterministic',
      confidence: 0.7,
      reasons: ['assessor_active_collect_protected'],
    };
  }

  return decision;
}

/** Handoff heuristic: two consecutive low-confidence assessments. */
export function shouldSuggestHandoff(confidences: number[]): boolean {
  const last2 = confidences.slice(-2);
  return last2.length === 2 && last2.every((c) => c < 0.4);
}

/**
 * P0-1 (2026-10-02): Deterministic explicit handoff request detector.
 */
const EXPLICIT_HANDOFF_PATTERNS: RegExp[] = [
  /\b(mau|ingin|minta|mohon|tolong)\b.{0,20}\b(bicara|berbicara|ngomong|ngobrol|ketemu)\b.{0,20}\b(sama|dengan|ke)\b.{0,20}\b(orang|manusia|petugas|admin|operator|cs|kepala desa|perangkat)\w*/i,
  /\b(panggilkan|panggil|hubungi)\b.{0,20}\b(petugas|admin|operator|cs|orang|manusia|kepala desa)\w*/i,
  /\b(ngomong|bicara)\b.{0,15}\bsama\b.{0,15}\borang\b/i,
  /\b(kesal|kecewa|frustrasi|ribet|nggak jelas|tidak jelas|bodoh|lemot)\b.{0,30}\b(orang|manusia|petugas|admin)\w*/i,
];

export function isExplicitHandoffRequest(message: string): boolean {
  const text = message.trim();
  if (text.length < 5) return false;
  return EXPLICIT_HANDOFF_PATTERNS.some((re) => re.test(text));
}
