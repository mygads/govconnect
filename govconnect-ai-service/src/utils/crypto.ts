import crypto from 'crypto';
import logger from './logger';

/**
 * AES-256-GCM at-rest encryption for provider API keys.
 *
 * Format: v1:<iv_hex>:<authtag_hex>:<cipher_hex>
 *
 * Key source (in order):
 *   1. AI_PROVIDER_ENCRYPTION_KEY
 *   2. PROFILE_ENCRYPTION_KEY (fallback for environments that already provision this)
 *
 * Key encoding: hex (64 chars), base64 (44 chars), or raw 32-byte string.
 */

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const VERSION = 'v1';

let cachedKey: Buffer | null = null;
let legacyWarned = false;
let missingKeyWarned = false;

function loadKey(): Buffer | null {
  if (cachedKey) return cachedKey;

  const raw = (process.env.AI_PROVIDER_ENCRYPTION_KEY || process.env.PROFILE_ENCRYPTION_KEY || '').trim();
  if (!raw) {
    if (!missingKeyWarned) {
      logger.warn('AI_PROVIDER_ENCRYPTION_KEY (and PROFILE_ENCRYPTION_KEY) not set; provider keys will be stored as plaintext. This is unsafe for production.');
      missingKeyWarned = true;
    }
    return null;
  }

  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else if (/^[A-Za-z0-9+/=]{43,}={0,2}$/.test(raw)) {
    const decoded = Buffer.from(raw, 'base64');
    key = decoded.length === 32 ? decoded : Buffer.from(raw.padEnd(32, '0').slice(0, 32), 'utf8');
  } else {
    key = Buffer.from(raw.padEnd(32, '0').slice(0, 32), 'utf8');
  }

  if (key.length !== 32) {
    throw new Error('AI_PROVIDER_ENCRYPTION_KEY must decode to 32 bytes (use 64-char hex or 44-char base64)');
  }

  cachedKey = key;
  return cachedKey;
}

export function isCiphertext(value: string): boolean {
  return typeof value === 'string' && value.startsWith(`${VERSION}:`);
}

/**
 * Encrypt a plaintext secret. Returns formatted ciphertext string `v1:iv:tag:cipher`.
 * If no encryption key is configured, returns plaintext unchanged with a warning logged.
 */
export function encryptSecret(plain: string): string {
  if (!plain) return plain;
  if (isCiphertext(plain)) return plain;

  const key = loadKey();
  if (!key) {
    return plain;
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a stored secret. Auto-detects legacy plaintext (no `v1:` prefix) and
 * returns it unchanged after logging a one-shot warning.
 */
export function decryptSecret(blob: string | null | undefined): string {
  if (!blob) return '';
  if (!isCiphertext(blob)) {
    if (!legacyWarned) {
      logger.warn('Detected legacy plaintext provider key. Run scripts/encrypt-existing-provider-keys.ts to migrate.');
      legacyWarned = true;
    }
    return blob;
  }

  const key = loadKey();
  if (!key) {
    throw new Error('Cannot decrypt provider key: AI_PROVIDER_ENCRYPTION_KEY is not configured');
  }

  const parts = blob.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Invalid encrypted secret format');
  }

  const iv = Buffer.from(parts[1], 'hex');
  const tag = Buffer.from(parts[2], 'hex');
  const cipherText = Buffer.from(parts[3], 'hex');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(cipherText), decipher.final()]);
  return plain.toString('utf8');
}

/** Reset internal cache; primarily for tests. */
export function _resetCryptoCacheForTests(): void {
  cachedKey = null;
  legacyWarned = false;
  missingKeyWarned = false;
}

/**
 * Scrub secrets from arbitrary text before logging.
 * Replaces Bearer tokens and known key prefixes (sk-, or-, gw-) with masked placeholders.
 */
export function scrubSecrets(text: string): string {
  if (!text) return text;
  return text
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer ***')
    .replace(/\b(sk|or|gw|sumo)-[A-Za-z0-9_\-]{8,}/g, '$1-***')
    .replace(/"api[_-]?key"\s*:\s*"[^"]+"/gi, '"api_key":"***"');
}
