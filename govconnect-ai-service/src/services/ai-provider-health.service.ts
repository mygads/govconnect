import prisma from '../lib/prisma';
import logger from '../utils/logger';

/**
 * Provider health & smart routing.
 *
 * Algorithm: 3 consecutive failures → demote provider for 1 hour.
 * After cooldown, the next call is a single probe (atomic). Success resets;
 * another failure re-demotes for 1 more hour.
 *
 * In-memory cache (30s) avoids hammering the DB.
 */

export type LaneKind = 'llm' | 'embed' | 'rewrite' | 'rerank';

const FAIL_THRESHOLD = 3;
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const CACHE_TTL_MS = 30_000;

interface HealthRecord {
  providerId: string;
  laneType: LaneKind;
  consecutiveFailures: number;
  demotedUntil: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  // probe gating: when set, the next caller in this window is the probe
  probeInFlight: boolean;
  expiresAt: number;
}

const cache = new Map<string, HealthRecord>();

function key(providerId: string, lane: LaneKind): string {
  return `${providerId}:${lane}`;
}

async function loadFromDb(providerId: string, lane: LaneKind): Promise<HealthRecord> {
  let row: any = null;
  try {
    // We use $queryRaw because the prisma client may not yet be regenerated when this code first ships.
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT provider_id, lane_type, consecutive_failures, demoted_until, last_success_at, last_failure_at
       FROM ai_provider_health
       WHERE provider_id = $1 AND lane_type = $2
       LIMIT 1`,
      providerId,
      lane,
    );
    row = rows?.[0] || null;
  } catch (err: any) {
    // Table may not exist yet (migration not applied). Fail-open.
    logger.debug('ai_provider_health table not available; treating as healthy', { error: err.message });
  }

  const record: HealthRecord = {
    providerId,
    laneType: lane,
    consecutiveFailures: row?.consecutive_failures ?? 0,
    demotedUntil: row?.demoted_until ?? null,
    lastSuccessAt: row?.last_success_at ?? null,
    lastFailureAt: row?.last_failure_at ?? null,
    probeInFlight: false,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };

  cache.set(key(providerId, lane), record);
  return record;
}

async function getRecord(providerId: string, lane: LaneKind): Promise<HealthRecord> {
  const cached = cache.get(key(providerId, lane));
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }
  return loadFromDb(providerId, lane);
}

async function persistRecord(rec: HealthRecord): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO ai_provider_health
        (provider_id, lane_type, consecutive_failures, demoted_until, last_success_at, last_failure_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (provider_id, lane_type) DO UPDATE SET
         consecutive_failures = EXCLUDED.consecutive_failures,
         demoted_until = EXCLUDED.demoted_until,
         last_success_at = EXCLUDED.last_success_at,
         last_failure_at = EXCLUDED.last_failure_at,
         updated_at = NOW()`,
      rec.providerId,
      rec.laneType,
      rec.consecutiveFailures,
      rec.demotedUntil,
      rec.lastSuccessAt,
      rec.lastFailureAt,
    );
  } catch (err: any) {
    logger.warn('Failed to persist ai_provider_health row', { error: err.message, providerId: rec.providerId, lane: rec.laneType });
  }
}

export async function recordSuccess(providerId: string, lane: LaneKind): Promise<void> {
  if (!providerId) return;
  const rec = await getRecord(providerId, lane);
  rec.consecutiveFailures = 0;
  rec.demotedUntil = null;
  rec.lastSuccessAt = new Date();
  rec.probeInFlight = false;
  rec.expiresAt = Date.now() + CACHE_TTL_MS;
  cache.set(key(providerId, lane), rec);
  await persistRecord(rec);
}

export async function recordFailure(providerId: string, lane: LaneKind): Promise<void> {
  if (!providerId) return;
  const rec = await getRecord(providerId, lane);
  rec.consecutiveFailures += 1;
  rec.lastFailureAt = new Date();
  if (rec.consecutiveFailures >= FAIL_THRESHOLD) {
    rec.demotedUntil = new Date(Date.now() + COOLDOWN_MS);
    logger.warn('AI provider demoted due to consecutive failures', {
      providerId,
      lane,
      consecutiveFailures: rec.consecutiveFailures,
      demotedUntil: rec.demotedUntil.toISOString(),
    });
  }
  rec.probeInFlight = false;
  rec.expiresAt = Date.now() + CACHE_TTL_MS;
  cache.set(key(providerId, lane), rec);
  await persistRecord(rec);
}

export async function isAvailable(providerId: string, lane: LaneKind): Promise<boolean> {
  if (!providerId) return true;
  const rec = await getRecord(providerId, lane);
  if (!rec.demotedUntil) return true;
  return rec.demotedUntil.getTime() <= Date.now();
}

/**
 * Atomically returns true once when cooldown has just expired, marking the caller as the probe.
 * Subsequent callers in the same window get false until the probe records success/failure.
 */
export async function shouldProbe(providerId: string, lane: LaneKind): Promise<boolean> {
  if (!providerId) return false;
  const rec = await getRecord(providerId, lane);
  if (!rec.demotedUntil) return false;
  if (rec.demotedUntil.getTime() > Date.now()) return false;
  if (rec.probeInFlight) return false;
  rec.probeInFlight = true;
  return true;
}

export function _clearHealthCacheForTests(): void {
  cache.clear();
}
