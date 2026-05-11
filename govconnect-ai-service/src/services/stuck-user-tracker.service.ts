/**
 * Stuck user detector.
 *
 * Tracks consecutive unhelpful outcomes per user. When a user has hit
 * multiple fallbacks / rewrites / tool errors in a row, we proactively
 * offer a human takeover path ("mau saya teruskan ke petugas?") instead
 * of looping into another apology template.
 *
 * This is intentionally lightweight: in-memory LRU keyed by user id.
 * No DB write — the cost of a wrong reset after an AI restart is zero,
 * while the value of catching a stuck user is immediate.
 */

import { LRUCache } from '../utils/lru-cache';
import logger from '../utils/logger';

interface StuckRecord {
  consecutiveUnhelpful: number;
  lastReason: string;
  updatedAt: number;
}

const STUCK_THRESHOLD = Math.max(2, Number(process.env.STUCK_USER_THRESHOLD || 3));
// Align with conversational state window (ump-state uses 10m, so we keep
// stuck slightly longer to span brief lulls; but resettable when state
// is cleared explicitly).
const STUCK_WINDOW_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.STUCK_USER_WINDOW_MS || 15 * 60 * 1000),
);

const stuckStore = new LRUCache<string, StuckRecord>({
  maxSize: 2000,
  ttlMs: STUCK_WINDOW_MS,
  name: 'stuck-user-tracker',
});

export type UnhelpfulReason =
  | 'fallback_error'
  | 'answer_policy_rewrite'
  | 'reconciler_rewrite'
  | 'tool_error'
  | 'retrieval_empty';

function key(userId: string, villageId?: string): string {
  return `${villageId || '_default'}:${userId}`;
}

/**
 * Record an unhelpful outcome for the user. Returns the updated counter
 * so callers can decide whether to surface an escalation offer.
 */
export function recordUnhelpful(
  userId: string,
  reason: UnhelpfulReason,
  villageId?: string,
): number {
  if (!userId) return 0;
  const k = key(userId, villageId);
  const now = Date.now();
  const existing = stuckStore.get(k);

  // Window expiration resets the counter naturally — LRU TTL does the job;
  // only increment when we're still within the window.
  const consecutive = existing ? existing.consecutiveUnhelpful + 1 : 1;
  stuckStore.set(k, {
    consecutiveUnhelpful: consecutive,
    lastReason: reason,
    updatedAt: now,
  });

  if (consecutive === STUCK_THRESHOLD) {
    logger.warn('[StuckUser] User hit unhelpful threshold', {
      userId,
      villageId,
      consecutive,
      reason,
    });
  }

  return consecutive;
}

/**
 * Reset the counter — call when the user gets a genuinely helpful
 * response (e.g., tool success + reply sent cleanly).
 */
export function recordHelpful(userId: string, villageId?: string): void {
  if (!userId) return;
  stuckStore.delete(key(userId, villageId));
}

/**
 * Query whether the user has reached the stuck threshold.
 */
export function isStuck(userId: string, villageId?: string): boolean {
  if (!userId) return false;
  const record = stuckStore.get(key(userId, villageId));
  return !!record && record.consecutiveUnhelpful >= STUCK_THRESHOLD;
}

export function getStuckCount(userId: string, villageId?: string): number {
  if (!userId) return 0;
  return stuckStore.get(key(userId, villageId))?.consecutiveUnhelpful || 0;
}

/**
 * Template to append to an otherwise-fallback reply. We don't auto-
 * trigger takeover because (a) user might just be casual-testing and
 * (b) admin might be absent; we offer the path and let user pick.
 */
export function buildStuckEscalationSuffix(): string {
  return '\n\nKalau Bapak/Ibu merasa masih buntu, balas *petugas* ya, nanti saya teruskan percakapannya ke staff desa agar dibantu langsung.';
}
