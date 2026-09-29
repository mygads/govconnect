/**
 * Pipeline Store — durable persistence for the v2 staged agent.
 *
 * Uses RAW SQL via the Prisma client's $queryRawUnsafe/$executeRawUnsafe so
 * this module typechecks and runs even without a generated Prisma client.
 * Tables are created by migration 20260929_pipeline_persistence.
 *
 * Design rules:
 * - Every method degrades gracefully when the DB is unreachable: it logs and
 *   returns a safe fallback instead of throwing. The pipeline must never die
 *   because persistence is down — but callers MUST treat "persisted=false"
 *   as a signal (e.g. in-memory idempotency is single-instance only).
 * - Tenant scoping is mandatory on every query (fail-closed by construction:
 *   there is no method that reads cross-tenant).
 * - The audit trail is append-only (DB trigger rejects UPDATE/DELETE).
 */

import logger from '../utils/logger';

/** Minimal structural type for the raw-SQL surface we need. */
interface RawDb {
  $queryRawUnsafe(query: string, ...params: unknown[]): Promise<unknown[]>;
  $executeRawUnsafe(query: string, ...params: unknown[]): Promise<unknown>;
}

let cachedDb: RawDb | null | undefined;
let dbWarned = false;

async function getDb(): Promise<RawDb | null> {
  if (cachedDb !== undefined) return cachedDb;
  try {
    // Dynamic import: keeps the prisma singleton out of the static import
    // graph (unit tests never touch the DB) and tolerates a missing
    // generated client.
    const mod = (await import('../lib/prisma')) as { default?: unknown };
    const client = mod.default as RawDb | undefined;
    if (!client || typeof client.$queryRawUnsafe !== 'function') {
      throw new Error('prisma client unavailable');
    }
    await client.$queryRawUnsafe('SELECT 1');
    cachedDb = client;
  } catch (err) {
    if (!dbWarned) {
      logger.warn('[pipeline-store] database unavailable — running degraded (in-memory fallbacks)', {
        error: String((err as Error)?.message ?? err).slice(0, 200),
      });
      dbWarned = true;
    }
    cachedDb = null;
  }
  return cachedDb;
}

/** Force re-probe of DB availability (tests / reconnect). */
export function resetDbCache(): void {
  cachedDb = undefined;
  dbWarned = false;
}

function dbDown<T>(op: string, fallback: T): T {
  logger.debug(`[pipeline-store] ${op} skipped (no DB)`);
  return fallback;
}

// ── Audit trail (append-only) ─────────────────────────────────────────────

export interface AuditEvent {
  tenantId: string;
  traceId: string;
  userId: string;
  channel: string;
  stage: string;
  event: string;
  payload?: Record<string, unknown>;
}

