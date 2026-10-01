/**
 * P0-3 — User-facing formatter for tool results.
 *
 * A ToolCallResult is safe to hand to the LLM as structured `content`, but
 * it must NEVER be shown to the citizen raw: when a deterministic lane
 * (EMERGENCY, EXECUTE confirmation) renders a tool result directly into a
 * reply, this module picks the human-readable `suggested_response`
 * (top-level, or nested inside `data` as several tools do) and falls back
 * to a caller-supplied natural-language sentence.
 *
 * Contract: the return value is NEVER raw JSON — it is either a
 * suggested_response authored in natural language or the fallback copy.
 */

import type { ToolCallResult } from '../services/agent/tool-executor';

function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
}

/**
 * Extract the best human-readable text from a tool result for direct
 * citizen display. `fallback` is used when the result carries no
 * suggested_response (e.g. a data-only tool result).
 */
export function toolResultToUserText(
  result: ToolCallResult | undefined,
  fallback: string,
): string {
  if (!result) return fallback;
  const top = asNonEmptyString(result.suggested_response);
  if (top) return top;
  const data = result.data;
  if (data && typeof data === 'object') {
    const nested = asNonEmptyString((data as { suggested_response?: unknown }).suggested_response);
    if (nested) return nested;
  }
  return fallback;
}
