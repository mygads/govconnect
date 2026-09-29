/**
 * Persistent NIK vault.
 *
 * Tokens (e.g. "⟦NIK_3f9a…⟧") map to AES-256-GCM ciphertext stored in the
 * pipeline_nik_vault table. Plaintext NIK is NEVER written to disk/DB.
 *
 * Token format is canonicalized on "⟦NIK_<12 hex>⟧" (underscore) to match
 * TOKEN_RE in gateway/pii-gateway.ts, which is what detokenizePersistent
 * uses to find tokens. (An older colon variant "⟦NIK:…⟧" may exist in the
 * DB from before; vaultResolveNik looks tokens up verbatim, so those still
 * resolve — only newly minted tokens use the canonical format.)
 *
 * Key management:
 * - Key comes from NIK_VAULT_KEY (64 hex chars = 32 bytes).
 * - PRODUCTION REQUIREMENT: back this with a real KMS (rotation, audit).
 *   The env-var key is a bootstrap mechanism, not a long-term KMS.
 * - FAIL-CLOSED: call assertVaultKeyConfigured() once at startup
 *   (server.ts). Without a valid key the process refuses to start — the
 *   vault no longer degrades silently to plaintext-in-memory. An explicit
 *   degraded mode for local/dev is available ONLY via the documented env
 *   NIK_VAULT_ALLOW_INSECURE_MEMORY=true, and it is refused in production
 *   (NODE_ENV=production) even when set.
 * - Without a key or DB, the vault degrades to process memory and logs a
 *   loud warning on every use. Memory mode is NOT safe for multi-instance
 *   deployments: tokens won't resolve on another instance.
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { vaultPut, vaultGet, vaultDelete } from './pipeline-store';
import logger from '../utils/logger';

const KEY_HEX = process.env.NIK_VAULT_KEY ?? '';
const ALGO = 'aes-256-gcm';
const TOKEN_TTL_MS = Number(process.env.NIK_TOKEN_TTL_MS ?? 24 * 3600 * 1000);

let keyWarned = false;

function getKey(): Buffer | null {
  if (!/^[0-9a-fA-F]{64}$/.test(KEY_HEX)) {
    if (!keyWarned) {
      logger.warn('[nik-vault] NIK_VAULT_KEY missing/invalid — vault degraded to memory-only');
      keyWarned = true;
    }
    return null;
  }
  return Buffer.from(KEY_HEX, 'hex');
}

function encrypt(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':');
}

function decrypt(packed: string, key: Buffer): string {
  const [ivHex, tagHex, encHex] = packed.split(':');
  if (!ivHex || !tagHex || !encHex) throw new Error('malformed vault ciphertext');
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
}

// Memory fallback (single-instance only).
const memVault = new Map<string, { cipher: string; tenantId: string; expiresAt: number }>();

/** Store a plaintext NIK, return the opaque token. Plaintext never persists. */
export async function vaultStoreNik(
  plainNik: string, tenantId: string, ttlMs: number = TOKEN_TTL_MS,
): Promise<string> {
  const token = `⟦NIK_${randomBytes(6).toString('hex')}⟧`;
  const key = getKey();
  if (!key) {
    // Degraded: memory-only, plaintext never leaves the process.
    memVault.set(token, { cipher: plainNik, tenantId, expiresAt: Date.now() + ttlMs });
    logger.warn('[nik-vault] stored NIK token in MEMORY (no key/DB) — not multi-instance safe');
    return token;
  }
  const cipher = encrypt(plainNik, key);
  const persisted = await vaultPut(token, tenantId, cipher, ttlMs);
  if (!persisted) {
    memVault.set(token, { cipher, tenantId, expiresAt: Date.now() + ttlMs });
    logger.warn('[nik-vault] DB unavailable — token kept in memory fallback');
  }
  return token;
}

/** Resolve a token back to plaintext. Tenant-scoped: wrong tenant → null. */
export async function vaultResolveNik(token: string, tenantId: string): Promise<string | null> {
  const key = getKey();
  const mem = memVault.get(token);
  if (mem) {
    if (mem.expiresAt < Date.now() || mem.tenantId !== tenantId) {
      memVault.delete(token);
      return null;
    }
    if (!key) return mem.cipher; // degraded mode stored plaintext in memory
    try {
      return decrypt(mem.cipher, key);
    } catch {
      return null;
    }
  }
  if (!key) return null;
  const cipher = await vaultGet(token, tenantId);
  if (!cipher) return null;
  try {
    return decrypt(cipher, key);
  } catch (err) {
    logger.warn('[nik-vault] decrypt failed', { error: String((err as Error)?.message ?? err).slice(0, 100) });
    return null;
  }
}

/** Store a caller-minted token (used by the PII gateway's token format). */
export async function storeTokenDirect(token: string, plainNik: string, tenantId: string): Promise<void> {
  const key = getKey();
  if (!key) {
    memVault.set(token, { cipher: plainNik, tenantId, expiresAt: Date.now() + TOKEN_TTL_MS });
    logger.warn('[nik-vault] stored token in MEMORY (no key/DB) — not multi-instance safe');
    return;
  }
  const cipher = encrypt(plainNik, key);
  const persisted = await vaultPut(token, tenantId, cipher, TOKEN_TTL_MS);
  if (!persisted) {
    memVault.set(token, { cipher, tenantId, expiresAt: Date.now() + TOKEN_TTL_MS });
  }
}

/** Best-effort invalidation (e.g. after use, or user requests deletion). */
export async function vaultInvalidateNik(token: string, tenantId: string): Promise<void> {
  memVault.delete(token);
  await vaultDelete(token, tenantId);
}

/**
 * Startup guard: refuse to boot without a valid NIK vault key (fail-closed).
 *
 * Reads env dynamically (NOT the module-level KEY_HEX) so tests can set
 * env vars without re-importing the module.
 *
 * - Valid 64-hex-char NIK_VAULT_KEY → returns silently.
 * - NODE_ENV=production without a valid key → throws, always.
 * - Non-production without a valid key → throws UNLESS the operator set
 *   NIK_VAULT_ALLOW_INSECURE_MEMORY=true explicitly, in which case the
 *   vault runs in loud, documented plaintext-in-memory degraded mode.
 *   Silent degradation is gone: every path is either keyed or explicit.
 */
export function assertVaultKeyConfigured(): void {
  const key = process.env.NIK_VAULT_KEY ?? '';
  if (/^[0-9a-fA-F]{64}$/.test(key)) return;
  const insecureBypass = process.env.NIK_VAULT_ALLOW_INSECURE_MEMORY === 'true';
  const isProd = process.env.NODE_ENV === 'production';
  if (!insecureBypass || isProd) {
    throw new Error(
      '[nik-vault] NIK_VAULT_KEY missing or invalid — refusing to start. ' +
        'Set NIK_VAULT_KEY to 64 hex chars (32 bytes). For local/dev only you may ' +
        'set NIK_VAULT_ALLOW_INSECURE_MEMORY=true to explicitly accept ' +
        'plaintext-in-memory degraded mode; it is refused in production.',
    );
  }
  logger.warn(
    '[nik-vault] EXPLICIT INSECURE MODE: NIK_VAULT_ALLOW_INSECURE_MEMORY=true — ' +
      'NIK tokens are stored as PLAINTEXT in process memory. Never enable in production.',
  );
}
