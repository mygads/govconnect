/**
 * R6: canary docs + token/secret leak detector.
 *
 * Threat: indirect prompt injection via uploaded KB documents
 * (EchoLeak-class, CVE-2025-32711) and cross-tenant exfiltration.
 *
 * Two honeytoken tripwires:
 * 1. OUTBOUND — a canary token must never appear in a user-facing
 *    response. processMessageV2 scans every outbound response; on a hit
 *    the response is substituted with a safe static reply and a
 *    `canary_token_leaked` audit event is written (label only — the token
 *    value never lands in logs/audit).
 * 2. INGEST — a document containing ANOTHER village's canary token is
 *    rejected: it proves exfiltration happened somewhere upstream.
 *
 * Plus a secret scanner at ingest: documents containing credentials
 * (API keys, private keys, connection strings) are rejected before any
 * vector is written — secrets must never enter the KB.
 *
 * v1 scope (honest): passive honeytoken leak detection. Active
 * instruction-canaries (fake directives testing whether the agent obeys
 * injected instructions) are future work.
 */
import crypto from 'crypto';
import logger from '../utils/logger';
import { appendAudit } from '../pipeline/pipeline-store';

// Prisma is loaded LAZILY: `../lib/prisma` pulls @prisma/client at module
// scope, which breaks unit-test environments where the generated client is
// unavailable. All DB access goes through getPrisma(); the read paths are
// fail-soft, so a missing client degrades to "no canaries" instead of
// crashing the pipeline.
type PrismaLike = {
  $queryRawUnsafe: (query: string, ...args: unknown[]) => Promise<unknown>;
  $executeRawUnsafe: (query: string, ...args: unknown[]) => Promise<unknown>;
};
async function getPrisma(): Promise<PrismaLike> {
  const mod = await import('../lib/prisma');
  return mod.default as PrismaLike;
}

// ── Token format ──────────────────────────────────────────────────────────

const CANARY_RE = /cnry_[a-z0-9]{20}/g;

/** Generate a fresh canary token. */
export function generateCanaryToken(): string {
  return `cnry_${crypto.randomBytes(15).toString('hex').slice(0, 20)}`;
}

/** Extract canary-shaped candidates from text (pure). */
export function extractCanaryCandidates(text: string): string[] {
  const m = (text ?? '').match(CANARY_RE);
  return m ? [...new Set(m)] : [];
}

/** Which of the village's tokens appear in the text (pure). */
export function scanTextForTokens(text: string, tokens: string[]): string[] {
  if (!text || tokens.length === 0) return [];
  return tokens.filter((t) => t && text.includes(t));
}

// ── Secret scanner (pure) ─────────────────────────────────────────────────

export interface SecretFinding {
  kind: string;
  count: number;
}

interface SecretPattern {
  kind: string;
  re: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
  { kind: 'aws_access_key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: 'openai_api_key', re: /\bsk-[a-zA-Z0-9]{16,}\b/ },
  { kind: 'github_token', re: /\bgh[pousr]_[a-zA-Z0-9]{20,}\b/ },
  { kind: 'google_api_key', re: /\bAIza[0-9A-Za-z\-_]{35}\b/ },
  { kind: 'slack_token', re: /\bxox[baprs]-[a-zA-Z0-9\-]{10,}\b/ },
  { kind: 'private_key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  {
    kind: 'connection_string',
    re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^/\s:]+:[^/\s@]+@[^\s]+/i,
  },
  {
    // Conservative generic: explicit key assignment only ("api_key = ..."),
    // so prose about passwords does not false-positive.
    kind: 'assigned_secret',
    re: /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b\s*[:=]\s*['"]?[^\s'"]{12,}['"]?/i,
  },
];

/**
 * Scan text for credential patterns. Returns finding kinds + counts only —
 * NEVER the matched secret values.
 */
export function scanForSecrets(text: string): SecretFinding[] {
  const src = text ?? '';
  const findings: SecretFinding[] = [];
  for (const p of SECRET_PATTERNS) {
    const global = new RegExp(p.re.source, p.re.flags.includes('g') ? p.re.flags : p.re.flags + 'g');
    let count = 0;
    let m: RegExpExecArray | null;
    while ((m = global.exec(src)) !== null) {
      count++;
      if (count >= 10) break;
      if (m[0].length === 0) break;
    }
    if (count > 0) findings.push({ kind: p.kind, count });
  }
  return findings;
}

// ── Registry (DB) ─────────────────────────────────────────────────────────

export interface CanaryRecord {
  id: string;
  token: string;
  label: string;
}

