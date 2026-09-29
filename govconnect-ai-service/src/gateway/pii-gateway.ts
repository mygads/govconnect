/**
 * PII Gateway — two-way PII redaction + NIK tokenization.
 *
 * Design (arsitektur-final §5.5, §9):
 * - Assume anything entering a prompt can be logged by a third party.
 * - NIK is NEVER sent raw to an LLM: it is replaced with a vault token;
 *   detokenization happens only in deterministic code paths that need it.
 * - Redaction runs both ways: on context going IN to the model, and on
 *   text coming OUT (defense in depth against model regurgitation).
 *
 * Patterns are Indonesia-specific: 16-digit NIK, +62/08 phone numbers.
 */

import crypto from 'crypto';

/** In-memory token vault. Replace with a persistent KMS-backed vault in prod. */
const tokenVault = new Map<string, string>();

function mintToken(prefix: string): string {
  return `⟦${prefix}_${crypto.randomBytes(6).toString('hex')}⟧`;
}

const NIK_RE = /\b\d{16}\b/g;
const PHONE_RE = /\b(?:\+62|62|0)8\d{8,11}\b/g;

/** Redact raw PII for display/logging (one-way). */
export function redactForLog(text: string): string {
  return text
    .replace(NIK_RE, '[NIK]')
    .replace(PHONE_RE, '[PHONE]');
}

export interface TokenizeResult {
  text: string;
  /** token → original value, for the deterministic detokenize step. */
  tokens: Map<string, string>;
}

/**
 * Replace NIK occurrences with vault tokens. The LLM only ever sees tokens.
 * Call `detokenize` in deterministic code before persisting/sending.
 */
export function tokenizeNIK(text: string): TokenizeResult {
  const tokens = new Map<string, string>();
  const out = text.replace(NIK_RE, (nik) => {
    const token = mintToken('NIK');
    tokens.set(token, nik);
    tokenVault.set(token, nik);
    return token;
  });
  return { text: out, tokens };
}

/** Restore vault tokens to original values (deterministic code only). */
export function detokenize(text: string, tokens?: Map<string, string>): string {
  let out = text;
  const source = tokens ?? tokenVault;
  for (const [token, value] of source) {
    out = out.split(token).join(value);
  }
  return out;
}

/**
 * Full inbound pass: tokenize NIK + redact phone numbers before the text
 * enters any model context. Returns the safe text and the token map.
 */
export function piiInbound(text: string): TokenizeResult {
  const { text: noNik, tokens } = tokenizeNIK(text);
  return { text: noNik.replace(PHONE_RE, '[PHONE]'), tokens };
}

/**
 * Outbound pass: ensure no raw NIK/phone leaks in model output.
 * If a leak is found it is redacted AND reported (fail-closed signal).
 */
export function piiOutbound(text: string): { text: string; leaked: boolean } {
  const leaked = NIK_RE.test(text) || PHONE_RE.test(text);
  // Reset regex state (global flag) before reuse.
  NIK_RE.lastIndex = 0;
  PHONE_RE.lastIndex = 0;
  if (!leaked) return { text, leaked: false };
  return { text: redactForLog(text), leaked: true };
}

/** Clear expired vault entries. Call periodically (e.g. every 10 min). */
export function pruneTokenVault(maxEntries = 10000): void {
  if (tokenVault.size <= maxEntries) return;
  const keys = [...tokenVault.keys()];
  for (const k of keys.slice(0, keys.length - maxEntries)) tokenVault.delete(k);
}
