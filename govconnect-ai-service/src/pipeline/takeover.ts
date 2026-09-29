/**
 * Takeover manager — human-in-the-loop with TTL.
 *
 * Design (arsitektur-final §4, v4 addendum):
 * - When an admin takes over a conversation, the AI goes quiet for that user.
 * - Takeover ALWAYS has a TTL (default 30 min). It can be renewed explicitly.
 * - Expiry is lazy-evaluated on read (no cron needed): an expired takeover
 *   is treated as released.
 * - v2 keeps its own TTL state (pipeline_takeovers) AND respects the legacy
 *   channel-service flag — either one active means "human is talking".
 */

import {
  getTakeover, setTakeover, releaseTakeover,
} from './pipeline-store';
import { isUserInTakeover as legacyTakeoverCheck } from '../services/channel-client.service';
import logger from '../utils/logger';

export const DEFAULT_TAKEOVER_TTL_MS = 30 * 60 * 1000;

/** True when a human has taken over this conversation right now. */
export async function isTakeoverActive(
  tenantId: string, userId: string, channel = 'whatsapp',
): Promise<{ active: boolean; takenBy?: string; reason?: string }> {
  // v2 TTL state (primary).
  const local = await getTakeover(tenantId, userId, channel).catch(() => null);
  if (local) {
    return { active: true, takenBy: local.takenBy, reason: local.reason };
  }
  // Legacy channel-service flag (best-effort, keeps existing admin UX working).
  try {
    const legacy = await legacyTakeoverCheck(userId, tenantId || undefined);
    if (legacy) return { active: true, takenBy: 'admin', reason: 'channel-service flag' };
  } catch {
    // fall through
  }
  return { active: false };
}

/** Admin takes over: AI goes quiet until TTL or explicit release. */
export async function takeOver(
  tenantId: string, userId: string, takenBy: string, reason = '',
  ttlMs = DEFAULT_TAKEOVER_TTL_MS, channel = 'whatsapp',
): Promise<boolean> {
  const ok = await setTakeover(tenantId, userId, takenBy, reason, ttlMs, channel);
  logger.info('[takeover] taken over', { tenantId, userId, takenBy, ttlMs });
  return ok;
}

/** Admin hands the conversation back to the AI. */
export async function releaseTakeOver(
  tenantId: string, userId: string, channel = 'whatsapp',
): Promise<void> {
  await releaseTakeover(tenantId, userId, channel);
  logger.info('[takeover] released', { tenantId, userId });
}
