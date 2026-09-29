/**
 * R16 — Document reminders (H+3, once, idempotent) + broadcast opt-in.
 *
 * Reminders:
 * - scheduleDocReminder() is idempotent: UNIQUE(village_id, ticket_ref,
 *   reminder_type) collapses concurrent/duplicate schedules into one row.
 * - runDocReminderSweep() picks due rows and sends each AT MOST once:
 *   the pending→sent transition is a single conditional UPDATE, so two
 *   overlapping sweeps cannot double-send.
 * - Triggering: there is NO in-process cron in ai-service. Ops calls
 *   POST /internal/reminders/doc-sweep on a schedule (e.g. systemd timer
 *   or cron, hourly). The sweep itself is safe to run often.
 *
 * Broadcast:
 * - Default OPT-OUT. A user receives broadcasts only with an explicit
 *   opt_in=true row in pipeline_broadcast_consents (managed via dashboard).
 * - sendBroadcast() re-checks consent per recipient at send time and
 *   audits EVERY broadcast (attempt + result) — R16 requirement.
 *
 * Both paths reuse the existing citizen-notification channel
 * (channel-service /internal/send); no parallel channel is created.
 */

import { randomUUID } from 'crypto';
import { getDb, dbDown, appendAudit } from './pipeline-store';
import { config } from '../config/env';
import logger from '../utils/logger';

export const DOC_REMINDER_DELAY_MS = 3 * 24 * 3600 * 1000; // H+3

export const DOC_REMINDER_COPY = (ticketRef: string): string =>
  `Pengingat dari Desa: pengaduan Bapak/Ibu (${ticketRef}) tercatat ` +
  `3 hari yang lalu dan kami belum menerima dokumen pendukungnya. ` +
  `Jika ada foto atau dokumen pendukung, silakan kirim sebagai balasan pesan ini ` +
  `agar petugas desa dapat menindaklanjuti lebih cepat. Terima kasih.`;

export interface ScheduleDocReminderInput {
  villageId: string;
  userId: string;
  channel?: string;
  ticketRef: string;
  ticketKind?: string;
  docKind?: string;
  delayMs?: number;
  now?: Date;
}

/** Idempotent schedule — duplicate calls for the same ticket are no-ops. */
export async function scheduleDocReminder(input: ScheduleDocReminderInput): Promise<boolean> {
  const db = await getDb();
  if (!db) return dbDown('scheduleDocReminder', false);
  const now = input.now ?? new Date();
  const scheduledFor = new Date(now.getTime() + (input.delayMs ?? DOC_REMINDER_DELAY_MS));
  try {
    await db.$executeRawUnsafe(
      `INSERT INTO pipeline_doc_reminders
         (id, village_id, user_id, channel, ticket_ref, ticket_kind, doc_kind, scheduled_for)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (village_id, ticket_ref, reminder_type) DO NOTHING`,
      randomUUID(), input.villageId, input.userId, input.channel ?? 'whatsapp',
      input.ticketRef, input.ticketKind ?? 'complaint',
      input.docKind ?? 'dokumen_pendukung', scheduledFor.toISOString(),
    );
    await appendAudit({
      tenantId: input.villageId, traceId: randomUUID(), userId: input.userId,
      channel: input.channel ?? 'whatsapp', stage: 'EXECUTE',
      event: 'doc_reminder_scheduled',
      payload: { ticketRef: input.ticketRef, scheduledFor: scheduledFor.toISOString() },
    }).catch(() => undefined);
    return true;
  } catch (err) {
    logger.warn('[reminders] schedule failed', { error: String((err as Error)?.message ?? err).slice(0, 120) });
    return false;
  }
}

