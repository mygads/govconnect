/**
 * Takeover manager — human-in-the-loop with TTL + state machine (W4).
 *
 * Design (arsitektur-final §4, v4 addendum):
 * - When an admin takes over a conversation, the AI goes quiet for that user.
 * - Takeover ALWAYS has a TTL (default 30 min). It can be renewed explicitly.
 * - Expiry is lazy-evaluated on read (no cron needed): an expired takeover
 *   is treated as released.
 * - v2 keeps its own TTL state (pipeline_takeovers) AND respects the legacy
 *   channel-service flag — either one active means "human is talking".
 *
 * W4 state machine:
 *   AI_ACTIVE → HANDOFF_PENDING → HUMAN_ACTIVE → NUDGE → (auto-handback) AI_ACTIVE
 * - HANDOFF_PENDING: handoff diminta (sistem/admin), menunggu manusia ambil alih.
 *   Timeout 15 mnt → kembali ke AI_ACTIVE.
 * - HUMAN_ACTIVE: manusia sedang bicara, AI diam. TTL 30 mnt dari aktivitas terakhir.
 * - NUDGE: 30 mnt tanpa aktivitas manusia → kirim nudge ke admin.
 *   10 mnt setelah nudge tanpa respons → auto-handback ke AI_ACTIVE.
 */

import {
  getTakeover, setTakeover, releaseTakeover, loadTurnState, recordHumanActivity,
  findTakeoversNeedingNudge,
  type TakeoverState,
} from './pipeline-store';
import {
  buildHandoffSummary, loadRecentUserEvents, saveHandoffSummary,
} from './handoff-summary';
import { isUserInTakeover as legacyTakeoverCheck } from '../services/channel-client.service';
import logger from '../utils/logger';

export const DEFAULT_TAKEOVER_TTL_MS = 30 * 60 * 1000;
/** W4: nudge setelah 30 menit tanpa aktivitas manusia. */
export const TAKEOVER_NUDGE_AFTER_MINUTES = 30;
/** W4: auto-handback 10 menit setelah nudge tanpa respons. */
export const TAKEOVER_AUTO_HANDBACK_AFTER_MINUTES = 10;

export type { TakeoverState };

/** True when a human has taken over this conversation right now. */
export async function isTakeoverActive(
  tenantId: string, userId: string, channel = 'whatsapp',
): Promise<{ active: boolean; takenBy?: string; reason?: string; state?: TakeoverState }> {
  // v2 TTL state (primary). getTakeover() sudah melakukan transisi lazy W4.
  const local = await getTakeover(tenantId, userId, channel).catch(() => null);
  if (local) {
    // HANDOFF_PENDING bukan "takeover aktif" — AI masih boleh bicara sambil menunggu.
    if (local.state === 'HANDOFF_PENDING') {
      return { active: false, state: local.state };
    }
    return { active: true, takenBy: local.takenBy, reason: local.reason, state: local.state };
  }
  // Legacy channel-service flag (best-effort, keeps existing admin UX working).
  try {
    const legacy = await legacyTakeoverCheck(userId, tenantId || undefined);
    if (legacy) return { active: true, takenBy: 'admin', reason: 'channel-service flag' };
  } catch {
    // fall through
  }
  return { active: false, state: 'AI_ACTIVE' };
}

/** Admin takes over: AI goes quiet until TTL or explicit release. */
export async function takeOver(
  tenantId: string, userId: string, takenBy: string, reason = '',
  ttlMs = DEFAULT_TAKEOVER_TTL_MS, channel = 'whatsapp',
): Promise<boolean> {
  const ok = await setTakeover(tenantId, userId, takenBy, reason, ttlMs, channel, 'HUMAN_ACTIVE');
  logger.info('[takeover] taken over', { tenantId, userId, takenBy, ttlMs });
  // A1: build + save a handoff summary (best-effort, never blocks takeover).
  try {
    const [turn, events] = await Promise.all([
      loadTurnState(tenantId, userId, channel).catch(() => null),
      loadRecentUserEvents(tenantId, userId, channel).catch(() => []),
    ]);
    const summary = buildHandoffSummary({
      stage: turn?.stage ?? 'UNKNOWN',
      slots: (turn?.slots ?? {}) as Record<string, unknown>,
      recentEvents: events,
      takenBy, reason,
    });
    await saveHandoffSummary({ tenantId, userId, channel, takenBy, reason, summary });
  } catch {
    // summary is a nicety — takeover itself already succeeded
  }
  return ok;
}

/**
 * W4: sistem meminta handoff (mis. auto-handoff dari pipeline).
 * Masuk ke HANDOFF_PENDING — AI masih boleh bicara sampai manusia ambil alih.
 */
export async function requestHandoff(
  tenantId: string, userId: string, reason = 'auto-handoff',
  ttlMs = DEFAULT_TAKEOVER_TTL_MS, channel = 'whatsapp',
): Promise<boolean> {
  const ok = await setTakeover(tenantId, userId, 'system', reason, ttlMs, channel, 'HANDOFF_PENDING');
  logger.info('[takeover] handoff requested', { tenantId, userId, reason });
  return ok;
}

/**
 * W4: catat pesan dari manusia (admin/petugas).
 * HANDOFF_PENDING → HUMAN_ACTIVE, NUDGE → HUMAN_ACTIVE, refresh activity.
 */
export async function onHumanMessage(
  tenantId: string, userId: string, channel = 'whatsapp',
): Promise<void> {
  await recordHumanActivity(tenantId, userId, channel);
  logger.debug('[takeover] human activity recorded', { tenantId, userId, channel });
}

/** Admin hands the conversation back to the AI. */
export async function releaseTakeOver(
  tenantId: string, userId: string, channel = 'whatsapp',
): Promise<void> {
  await releaseTakeover(tenantId, userId, channel);
  logger.info('[takeover] released', { tenantId, userId });
}

/**
 * W4: daftar takeover yang butuh nudge (untuk cron/notifikasi proaktif ke admin).
 * Nudge dikirim setelah 30 menit tanpa aktivitas manusia.
 */
export async function getTakeoversNeedingNudge(
  limit = 100,
): Promise<Array<{ tenantId: string; userId: string; channel: string; takenBy: string }>> {
  return findTakeoversNeedingNudge(limit);
}

/**
 * W4: copy nudge untuk admin — dikirim saat HUMAN_ACTIVE 30 mnt tanpa aktivitas.
 */
export function buildNudgeCopy(userId: string): string {
  return (
    `⏰ Pengingat: percakapan dengan ${userId} sudah 30 menit tanpa aktivitas. ` +
    `Jika sudah selesai, silakan serahkan kembali ke AI. ` +
    `Sistem akan mengembalikan otomatis ke AI dalam 10 menit jika tidak ada respons.`
  );
}

/**
 * W4: copy auto-handback — dikirim saat kembali ke AI setelah nudge timeout.
 */
export function buildAutoHandbackCopy(): string {
  return (
    `🤖 Percakapan dikembalikan ke AI otomatis karena tidak ada aktivitas ` +
    `selama 10 menit setelah pengingat. Admin dapat mengambil alih kembali kapan saja.`
  );
}