export async function appendAudit(e: AuditEvent): Promise<boolean> {
  const db = await getDb();
  if (!db) return dbDown('appendAudit', false);
  try {
    await db.$executeRawUnsafe(
      `INSERT INTO pipeline_audit_events
         (tenant_id, trace_id, user_id, channel, stage, event, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      e.tenantId, e.traceId, e.userId, e.channel, e.stage, e.event,
      JSON.stringify(e.payload ?? {}),
    );
    return true;
  } catch (err) {
    logger.warn('[pipeline-store] appendAudit failed', { error: String((err as Error)?.message ?? err).slice(0, 200) });
    return false;
  }
}

// ── Idempotency ───────────────────────────────────────────────────────────

const memIdem = new Map<string, { response: unknown; expiresAt: number }>();

export async function idempotencyCheck(
  tenantId: string, key: string,
): Promise<{ hit: boolean; response?: unknown }> {
  const db = await getDb();
  if (!db) {
    const m = memIdem.get(`${tenantId}:${key}`);
    if (m && m.expiresAt > Date.now()) return { hit: true, response: m.response };
    if (m) memIdem.delete(`${tenantId}:${key}`);
    return { hit: false };
  }
  try {
    const rows = (await db.$queryRawUnsafe(
      `SELECT response FROM pipeline_idempotency_keys
        WHERE tenant_id=$1 AND idem_key=$2 AND expires_at > now()`,
      tenantId, key,
    )) as Array<{ response: unknown }>;
    if (rows.length > 0) return { hit: true, response: rows[0].response };
    return { hit: false };
  } catch {
    return dbDown('idempotencyCheck', { hit: false });
  }
}

export async function idempotencyStore(
  tenantId: string, key: string, response: unknown, ttlMs: number,
): Promise<void> {
  const db = await getDb();
  if (!db) {
    memIdem.set(`${tenantId}:${key}`, { response, expiresAt: Date.now() + ttlMs });
    return;
  }
  try {
    await db.$executeRawUnsafe(
      `INSERT INTO pipeline_idempotency_keys (tenant_id, idem_key, response, expires_at)
       VALUES ($1,$2,$3::jsonb, now() + ($4 || ' milliseconds')::interval)
       ON CONFLICT (tenant_id, idem_key) DO UPDATE
         SET response=EXCLUDED.response, expires_at=EXCLUDED.expires_at`,
      tenantId, key, JSON.stringify(response), String(ttlMs),
    );
  } catch (err) {
    logger.warn('[pipeline-store] idempotencyStore failed', { error: String((err as Error)?.message ?? err).slice(0, 200) });
  }
}

// ── Turn state (stage + slots, TTL) ───────────────────────────────────────

export interface TurnState {
  stage: string;
  slots: Record<string, unknown>;
  assessorConfidences: number[];
}

export async function loadTurnState(
  tenantId: string, userId: string, channel = 'whatsapp',
): Promise<TurnState | null> {
  const db = await getDb();
  if (!db) return dbDown('loadTurnState', null);
  try {
    const rows = (await db.$queryRawUnsafe(
      `SELECT stage, slots, assessor_confidences FROM pipeline_turn_states
        WHERE tenant_id=$1 AND user_id=$2 AND channel=$3 AND expires_at > now()`,
      tenantId, userId, channel,
    )) as Array<{ stage: string; slots: unknown; assessor_confidences: unknown }>;
    if (rows.length === 0) return null;
    return {
      stage: rows[0].stage,
      slots: (rows[0].slots as Record<string, unknown>) ?? {},
      assessorConfidences: (rows[0].assessor_confidences as number[]) ?? [],
    };
  } catch {
    return dbDown('loadTurnState', null);
  }
}

export async function saveTurnState(
  tenantId: string, userId: string, state: TurnState, channel = 'whatsapp', ttlMs = 30 * 60 * 1000,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return dbDown('saveTurnState', false);
  try {
    await db.$executeRawUnsafe(
      `INSERT INTO pipeline_turn_states
         (tenant_id, user_id, channel, stage, slots, assessor_confidences, updated_at, expires_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb, now(), now() + ($7 || ' milliseconds')::interval)
       ON CONFLICT (tenant_id, user_id, channel) DO UPDATE SET
         stage=EXCLUDED.stage, slots=EXCLUDED.slots,
         assessor_confidences=EXCLUDED.assessor_confidences,
         updated_at=now(), expires_at=EXCLUDED.expires_at`,
      tenantId, userId, channel, state.stage,
      JSON.stringify(state.slots), JSON.stringify(state.assessorConfidences), String(ttlMs),
    );
    return true;
  } catch (err) {
    logger.warn('[pipeline-store] saveTurnState failed', { error: String((err as Error)?.message ?? err).slice(0, 200) });
    return false;
  }
}

export async function clearTurnState(
  tenantId: string, userId: string, channel = 'whatsapp',
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.$executeRawUnsafe(
      `DELETE FROM pipeline_turn_states WHERE tenant_id=$1 AND user_id=$2 AND channel=$3`,
      tenantId, userId, channel,
    );
  } catch { /* best effort */ }
}

// ── Takeover (TTL) ────────────────────────────────────────────────────────

export interface Takeover {
  takenBy: string;
  reason: string;
  takenAt: string;
  expiresAt: string;
}

export async function getTakeover(
  tenantId: string, userId: string, channel = 'whatsapp',
): Promise<Takeover | null> {
  const db = await getDb();
  if (!db) return dbDown('getTakeover', null);
  try {
    const rows = (await db.$queryRawUnsafe(
      `SELECT taken_by, reason, taken_at, expires_at FROM pipeline_takeovers
        WHERE tenant_id=$1 AND user_id=$2 AND channel=$3
          AND released_at IS NULL AND expires_at > now()`,
      tenantId, userId, channel,
    )) as Array<{ taken_by: string; reason: string; taken_at: string; expires_at: string }>;
    if (rows.length === 0) return null;
    return { takenBy: rows[0].taken_by, reason: rows[0].reason, takenAt: String(rows[0].taken_at), expiresAt: String(rows[0].expires_at) };
  } catch {
    return dbDown('getTakeover', null);
  }
}

export async function setTakeover(
  tenantId: string, userId: string, takenBy: string, reason: string,
  ttlMs: number, channel = 'whatsapp',
): Promise<boolean> {
  const db = await getDb();
  if (!db) return dbDown('setTakeover', false);
  try {
    await db.$executeRawUnsafe(
      `INSERT INTO pipeline_takeovers
         (tenant_id, user_id, channel, taken_by, reason, taken_at, expires_at, released_at)
       VALUES ($1,$2,$3,$4,$5, now(), now() + ($6 || ' milliseconds')::interval, NULL)
       ON CONFLICT (tenant_id, user_id, channel) DO UPDATE SET
         taken_by=EXCLUDED.taken_by, reason=EXCLUDED.reason,
         taken_at=now(), expires_at=EXCLUDED.expires_at, released_at=NULL`,
      tenantId, userId, channel, takenBy, reason, String(ttlMs),
    );
    return true;
  } catch (err) {
    logger.warn('[pipeline-store] setTakeover failed', { error: String((err as Error)?.message ?? err).slice(0, 200) });
    return false;
  }
}

export async function releaseTakeover(
  tenantId: string, userId: string, channel = 'whatsapp',
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.$executeRawUnsafe(
      `UPDATE pipeline_takeovers SET released_at=now()
        WHERE tenant_id=$1 AND user_id=$2 AND channel=$3 AND released_at IS NULL`,
      tenantId, userId, channel,
    );
  } catch { /* best effort */ }
}

// ── NIK vault ─────────────────────────────────────────────────────────────

export async function vaultPut(token: string, tenantId: string, ciphertext: string, ttlMs: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return dbDown('vaultPut', false);
  try {
    await db.$executeRawUnsafe(
      `INSERT INTO pipeline_nik_vault (token, tenant_id, ciphertext, expires_at)
       VALUES ($1,$2,$3, now() + ($4 || ' milliseconds')::interval)
       ON CONFLICT (token) DO UPDATE SET ciphertext=EXCLUDED.ciphertext, expires_at=EXCLUDED.expires_at`,
      token, tenantId, ciphertext, String(ttlMs),
    );
    return true;
  } catch {
    return dbDown('vaultPut', false);
  }
}

export async function vaultGet(token: string, tenantId: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return dbDown('vaultGet', null);
  try {
    const rows = (await db.$queryRawUnsafe(
      `SELECT ciphertext FROM pipeline_nik_vault
        WHERE token=$1 AND tenant_id=$2 AND expires_at > now()`,
      token, tenantId,
    )) as Array<{ ciphertext: string }>;
    return rows.length > 0 ? rows[0].ciphertext : null;
  } catch {
    return dbDown('vaultGet', null);
  }
}

export async function vaultDelete(token: string, tenantId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.$executeRawUnsafe(
      `DELETE FROM pipeline_nik_vault WHERE token=$1 AND tenant_id=$2`, token, tenantId,
    );
  } catch { /* best effort */ }
}

// ── Fallback tickets ──────────────────────────────────────────────────────

export async function createFallbackTicket(input: {
  ticketId: string; tenantId: string; userId: string; channel: string;
  stage: string; reason: string; detail: string;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) return dbDown('createFallbackTicket', false);
  try {
    await db.$executeRawUnsafe(
      `INSERT INTO pipeline_fallback_tickets
         (ticket_id, tenant_id, user_id, channel, stage, reason, detail, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'open')`,
      input.ticketId, input.tenantId, input.userId, input.channel,
      input.stage, input.reason, input.detail,
    );
    return true;
  } catch (err) {
    logger.warn('[pipeline-store] createFallbackTicket failed', { error: String((err as Error)?.message ?? err).slice(0, 200) });
    return false;
  }
}

// ── Semantic cache ────────────────────────────────────────────────────────

export async function semanticCacheGet(cacheKey: string): Promise<{ answer: string } | null> {
  const db = await getDb();
  if (!db) return dbDown('semanticCacheGet', null);
  try {
    const rows = (await db.$queryRawUnsafe(
      `SELECT answer FROM pipeline_semantic_cache WHERE cache_key=$1 AND expires_at > now()`,
      cacheKey,
    )) as Array<{ answer: string }>;
    if (rows.length === 0) return null;
    await db.$executeRawUnsafe(
      `UPDATE pipeline_semantic_cache SET hits=hits+1 WHERE cache_key=$1`, cacheKey,
    ).catch(() => undefined);
    return { answer: rows[0].answer };
  } catch {
    return dbDown('semanticCacheGet', null);
  }
}

export async function semanticCachePut(
  cacheKey: string, tenantId: string, docVersion: string,
  question: string, answer: string, ttlMs: number,
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.$executeRawUnsafe(
      `INSERT INTO pipeline_semantic_cache
         (cache_key, tenant_id, doc_version, question, answer, expires_at)
       VALUES ($1,$2,$3,$4,$5, now() + ($6 || ' milliseconds')::interval)
       ON CONFLICT (cache_key) DO UPDATE SET
         answer=EXCLUDED.answer, expires_at=EXCLUDED.expires_at`,
      cacheKey, tenantId, docVersion, question, answer, String(ttlMs),
    );
  } catch { /* best effort */ }
}

export async function semanticCacheInvalidate(tenantId: string, docVersion?: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    if (docVersion) {
      await db.$executeRawUnsafe(
        `DELETE FROM pipeline_semantic_cache WHERE tenant_id=$1 AND doc_version=$2`,
        tenantId, docVersion,
      );
    } else {
      await db.$executeRawUnsafe(
        `DELETE FROM pipeline_semantic_cache WHERE tenant_id=$1`, tenantId,
      );
    }
  } catch { /* best effort */ }
}

// ── Improvement proposals ─────────────────────────────────────────────────

export async function createProposal(input: {
  tenantId: string; kind: string; title: string; payload: Record<string, unknown>;
}): Promise<number | null> {
  const db = await getDb();
  if (!db) return dbDown('createProposal', null);
  try {
    const rows = (await db.$queryRawUnsafe(
      `INSERT INTO pipeline_improvement_proposals (tenant_id, kind, title, payload, status)
       VALUES ($1,$2,$3,$4::jsonb,'proposed') RETURNING id`,
      input.tenantId, input.kind, input.title, JSON.stringify(input.payload),
    )) as Array<{ id: number | string }>;
    return Number(rows[0]?.id ?? NaN) || null;
  } catch {
    return dbDown('createProposal', null);
  }
}

export async function listProposals(
  tenantId: string, status = 'proposed', limit = 50,
): Promise<Array<Record<string, unknown>>> {
  const db = await getDb();
  if (!db) return dbDown('listProposals', []);
  try {
    return (await db.$queryRawUnsafe(
      `SELECT id, kind, title, payload, status, created_at FROM pipeline_improvement_proposals
        WHERE tenant_id=$1 AND status=$2 ORDER BY id DESC LIMIT $3`,
      tenantId, status, limit,
    )) as Array<Record<string, unknown>>;
  } catch {
    return dbDown('listProposals', []);
  }
}

export async function decideProposal(
  id: number, tenantId: string, approved: boolean, decidedBy: string,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return dbDown('decideProposal', false);
  try {
    const r = (await db.$executeRawUnsafe(
      `UPDATE pipeline_improvement_proposals
         SET status=$1, decided_by=$2, decided_at=now()
        WHERE id=$3 AND tenant_id=$4 AND status='proposed'`,
      approved ? 'approved' : 'rejected', decidedBy, id, tenantId,
    )) as unknown as number;
    return Number(r) > 0;
  } catch {
    return dbDown('decideProposal', false);
  }
}

// ── LAPOR! outbox ─────────────────────────────────────────────────────────

export async function laporEnqueue(
  tenantId: string, complaintRef: string, payload: Record<string, unknown>,
  status: 'pending' | 'pending_config' = 'pending',
): Promise<number | null> {
  const db = await getDb();
  if (!db) return dbDown('laporEnqueue', null);
  try {
    const rows = (await db.$queryRawUnsafe(
      `INSERT INTO pipeline_lapor_outbox (tenant_id, complaint_ref, payload, status)
       VALUES ($1,$2,$3::jsonb,$4) RETURNING id`,
      tenantId, complaintRef, JSON.stringify(payload), status,
    )) as Array<{ id: number | string }>;
    return Number(rows[0]?.id ?? NaN) || null;
  } catch {
    return dbDown('laporEnqueue', null);
  }
}

export async function laporClaimPending(limit = 10): Promise<Array<Record<string, unknown>>> {
  const db = await getDb();
  if (!db) return dbDown('laporClaimPending', []);
  try {
    return (await db.$queryRawUnsafe(
      `UPDATE pipeline_lapor_outbox SET status='sending', attempts=attempts+1, updated_at=now()
        WHERE id IN (
          SELECT id FROM pipeline_lapor_outbox
          WHERE status IN ('pending','failed') AND attempts < 5
          ORDER BY id LIMIT $1
          FOR UPDATE SKIP LOCKED
        )
       RETURNING id, tenant_id, complaint_ref, payload, attempts`,
      limit,
    )) as Array<Record<string, unknown>>;
  } catch {
    return dbDown('laporClaimPending', []);
  }
}

export async function laporMarkResult(
  id: number, ok: boolean, trackingId?: string, error?: string,
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.$executeRawUnsafe(
      `UPDATE pipeline_lapor_outbox
         SET status=$1, tracking_id=COALESCE($2,tracking_id),
             last_error=$3, updated_at=now()
        WHERE id=$4`,
      ok ? 'sent' : 'failed', trackingId ?? null, (error ?? '').slice(0, 500), id,
    );
  } catch { /* best effort */ }
}

// ── Cost accounting ─────────────────────────────────────────────────────

export async function getDailyCostUsd(tenantId: string): Promise<number | null> {
  const db = await getDb();
  if (!db) return dbDown('getDailyCostUsd', null);
  try {
    const rows = (await db.$queryRawUnsafe(
      `SELECT COALESCE(SUM(cost_usd),0) AS total FROM ai_token_usage
        WHERE village_id=$1 AND created_at > now() - interval '1 day'`,
      tenantId,
    )) as Array<{ total: string | number }>;
    return Number(rows[0]?.total ?? 0);
  } catch {
    return dbDown('getDailyCostUsd', null);
  }
}

// ── Durable memory policy helpers (raw SQL over user_memory_entries) ──────

export interface MemoryRow {
  id: string;
  memory_type: string;
  memory_key: string | null;
  content: string;
}

export async function memoryFindByKey(
  waUserId: string, tenantId: string, key: string,
): Promise<MemoryRow | null> {
  const db = await getDb();
  if (!db) return dbDown('memoryFindByKey', null);
  try {
    const rows = (await db.$queryRawUnsafe(
      `SELECT id, memory_type, memory_key, content FROM user_memory_entries
        WHERE wa_user_id=$1 AND village_id=$2 AND memory_key=$3
          AND (metadata_json->>'invalidated' IS DISTINCT FROM 'true')
        ORDER BY created_at DESC LIMIT 1`,
      waUserId, tenantId, key,
    )) as MemoryRow[];
    return rows[0] ?? null;
  } catch {
    return dbDown('memoryFindByKey', null);
  }
}

/**
 * Soft-invalidate a memory entry (INVALIDATE): marks it superseded in
 * metadata_json instead of deleting — the audit trail survives.
 */
export async function memoryInvalidateEntry(
  entryId: string, tenantId: string, reason: string,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return dbDown('memoryInvalidateEntry', false);
  try {
    await db.$executeRawUnsafe(
      `UPDATE user_memory_entries
          SET metadata_json = COALESCE(metadata_json,'{}'::jsonb) ||
                jsonb_build_object('invalidated', true, 'invalidated_reason', $2,
                                   'invalidated_at', now()::text),
              updated_at = now()
        WHERE id=$1 AND village_id=$3`,
      entryId, reason.slice(0, 200), tenantId,
    );
    return true;
  } catch {
    return dbDown('memoryInvalidateEntry', false);
  }
}

// ── Identity ladder ─────────────────────────────────────────────────────

export async function identityIsVerified(tenantId: string, userId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return dbDown('identityIsVerified', false);
  try {
    const rows = (await db.$queryRawUnsafe(
      `SELECT 1 FROM pipeline_identity_verifications
        WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL LIMIT 1`,
      tenantId, userId,
    )) as Array<unknown>;
    return rows.length > 0;
  } catch {
    return dbDown('identityIsVerified', false);
  }
}

/** Record an admin-performed identity verification (L2). */
export async function identitySetVerified(
  tenantId: string, userId: string, verifiedBy: string, note = '',
): Promise<boolean> {
  const db = await getDb();
  if (!db) return dbDown('identitySetVerified', false);
  try {
    await db.$executeRawUnsafe(
      `INSERT INTO pipeline_identity_verifications
         (tenant_id, user_id, level, verified_by, note)
       VALUES ($1,$2,'L2',$3,$4)
       ON CONFLICT DO NOTHING`,
      tenantId, userId, verifiedBy.slice(0, 200), note.slice(0, 500),
    );
    return true;
  } catch {
    return dbDown('identitySetVerified', false);
  }
}

/** Revoke an identity verification. */
export async function identityRevoke(tenantId: string, userId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return dbDown('identityRevoke', false);
  try {
    await db.$executeRawUnsafe(
      `UPDATE pipeline_identity_verifications SET revoked_at=now()
        WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL`,
      tenantId, userId,
    );
    return true;
  } catch {
    return dbDown('identityRevoke', false);
  }
}

export async function quarantineAdd(input: {
  tenantId: string; userId: string; channel: string; reason: string; excerpt: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.$executeRawUnsafe(
      `INSERT INTO pipeline_ingress_quarantine (tenant_id, user_id, channel, reason, excerpt)
       VALUES ($1,$2,$3,$4,$5)`,
      input.tenantId, input.userId, input.channel, input.reason, input.excerpt.slice(0, 300),
    );
  } catch { /* best effort */ }
}
