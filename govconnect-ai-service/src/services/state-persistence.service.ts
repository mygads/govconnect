/**
 * State Persistence Service (Temuan 7)
 *
 * Persists critical in-memory conversation state to PostgreSQL
 * so state survives service restarts.
 *
 * Strategy:
 * - Fire-and-forget writes (don't block message processing)
 * - Load on cache-miss (lazy hydration)
 * - Auto-cleanup expired sessions
 */

import prisma from '../lib/prisma';
import logger from '../utils/logger';
import { registerInterval } from '../utils/timer-registry';

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes (matches LRU cache TTL)

/**
 * Save a conversation session state to DB (fire-and-forget).
 */
export function persistState(waUserId: string, sessionKey: string, data: unknown): void {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const stateJson = JSON.stringify(data);

  prisma.conversation_sessions
    .upsert({
      where: {
        wa_user_id_session_key: { wa_user_id: waUserId, session_key: sessionKey },
      },
      update: { state_json: stateJson, expires_at: expiresAt },
      create: {
        wa_user_id: waUserId,
        session_key: sessionKey,
        state_json: stateJson,
        expires_at: expiresAt,
      },
    })
    .catch((e: unknown) => {
      logger.warn('Failed to persist conversation state', {
        waUserId,
        sessionKey,
        error: (e as Error).message,
      });
    });
}

/**
 * Load a conversation session state from DB.
 * Returns null if not found or expired.
 */
export async function loadState<T>(waUserId: string, sessionKey: string): Promise<T | null> {
  try {
    const row = await prisma.conversation_sessions.findUnique({
      where: {
        wa_user_id_session_key: { wa_user_id: waUserId, session_key: sessionKey },
      },
    });

    if (!row) return null;

    // Check expiry
    if (row.expires_at < new Date()) {
      // Cleanup expired row (fire-and-forget)
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

/**
 * Delete a conversation session state from DB (fire-and-forget).
 */
export function deleteState(waUserId: string, sessionKey: string): void {
  prisma.conversation_sessions
    .delete({
      where: {
        wa_user_id_session_key: { wa_user_id: waUserId, session_key: sessionKey },
      },
    })
    .catch(() => {}); // Ignore if not found
}

/**
 * Delete all conversation states for a user (fire-and-forget).
 */
export function deleteAllUserStates(waUserId: string): void {
  prisma.conversation_sessions
    .deleteMany({ where: { wa_user_id: waUserId } })
    .catch(() => {});
}

/**
 * Cleanup expired sessions periodically.
 */
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

// Run cleanup every 5 minutes
registerInterval(cleanupExpiredSessions, 5 * 60 * 1000, 'state-persistence-cleanup');

export default {
  persistState,
  loadState,
  deleteState,
  deleteAllUserStates,
};
