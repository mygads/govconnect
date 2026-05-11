/**
 * Transactional outbox for case-service domain events.
 *
 * Problem this solves: previously we did `prisma.update(...)` then
 * `publishEvent(...)` as two separate network calls. A crash between
 * them silently lost the event, causing:
 *   - status sudah berubah di DB tapi warga tidak dikabari,
 *   - dashboard terlihat sehat walau user experience rusak.
 *
 * Pattern: every status mutation writes an `event_outbox` row inside
 * the same transaction as the entity update. A background worker
 * picks `status='pending'` rows, publishes via RabbitMQ / HTTP
 * fallback, marks them `sent`, or backoffs to retry.
 *
 * After N failed attempts the row is flipped to `status='dead'` so
 * ops can inspect + replay from an admin endpoint.
 */

import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import logger from '../utils/logger';
import { publishEvent } from './rabbitmq.service';

const MAX_ATTEMPTS = Math.max(1, Number(process.env.OUTBOX_MAX_ATTEMPTS || 10));
const BASE_BACKOFF_MS = Math.max(1_000, Number(process.env.OUTBOX_BASE_BACKOFF_MS || 5_000));
const WORKER_INTERVAL_MS = Math.max(1_000, Number(process.env.OUTBOX_WORKER_INTERVAL_MS || 5_000));
const BATCH_SIZE = Math.max(1, Number(process.env.OUTBOX_BATCH_SIZE || 20));

interface EnqueueInput {
  routingKey: string;
  payload: Record<string, unknown>;
  correlationId?: string | null;
  entityType?: 'complaint' | 'service_request' | string | null;
  entityId?: string | null;
}

/**
 * Enqueue a domain event inside a transaction. Callers MUST pass
 * a `tx` object from `prisma.$transaction(async (tx) => { ... })`
 * to keep the write atomic with the entity mutation.
 */
export async function enqueueOutboxEvent(
  tx: Prisma.TransactionClient,
  input: EnqueueInput,
): Promise<void> {
  await (tx as any).eventOutbox.create({
    data: {
      routing_key: input.routingKey,
      payload_json: input.payload as Prisma.InputJsonValue,
      correlation_id: input.correlationId ?? null,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      status: 'pending',
      attempt_count: 0,
      next_retry_at: new Date(),
    },
  });
}

function computeBackoff(attempt: number): Date {
  const jitter = Math.floor(Math.random() * 1000);
  const delay = Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt - 1), 60 * 60 * 1000) + jitter;
  return new Date(Date.now() + delay);
}

async function processOneTick(): Promise<void> {
  const now = new Date();
  let rows: any[] = [];
  try {
    rows = await (prisma as any).eventOutbox.findMany({
      where: {
        status: 'pending',
        OR: [{ next_retry_at: null }, { next_retry_at: { lte: now } }],
      },
      orderBy: { created_at: 'asc' },
      take: BATCH_SIZE,
    });
  } catch (err: any) {
    logger.warn('Outbox worker: failed to load pending rows', { error: err.message });
    return;
  }

  for (const row of rows) {
    try {
      await publishEvent(row.routing_key, row.payload_json);
      await (prisma as any).eventOutbox.update({
        where: { id: row.id },
        data: {
          status: 'sent',
          sent_at: new Date(),
          last_error: null,
        },
      });
    } catch (err: any) {
      const nextAttempt = (row.attempt_count || 0) + 1;
      const isDead = nextAttempt >= MAX_ATTEMPTS;
      try {
        await (prisma as any).eventOutbox.update({
          where: { id: row.id },
          data: {
            status: isDead ? 'dead' : 'pending',
            attempt_count: nextAttempt,
            last_error: String(err?.message || 'unknown error').slice(0, 2000),
            next_retry_at: isDead ? null : computeBackoff(nextAttempt),
          },
        });
      } catch (updateErr: any) {
        logger.error('Outbox worker: failed to mark row state', {
          id: row.id,
          error: updateErr.message,
        });
      }
      if (isDead) {
        logger.error('Outbox event moved to dead-letter', {
          id: row.id,
          routingKey: row.routing_key,
          attempts: nextAttempt,
          error: err.message,
        });
      }
    }
  }
}

let workerStarted = false;
let workerTimer: ReturnType<typeof setInterval> | null = null;

export function startOutboxWorker(): void {
  if (workerStarted) return;
  workerStarted = true;
  logger.info('Outbox worker started', {
    intervalMs: WORKER_INTERVAL_MS,
    batchSize: BATCH_SIZE,
    maxAttempts: MAX_ATTEMPTS,
  });
  workerTimer = setInterval(() => {
    processOneTick().catch((err: any) =>
      logger.error('Outbox worker tick failed', { error: err.message }),
    );
  }, WORKER_INTERVAL_MS);
  if (typeof workerTimer.unref === 'function') workerTimer.unref();
}

export function stopOutboxWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
  workerStarted = false;
}

/**
 * Admin replay: flip a dead row back to pending so the worker picks
 * it up again. Returns true if the row existed and was flipped.
 */
export async function replayOutboxEvent(id: string): Promise<boolean> {
  try {
    const result = await (prisma as any).eventOutbox.updateMany({
      where: { id, status: 'dead' },
      data: {
        status: 'pending',
        attempt_count: 0,
        next_retry_at: new Date(),
        last_error: null,
      },
    });
    return result.count > 0;
  } catch (err: any) {
    logger.warn('Outbox replay failed', { id, error: err.message });
    return false;
  }
}

export async function listOutboxEvents(filters: {
  status?: 'pending' | 'sent' | 'dead';
  routingKey?: string;
  correlationId?: string;
  limit?: number;
}): Promise<any[]> {
  const where: Record<string, unknown> = {};
  if (filters.status) where.status = filters.status;
  if (filters.routingKey) where.routing_key = filters.routingKey;
  if (filters.correlationId) where.correlation_id = filters.correlationId;
  return (prisma as any).eventOutbox.findMany({
    where,
    orderBy: { created_at: 'desc' },
    take: Math.min(Math.max(filters.limit || 50, 1), 200),
  });
}