function canaryId(): string {
  return `cnryid_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

/** Register a new canary token for a village. */
export async function registerCanaryToken(villageId: string, label: string): Promise<CanaryRecord> {
  const token = generateCanaryToken();
  const id = canaryId();
  await (await getPrisma()).$executeRawUnsafe(
    `INSERT INTO ai.canary_tokens (id, village_id, token, label)
     VALUES ($1,$2,$3,$4)`,
    id, villageId, token, label,
  );
  invalidateCanaryCache(villageId);
  return { id, token, label };
}

/** All canaries for a village (internal admin view — includes token values). */
export async function listCanaryTokens(villageId: string): Promise<Array<CanaryRecord & { createdAt: string }>> {
  const rows = (await (await getPrisma()).$queryRawUnsafe(
    `SELECT id, token, label, created_at FROM ai.canary_tokens
     WHERE village_id = $1 ORDER BY created_at DESC LIMIT 100`,
    villageId,
  )) as Array<{ id: string; token: string; label: string; created_at: Date }>;
  return rows.map((r) => ({
    id: String(r.id), token: String(r.token), label: String(r.label),
    createdAt: String(r.created_at),
  }));
}

/** Which village owns this token (null when unknown). */
export async function findTokenOwner(token: string): Promise<{ villageId: string; label: string } | null> {
  const rows = (await (await getPrisma()).$queryRawUnsafe(
    `SELECT village_id, label FROM ai.canary_tokens WHERE token = $1 LIMIT 1`,
    token,
  )) as Array<{ village_id: string; label: string }>;
  if (rows.length === 0) return null;
  return { villageId: String(rows[0].village_id), label: String(rows[0].label) };
}

// ── Cache ─────────────────────────────────────────────────────────────────

interface CanaryCacheEntry {
  tokens: CanaryRecord[];
  expires: number;
}
const canaryCache = new Map<string, CanaryCacheEntry>();
const CANARY_CACHE_MS = Number(process.env.CANARY_CACHE_MS ?? 5 * 60_000);

export function invalidateCanaryCache(villageId: string): void {
  canaryCache.delete(villageId);
}

/** Cached token list for outbound scanning. Fail-soft: [] on DB error. */
export async function getCachedCanaryTokens(villageId: string): Promise<CanaryRecord[]> {
  if (!villageId) return [];
  const now = Date.now();
  const hit = canaryCache.get(villageId);
  if (hit && hit.expires > now) return hit.tokens;
  try {
    const rows = (await (await getPrisma()).$queryRawUnsafe(
      `SELECT id, token, label FROM ai.canary_tokens WHERE village_id = $1`,
      villageId,
    )) as Array<{ id: string; token: string; label: string }>;
    const tokens = rows.map((r) => ({ id: String(r.id), token: String(r.token), label: String(r.label) }));
    canaryCache.set(villageId, { tokens, expires: now + CANARY_CACHE_MS });
    return tokens;
  } catch (err) {
    logger.warn('[canary] token cache refresh failed (fail-soft)', {
      villageId, error: (err as Error)?.message ?? String(err),
    });
    return hit?.tokens ?? [];
  }
}

// ── Outbound tripwire ─────────────────────────────────────────────────────

export interface OutboundCanaryCheck {
  leaked: boolean;
  labels: string[];
}

/**
 * Check an outbound response for the village's canary tokens.
 * On a hit, writes a `canary_token_leaked` audit event with LABELS only —
 * the token value never lands in the audit trail or logs.
 */
export async function checkOutboundForCanary(
  text: string, villageId: string, traceId: string,
): Promise<OutboundCanaryCheck> {
  if (!text || !villageId) return { leaked: false, labels: [] };
  const records = await getCachedCanaryTokens(villageId);
  const matched = scanTextForTokens(text, records.map((r) => r.token));
  if (matched.length === 0) return { leaked: false, labels: [] };
  const labels = records.filter((r) => matched.includes(r.token)).map((r) => r.label);
  try {
    await appendAudit({
      tenantId: villageId,
      traceId,
      userId: '',
      channel: 'whatsapp',
      stage: 'SEND',
      event: 'canary_token_leaked',
      payload: { labels, matched_count: matched.length },
    });
  } catch (err) {
    logger.warn('[canary] leak audit failed', { error: (err as Error)?.message ?? String(err) });
  }
  logger.error('[canary] CANARY TOKEN IN OUTBOUND RESPONSE', { villageId, traceId, labels });
  return { leaked: true, labels };
}

/** Static substitution when a canary leaks — never silent, never the token. */
export const CANARY_SAFE_REPLY =
  'Mohon maaf, saya tidak dapat menampilkan informasi tersebut saat ini. ' +
  'Silakan hubungi kantor desa langsung untuk bantuan lebih lanjut.';

// ── Ingest tripwire ───────────────────────────────────────────────────────

export interface IngestCanaryVerdict {
  /** A foreign canary was found → reject the document. */
  foreignCanary: { ownerVillageId: string; label: string } | null;
}

/**
 * Check extracted document text for canary tokens owned by OTHER villages.
 * A hit proves exfiltration happened upstream — the document must not be
 * indexed. Fail-soft: on DB error, allow ingest (the outbound tripwire
 * still guards responses).
 */
export async function checkIngestForForeignCanary(
  text: string, ownVillageId: string,
): Promise<IngestCanaryVerdict> {
  const candidates = extractCanaryCandidates(text);
  if (candidates.length === 0 || !ownVillageId) return { foreignCanary: null };
  try {
    const rows = (await (await getPrisma()).$queryRawUnsafe(
      `SELECT village_id, label FROM ai.canary_tokens WHERE token = ANY($1)`,
      candidates,
    )) as Array<{ village_id: string; label: string }>;
    const foreign = rows.find((r) => String(r.village_id) !== ownVillageId);
    if (foreign) {
      return {
        foreignCanary: { ownerVillageId: String(foreign.village_id), label: String(foreign.label) },
      };
    }
    return { foreignCanary: null };
  } catch (err) {
    logger.warn('[canary] ingest foreign-canary check failed (fail-soft)', {
      error: (err as Error)?.message ?? String(err),
    });
    return { foreignCanary: null };
  }
}
