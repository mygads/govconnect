/**
 * P0-3 — Outbound sanitizer: raw JSON / debug structures must NEVER reach
 * the citizen as a chat reply.
 *
 * Design:
 * - `looksLikeRawJson` detects a full-text raw JSON payload: the whole
 *   (trimmed) text parses as a JSON object/array. Mid-sentence braces in
 *   natural text ("hubungi {kantor} desa") are NOT flagged — only a whole
 *   reply that IS a JSON document.
 * - `sanitizeOutboundText` is the central guard. Wire it at every choke
 *   point where a response leaves the pipeline for the citizen
 *   (processMessageV2's R6 block). It never throws and never returns empty
 *   (never-silent): raw JSON is replaced with a natural-language copy.
 */

import logger from '../utils/logger';

/** Natural-language substitute used when a raw-JSON reply is intercepted. */
export const RAW_JSON_SUBSTITUTE_COPY =
  'Mohon maaf, ada kendala teknis saat menyiapkan jawaban. Silakan coba lagi beberapa saat, atau hubungi kantor desa langsung.';

/**
 * True when the ENTIRE text is a raw JSON document (object or array).
 * Natural-language replies that merely contain braces are not matched.
 */
export function looksLikeRawJson(text: string): boolean {
  const t = (text ?? '').trim();
  if (t.length < 2) return false;
  const first = t[0];
  const last = t[t.length - 1];
  if (!((first === '{' && last === '}') || (first === '[' && last === ']'))) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(t);
    return parsed !== null && typeof parsed === 'object';
  } catch {
    return false;
  }
}

export interface SanitizedOutbound {
  text: string;
  /** True when the original text was replaced (raw JSON or empty). */
  substituted: boolean;
}

/**
 * Central guard for citizen-facing replies. Returns the text unchanged when
 * it is natural language; substitutes raw JSON (or an empty reply) with a
 * friendly copy. Never throws, never returns an empty string.
 */
export function sanitizeOutboundText(
  text: string,
  substitute: string = RAW_JSON_SUBSTITUTE_COPY,
): SanitizedOutbound {
  const t = text ?? '';
  if (!t.trim()) {
    logger.warn('[outbound-sanitizer] empty reply intercepted — never-silent substitute');
    return { text: substitute, substituted: true };
  }
  if (looksLikeRawJson(t)) {
    logger.warn('[outbound-sanitizer] raw JSON blocked from citizen reply', {
      preview: t.slice(0, 120),
    });
    return { text: substitute, substituted: true };
  }
  return { text: t, substituted: false };
}
