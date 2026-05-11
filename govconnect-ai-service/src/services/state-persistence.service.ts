/**
 * State Persistence Service (Temuan 7)
 *
 * Persists critical in-memory conversation state to PostgreSQL
 * so state survives service restarts.
 */

import prisma from '../lib/prisma';
import logger from '../utils/logger';
import { registerInterval } from '../utils/timer-registry';

const SESSION_TTL_MS = 10 * 60 * 1000;
const STATE_PERSIST_DEBOUNCE_MS = 250;

interface PendingStateWrite {
  waUserId: string;
  sessionKey: string;
  data: unknown;
  expiresAt: Date;
  sequence: number;
}

const statePersistTimers = new Map<string, NodeJS.Timeout>();
const pendingStateWrites = new Map<string, PendingStateWrite>();
let nextPendingStateSequence = 0;

function buildPersistKey(waUserId: string, sessionKey: string): string {
  return `${waUserId}:${sessionKey}`;
}

function clearPersistTimer(key: string): void {
  const existing = statePersistTimers.get(key);
  if (!existing) return;
  clearTimeout(existing);
  statePersistTimers.delete(key);
}

function dropBufferedState(key: string): void {
  clearPersistTimer(key);
  pendingStateWrites.delete(key);
}

async function flushPendingState(key: string): Promise<void> {
  clearPersistTimer(key);

  const pending = pendingStateWrites.get(key);
  if (!pending) {
    return;
  }

  try {
    const stateJson = JSON.stringify(pending.data);
    await prisma.conversation_sessions.upsert({
      where: {
        wa_user_id_session_key: { wa_user_id: pending.waUserId, session_key: pending.sessionKey },
      },
      update: { state_json: stateJson, expires_at: pending.expiresAt },
      create: {
        wa_user_id: pending.waUserId,
        session_key: pending.sessionKey,
        state_json: stateJson,
        expires_at: pending.expiresAt,
      },
    });

    if (pendingStateWrites.get(key)?.sequence === pending.sequence) {
      pendingStateWrites.delete(key);
    }
  } catch (e: unknown) {
    logger.warn('Failed to persist conversation state', {
      waUserId: pending.waUserId,
      sessionKey: pending.sessionKey,
      error: (e as Error).message,
    });
  }
}

function scheduleStatePersist(key: string): void {
  clearPersistTimer(key);

  const timer = setTimeout(() => {
    flushPendingState(key).catch((error: any) => {
      logger.warn('Failed to flush buffered conversation state', {
        key,
        error: error.message,
      });
    });
  }, STATE_PERSIST_DEBOUNCE_MS);

  statePersistTimers.set(key, timer);
}

function clearUserBufferedStates(waUserId: string): void {
  const prefix = `${waUserId}:`;
  const keys = new Set<string>([
    ...statePersistTimers.keys(),
    ...pendingStateWrites.keys(),
  ]);

  for (const key of keys) {
    if (key.startsWith(prefix)) {
      dropBufferedState(key);
    }
  }
}

export function persistState(waUserId: string, sessionKey: string, data: unknown): void {
  const key = buildPersistKey(waUserId, sessionKey);
  pendingStateWrites.set(key, {
    waUserId,
    sessionKey,
    data,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    sequence: ++nextPendingStateSequence,
  });
  scheduleStatePersist(key);
}

export async function loadState<T>(waUserId: string, sessionKey: string): Promise<T | null> {
  const key = buildPersistKey(waUserId, sessionKey);
  const pending = pendingStateWrites.get(key);
  if (pending) {
    return pending.data as T;
  }

  try {
    const row = await prisma.conversation_sessions.findUnique({
      where: {
        wa_user_id_session_key: { wa_user_id: waUserId, session_key: sessionKey },
      },
    });

    if (!row) return null;

    if (row.expires_at < new Date()) {
      prisma.conversation_sessions
        .delete({
          where: {
            wa_user_id_session_key: { wa_user_id: waUserId, session_key: sessionKey },
          },
        })
        .catch(() => {});
      return null;
    }

    return JSON.parse(row.state_json) as T;
  } catch (err) {
    logger.warn('Failed to load conversation state', {
      waUserId,
      sessionKey,
      error: (err as Error).message,
    });
    return null;
  }
}

export function deleteState(waUserId: string, sessionKey: string): void {
  dropBufferedState(buildPersistKey(waUserId, sessionKey));

  prisma.conversation_sessions
    .deleteMany({
      where: {
        wa_user_id: waUserId,
        session_key: sessionKey,
      },
    })
    .catch(() => {});
}

export function deleteAllUserStates(waUserId: string): void {
  clearUserBufferedStates(waUserId);

  prisma.conversation_sessions
    .deleteMany({ where: { wa_user_id: waUserId } })
    .catch(() => {});
}

function cleanupExpiredSessions(): void {
  prisma.conversation_sessions
    .deleteMany({ where: { expires_at: { lt: new Date() } } })
    .then((result: { count: number }) => {
      if (result.count > 0) {
        logger.debug(`Cleaned up ${result.count} expired conversation sessions`);
      }
    })
    .catch((e: unknown) => {
      logger.warn('Failed to cleanup expired sessions', { error: (e as Error).message });
    });
}

registerInterval(cleanupExpiredSessions, 5 * 60 * 1000, 'state-persistence-cleanup');

function resetBufferedStateForTests(): void {
  for (const timer of statePersistTimers.values()) {
    clearTimeout(timer);
  }
  statePersistTimers.clear();
  pendingStateWrites.clear();
  nextPendingStateSequence = 0;
}

export const __test_only__ = {
  STATE_PERSIST_DEBOUNCE_MS,
  flushPendingState,
  resetBufferedStateForTests,
  getBufferedStateCount: () => pendingStateWrites.size,
};

export default {
  persistState,
  loadState,
  deleteState,
  deleteAllUserStates,
};
