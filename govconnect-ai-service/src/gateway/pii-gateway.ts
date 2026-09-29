/**
 * PII Gateway — two-way PII redaction + NIK tokenization.
 *
 * Design (arsitektur-final §5.5, §9):
 * - Assume anything entering a prompt can be logged by a third party.
 * - NIK is NEVER sent raw to an LLM: it is replaced with a vault token.
 *   Tokens resolve via the persistent encrypted vault (pii-vault.ts);
 *   plaintext NIK never sits in process memory beyond the current turn's
 *   token map, and never on disk unencrypted.
 * - Redaction runs both ways: on context going IN to the model, and on
 *   text coming OUT (defense in depth against model regurgitation).
 *
 * Patterns are Indonesia-specific: 16-digit NIK, +62/08 phone numbers.
 */

import crypto from 'crypto';
import { storeTokenDirect, vaultResolveNik } from '../pipeline/pii-vault';

function mintToken(prefix: string): string {
  return `⟦${prefix}_${crypto.randomBytes(6).toString('hex')}⟧`;
}

const NIK_RE = /\b\d{16}\b/g;
const PHONE_RE = /\b(?:\+62|62|0)8\d{8,11}\b/g;
const TOKEN_RE = /⟦NIK_[0-9a-f]{12}⟧/g;

/** Redact raw PII for display/logging (one-way). */
export function redactForLog(text: string): string {
  return text
    .replace(NIK_RE, '[NIK]')
    .replace(PHONE_RE, '[PHONE]');
}

export interface TokenizeResult {
  text: string;
  /** token → original value for THIS turn (deterministic detokenize). */
  tokens: Map<string, string>;
}

/**
 * Full inbound pass: tokenize NIK + redact phone numbers before the text
 * enters any model context. Async because tokens are persisted to the
 * encrypted vault (for cross-turn resolution by deterministic code).
 */
export async function piiInbound(text: string, tenantId = ''): Promise<TokenizeResult> {
  const tokens = new Map<string, string>();
  const out = text.replace(NIK_RE, (nik) => {
    const token = mintToken('NIK');
    tokens.set(token, nik);
    return token;
  });
  // Persist tokens to the encrypted vault (best-effort; never blocks).
  await Promise.all([...tokens.entries()].map(([token, nik]) =>
    storeTokenDirect(token, nik, tenantId).catch(() => undefined),
  ));
  return { text: out.replace(PHONE_RE, '[PHONE]'), tokens };
}

/**
 * Restore vault tokens to original values — deterministic code only,
 * using the turn-local token map. For cross-turn resolution use
 * detokenizePersistent with a tenantId.
 */
export function detokenize(text: string, tokens?: Map<string, string>): string {
  if (!tokens) return text;
  let out = text;
  for (const [token, value] of tokens) {
    out = out.split(token).join(value);
  }
  return out;
}

/** Resolve any vault tokens in text via the persistent vault (tenant-scoped). */
export async function detokenizePersistent(text: string, tenantId: string): Promise<string> {
  const found = text.match(TOKEN_RE) ?? [];
  let out = text;
  for (const token of found) {
    const nik = await vaultResolveNik(token, tenantId).catch(() => null);
    out = out.split(token).join(nik ?? '[NIK:unresolved]');
  }
  return out;
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
