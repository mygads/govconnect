/**
 * Eval harness — shared case types.
 *
 * A case is a small async function that drives ONE slice of the pipeline
 * (slot FSM, assessor, confirmation chain, staged agent with a scripted LLM,
 * fallback policy, …) and asserts the expected outcome with `check()`.
 *
 * Cases must be deterministic: the LLM is never called for real. Tool-use
 * cases script the LLM via `mockCallLlm()` (see support.ts). Cases that
 * genuinely need a live LLM set `liveLLM: true` and are skipped by default —
 * the runner reports them as SKIP, never silently.
 */
export type EvalCategory =
  | 'intent-classification'
  | 'multi-turn'
  | 'tool-use'
  | 'fallback'
  | 'anaphora'
  | 'correction'
  | 'live-llm';

export interface EvalCase {
  /** Stable id, e.g. "EVAL-I01". */
  id: string;
  category: EvalCategory;
  /** Primary user input (first turn) — shown in reports. */
  input: string;
  /** Human-readable expectation — shown in reports. */
  expect: string;
  description: string;
  /** True → needs a real LLM; skipped by default, reported as SKIP. */
  liveLLM?: boolean;
  skipReason?: string;
  /** Throw (or fail a `check`) on mismatch; resolve silently on pass. */
  run: () => Promise<void>;
}
