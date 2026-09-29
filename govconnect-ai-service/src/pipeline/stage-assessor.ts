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
  // Status intent → STATUS_CHECK
  bump('STATUS_CHECK', /\b(status|cek|lacak|sudah|progress)\b/, 2);
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

  if (llmHook) {
    try {
      const r = await llmHook(input, candidates);
      if (r && candidates.includes(r.stage)) {
        return {
          stage: r.stage,
          source: 'assessor',
          confidence: Math.max(0, Math.min(1, r.confidence)),
          reasons: [r.reason],
        };
      }
      logger.warn('[assessor] LLM returned invalid stage, falling back', {
        returned: r?.stage,
        candidates,
      });
    } catch (err) {
      logger.warn('[assessor] LLM failed, using deterministic fallback', {
        error: (err as Error)?.message,
      });
    }
  }

  return assessDeterministic(input, candidates);
}

/** Handoff heuristic: two consecutive low-confidence assessments. */
export function shouldSuggestHandoff(confidences: number[]): boolean {
  const last2 = confidences.slice(-2);
  return last2.length === 2 && last2.every((c) => c < 0.4);
}
