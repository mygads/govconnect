import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import logger from '../utils/logger';

/**
 * Provider health & smart routing.
 *
 * Algorithm: 3 consecutive failures → demote provider for 1 hour.
 * After cooldown, one caller claims a 60s DB-backed probe window using row locks.
 * Success resets; another failure re-demotes for 1 more hour.
 *
 * In-memory cache (30s) avoids hammering the DB.
 */

export type LaneKind = 'llm' | 'embed' | 'rewrite' | 'rerank';

const FAIL_THRESHOLD = 3;
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const PROBE_WINDOW_MS = 60_000;
const CACHE_TTL_MS = 30_000;

interface HealthRecord {
  providerId: string;
  laneType: LaneKind;
  consecutiveFailures: number;
  demotedUntil: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  probeInFlightUntil: Date | null;
  expiresAt: number;
}

const cache = new Map<string, HealthRecord>();

function key(providerId: string, lane: LaneKind): string {
  return `${providerId}:${lane}`;
}

function asDate(value: unknown): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(String(value));
}

function isMissingHealthTableError(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== 'P2010') return false;
  const message = String((err.meta as any)?.message || err.message || '');
  return /ai_provider_health|does not exist|column .*probe_in_flight_until/i.test(message);
}

function rowToRecord(providerId: string, lane: LaneKind, row: any): HealthRecord {
  return {
    providerId,
    laneType: lane,
    consecutiveFailures: row?.consecutive_failures ?? 0,
    demotedUntil: asDate(row?.demoted_until),
    lastSuccessAt: asDate(row?.last_success_at),
    lastFailureAt: asDate(row?.last_failure_at),
    probeInFlightUntil: asDate(row?.probe_in_flight_until),
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
}

async function loadFromDb(providerId: string, lane: LaneKind): Promise<HealthRecord> {
  let row: any = null;
  try {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT provider_id, lane_type, consecutive_failures, demoted_until, last_success_at, last_failure_at, probe_in_flight_until
      FROM ai_provider_health
      WHERE provider_id = ${providerId} AND lane_type = ${lane}
      LIMIT 1
    `;
    row = rows?.[0] || null;
  } catch (err: any) {
    if (isMissingHealthTableError(err)) {
      logger.debug('ai_provider_health table or probe column not available; treating as healthy', { error: err.message });
    } else {
      logger.warn('Failed to load ai_provider_health row; treating as healthy', { error: err.message, providerId, lane });
    }
  }

  const record = rowToRecord(providerId, lane, row);
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
    await prisma.$executeRaw`
      INSERT INTO ai_provider_health
        (provider_id, lane_type, consecutive_failures, demoted_until, last_success_at, last_failure_at, probe_in_flight_until, created_at, updated_at)
      VALUES (${rec.providerId}, ${rec.laneType}, ${rec.consecutiveFailures}, ${rec.demotedUntil}, ${rec.lastSuccessAt}, ${rec.lastFailureAt}, ${rec.probeInFlightUntil}, NOW(), NOW())
      ON CONFLICT (provider_id, lane_type) DO UPDATE SET
        consecutive_failures = EXCLUDED.consecutive_failures,
        demoted_until = EXCLUDED.demoted_until,
        last_success_at = EXCLUDED.last_success_at,
        last_failure_at = EXCLUDED.last_failure_at,
        probe_in_flight_until = EXCLUDED.probe_in_flight_until,
        updated_at = NOW()
    `;
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
  rec.probeInFlightUntil = null;
  rec.expiresAt = Date.now() + CACHE_TTL_MS;
  cache.set(key(providerId, lane), rec);
  await persistRecord(rec);
}

export async function recordFailure(providerId: string, lane: LaneKind): Promise<void> {
  if (!providerId) return;
  const demotedUntil = new Date(Date.now() + COOLDOWN_MS);

  try {
    const rows = await prisma.$queryRaw<any[]>`
      INSERT INTO ai_provider_health
        (provider_id, lane_type, consecutive_failures, demoted_until, last_success_at, last_failure_at, probe_in_flight_until, created_at, updated_at)
      VALUES (${providerId}, ${lane}, 1, NULL, NULL, NOW(), NULL, NOW(), NOW())
      ON CONFLICT (provider_id, lane_type) DO UPDATE SET
        consecutive_failures = ai_provider_health.consecutive_failures + 1,
        demoted_until = CASE
          WHEN ai_provider_health.consecutive_failures + 1 >= ${FAIL_THRESHOLD} THEN ${demotedUntil}
          ELSE ai_provider_health.demoted_until
        END,
        last_failure_at = NOW(),
        probe_in_flight_until = NULL,
        updated_at = NOW()
      RETURNING provider_id, lane_type, consecutive_failures, demoted_until, last_success_at, last_failure_at, probe_in_flight_until
    `;

    const rec = rowToRecord(providerId, lane, rows?.[0]);
    cache.set(key(providerId, lane), rec);

    if (rec.consecutiveFailures >= FAIL_THRESHOLD && rec.demotedUntil) {
      logger.warn('AI provider demoted due to consecutive failures', {
        providerId,
        lane,
        consecutiveFailures: rec.consecutiveFailures,
        demotedUntil: rec.demotedUntil.toISOString(),
      });
    }
  } catch (err: any) {
    if (isMissingHealthTableError(err)) {
      logger.debug('ai_provider_health table or probe column not available; skipping failure persistence', { error: err.message });
    } else {
      logger.warn('Failed to record AI provider failure', { error: err.message, providerId, lane });
    }
  }
}

export async function isAvailable(providerId: string, lane: LaneKind): Promise<boolean> {
  if (!providerId) return true;
  const rec = await getRecord(providerId, lane);
  return !rec.demotedUntil;
}

/**
 * Best-effort cross-instance probe claim using DB row locks and a 60s probe window.
 */
export async function shouldProbe(providerId: string, lane: LaneKind): Promise<boolean> {
  if (!providerId) return false;
  const probeUntil = new Date(Date.now() + PROBE_WINDOW_MS);

  try {
    const claimed = await prisma.$transaction(async (tx: any) => {
      const rows = (await tx.$queryRaw`
        SELECT provider_id, lane_type, consecutive_failures, demoted_until, last_success_at, last_failure_at, probe_in_flight_until
        FROM ai_provider_health
        WHERE provider_id = ${providerId}
          AND lane_type = ${lane}
          AND demoted_until IS NOT NULL
          AND demoted_until <= NOW()
          AND (probe_in_flight_until IS NULL OR probe_in_flight_until < NOW())
        FOR UPDATE SKIP LOCKED
      `) as any[];

      if (!rows?.[0]) return null;

      await tx.$executeRaw`
        UPDATE ai_provider_health
        SET probe_in_flight_until = ${probeUntil}, updated_at = NOW()
        WHERE provider_id = ${providerId} AND lane_type = ${lane}
      `;

      return rowToRecord(providerId, lane, { ...rows[0], probe_in_flight_until: probeUntil });
    });

    if (!claimed) return false;
    cache.set(key(providerId, lane), claimed);
    return true;
  } catch (err: any) {
    if (isMissingHealthTableError(err)) {
      logger.debug('ai_provider_health table or probe column not available; skipping probe claim', { error: err.message });
    } else {
      logger.warn('Failed to claim AI provider probe window', { error: err.message, providerId, lane });
    }
    return false;
  }
}

export function _clearHealthCacheForTests(): void {
  cache.clear();
}