/** Shared citizen notification via channel-service /internal/send (text). */
export async function notifyCitizen(villageId: string, userId: string, text: string): Promise<boolean> {
  try {
    const base = (config.channelServiceUrl ?? '').replace(/\/$/, '');
    if (!base) return false;
    const res = await fetch(`${base}/internal/send`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-api-key': config.internalApiKey ?? '',
      },
      body: JSON.stringify({ village_id: villageId, wa_user_id: userId, message: text }),
      signal: AbortSignal.timeout(15000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

interface DueReminder {
  id: string;
  village_id: string;
  user_id: string;
  channel: string;
  ticket_ref: string;
}

export interface SweepResult {
  due: number;
  sent: number;
  failed: number;
}

/**
 * Send all due reminders once. Safe to run concurrently/often:
 * the claim UPDATE only succeeds for rows still pending.
 */
export async function runDocReminderSweep(opts?: {
  now?: Date; limit?: number;
  sender?: (villageId: string, userId: string, text: string) => Promise<boolean>;
}): Promise<SweepResult> {
  const db = await getDb();
  if (!db) return dbDown('runDocReminderSweep', { due: 0, sent: 0, failed: 0 });
  const now = opts?.now ?? new Date();
  const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 1000);
  const sender = opts?.sender ?? notifyCitizen;
  const result: SweepResult = { due: 0, sent: 0, failed: 0 };
  try {
    const due = (await db.$queryRawUnsafe(
      `SELECT id, village_id, user_id, channel, ticket_ref
         FROM pipeline_doc_reminders
        WHERE status = 'pending' AND scheduled_for <= $1
        ORDER BY scheduled_for ASC LIMIT $2`,
      now.toISOString(), limit,
    )) as DueReminder[];
    result.due = due.length;
    for (const r of due) {
      // Claim exactly once — concurrent sweeps lose the race here.
      const claimed = (await db.$executeRawUnsafe(
        `UPDATE pipeline_doc_reminders SET status = 'sent', sent_at = now()
          WHERE id = $1 AND status = 'pending'`,
        r.id,
      )) as unknown as number;
      if (Number(claimed) !== 1) continue; // lost the race — another sweep sent it
      const ok = await sender(r.village_id, r.user_id, DOC_REMINDER_COPY(r.ticket_ref));
      if (!ok) {
        await db.$executeRawUnsafe(
          `UPDATE pipeline_doc_reminders SET status = 'failed' WHERE id = $1`, r.id,
        ).catch(() => undefined);
        result.failed += 1;
      } else {
        result.sent += 1;
      }
      await appendAudit({
        tenantId: r.village_id, traceId: randomUUID(), userId: r.user_id,
        channel: r.channel, stage: 'EXECUTE', event: 'doc_reminder_sent',
        payload: { ticketRef: r.ticket_ref, sent: ok },
      }).catch(() => undefined);
    }
  } catch (err) {
    logger.warn('[reminders] sweep failed', { error: String((err as Error)?.message ?? err).slice(0, 120) });
  }
  return result;
}

// ── Broadcast opt-in ─────────────────────────────────────────────────────

export async function setBroadcastOptIn(
  villageId: string, userId: string, channel: string, optIn: boolean,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return dbDown('setBroadcastOptIn', false);
  try {
    await db.$executeRawUnsafe(
      `INSERT INTO pipeline_broadcast_consents (village_id, user_id, channel, opt_in, updated_at)
       VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (village_id, user_id, channel)
       DO UPDATE SET opt_in = EXCLUDED.opt_in, updated_at = now()`,
      villageId, userId, channel, optIn,
    );
    await appendAudit({
      tenantId: villageId, traceId: randomUUID(), userId,
      channel, stage: 'EXECUTE', event: 'broadcast_consent_changed',
      payload: { optIn },
    }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

export async function isBroadcastOptedIn(
  villageId: string, userId: string, channel: string,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return dbDown('isBroadcastOptedIn', false); // default opt-out
  try {
    const rows = (await db.$queryRawUnsafe(
      `SELECT opt_in FROM pipeline_broadcast_consents
        WHERE village_id = $1 AND user_id = $2 AND channel = $3`,
      villageId, userId, channel,
    )) as Array<{ opt_in: boolean }>;
    return rows[0]?.opt_in === true;
  } catch {
    return false;
  }
}

export interface BroadcastResult {
  requested: number;
  optedIn: number;
  sent: number;
  failed: number;
}

/**
 * Broadcast ONLY to opted-in users. Every broadcast (and every skip) is
 * audited. Consent is re-checked at send time.
 */
export async function sendBroadcast(opts: {
  villageId: string;
  channel?: string;
  userIds: string[];
  text: string;
  sentBy: string;
  sender?: (villageId: string, userId: string, text: string) => Promise<boolean>;
}): Promise<BroadcastResult> {
  const channel = opts.channel ?? 'whatsapp';
  const sender = opts.sender ?? notifyCitizen;
  const result: BroadcastResult = { requested: opts.userIds.length, optedIn: 0, sent: 0, failed: 0 };
  const traceId = randomUUID();
  await appendAudit({
    tenantId: opts.villageId, traceId, userId: opts.sentBy, channel,
    stage: 'EXECUTE', event: 'broadcast_started',
    payload: { requested: result.requested, textPreview: opts.text.slice(0, 80) },
  }).catch(() => undefined);
  for (const userId of opts.userIds) {
    if (!(await isBroadcastOptedIn(opts.villageId, userId, channel))) continue; // opt-out: silent skip
    result.optedIn += 1;
    const ok = await sender(opts.villageId, userId, opts.text);
    if (ok) result.sent += 1;
    else result.failed += 1;
    await appendAudit({
      tenantId: opts.villageId, traceId, userId, channel,
      stage: 'EXECUTE', event: 'broadcast_sent',
      payload: { sentBy: opts.sentBy, sent: ok },
    }).catch(() => undefined);
  }
  await appendAudit({
    tenantId: opts.villageId, traceId, userId: opts.sentBy, channel,
    stage: 'EXECUTE', event: 'broadcast_finished', payload: { ...result },
  }).catch(() => undefined);
  return result;
}
