/**
 * R12: CSAT — one question after a ticket is resolved/closed.
 *
 * Behind the CSAT_ENABLED feature flag (default off; read per call so it
 * can be flipped without a restart).
 *
 * Flow:
 * 1. notification-service delivers the DONE notification, then calls
 *    POST /internal/csat/trigger {village_id, user_id, channel, complaint_id}.
 * 2. triggerCsatSurvey records the survey and sends the question via
 *    channel-service /internal/send (text; interactive-list upgrade is
 *    future work — the send endpoint is text-only today).
 * 3. The user's next message passes through answerCsatSurvey in the
 *    pipeline ingress: a lone digit 1-5 is consumed deterministically as
 *    the rating; anything else flows through the normal pipeline and the
 *    survey stays pending (48h expiry).
 * 4. rating <= 2 → a follow-up ticket (reason 'csat_low_rating') is filed
 *    for the admin — the closed loop. The <24h follow-up SLA is
 *    operational (dashboard shows ticket age); the ticket carries the
 *    complaint id + rating + transcript pointer.
 *
 * PII: the survey stores ids + rating only — no message content.
 */
import crypto from 'crypto';
import { config } from '../config/env';
import logger from '../utils/logger';
import { appendAudit } from '../pipeline/pipeline-store';

export function isCsatEnabled(): boolean {
  return process.env.CSAT_ENABLED === 'true';
}

/** Surveys expire if unanswered (no eternal pending state). */
const CSAT_TTL_MS = Number(process.env.CSAT_TTL_MS ?? 48 * 3_600_000);

type PrismaLike = {
  $queryRawUnsafe: (query: string, ...args: unknown[]) => Promise<unknown>;
  $executeRawUnsafe: (query: string, ...args: unknown[]) => Promise<unknown>;
};
async function getPrisma(): Promise<PrismaLike> {
  const mod = await import('../lib/prisma');
  return mod.default as PrismaLike;
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

export const CSAT_QUESTION = (complaintId: string): string =>
  `Laporan ${complaintId} sudah selesai ditangani. ` +
  `Seberapa puas Bapak/Ibu dengan penanganannya? ` +
  `Balas dengan angka 1 (sangat tidak puas) sampai 5 (sangat puas).`;

export const CSAT_THANKS = 'Terima kasih atas penilaiannya! 🙏 Masukan Bapak/Ibu sangat berarti bagi kami.';
export const CSAT_THANKS_LOW =
  'Terima kasih atas penilaiannya. Mohon maaf atas ketidaknyamanannya — ' +
  'petugas desa akan menindaklanjuti laporan Anda.';

export interface TriggerInput {
  villageId: string;
  userId: string;
  channel: string;
  complaintId: string;
}

export async function triggerCsatSurvey(input: TriggerInput): Promise<{ sent: boolean; reason?: string }> {
  if (!isCsatEnabled()) return { sent: false, reason: 'disabled' };
  // Notification-service sends 'WHATSAPP'; the pipeline uses 'whatsapp'.
  if ((input.channel ?? '').toLowerCase() !== 'whatsapp') {
    return { sent: false, reason: 'whatsapp_only_v1' };
  }
  if (!input.villageId || !input.userId || !input.complaintId) {
    return { sent: false, reason: 'missing_fields' };
  }
  try {
    const prisma = await getPrisma();
    const id = newId('csat');
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO ai.csat_surveys (id, village_id, user_id, channel, complaint_id, status)
         VALUES ($1,$2,$3,$4,$5,'sent')`,
        id, input.villageId, input.userId, input.channel, input.complaintId,
      );
    } catch (err) {
      // Partial unique index: a pending survey already exists for this complaint.
      if (String((err as Error)?.message ?? err).includes('csat_surveys_pending_uq')) {
        return { sent: false, reason: 'already_pending' };
      }
      throw err;
    }

    const sent = await sendCsatQuestion(input.villageId, input.userId, CSAT_QUESTION(input.complaintId));
    if (!sent) {
      await prisma.$executeRawUnsafe(
        `UPDATE ai.csat_surveys SET status = 'failed' WHERE id = $1`, id,
      );
      return { sent: false, reason: 'send_failed' };
    }
    return { sent: true };
  } catch (err) {
    logger.warn('[csat] trigger failed', { error: (err as Error)?.message ?? String(err) });
    return { sent: false, reason: 'error' };
  }
}

async function sendCsatQuestion(villageId: string, waUserId: string, text: string): Promise<boolean> {
  try {
    const base = (config.channelServiceUrl ?? '').replace(/\/$/, '');
    if (!base) return false;
    const res = await fetch(`${base}/internal/send`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-api-key': config.internalApiKey ?? '',
      },
      body: JSON.stringify({ village_id: villageId, wa_user_id: waUserId, message: text }),
      signal: AbortSignal.timeout(15000),
    });
    return res.ok;
  } catch (err) {
    logger.warn('[csat] send failed', { error: (err as Error)?.message ?? String(err) });
    return false;
  }
}

const DIGIT_RE = /^\s*([1-5])\s*$/;

export interface CsatAnswer {
  consumed: boolean;
  response?: string;
  rating?: number;
  complaintId?: string;
}

/**
 * Pipeline ingress hook. Consumes a pending survey ONLY on a lone 1-5
 * digit; any other message flows through normally (survey stays pending).
 */
export async function answerCsatSurvey(args: {
  villageId: string;
  userId: string;
  message: string;
  traceId: string;
}): Promise<CsatAnswer> {
  if (!isCsatEnabled()) return { consumed: false };
  const m = DIGIT_RE.exec(args.message ?? '');
  if (!m) return { consumed: false };
  const rating = Number(m[1]);
  try {
    const prisma = await getPrisma();
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT id, complaint_id FROM ai.csat_surveys
       WHERE village_id = $1 AND user_id = $2 AND status = 'sent'
         AND sent_at > now() - make_interval(secs => $3)
       ORDER BY sent_at DESC LIMIT 1`,
      args.villageId, args.userId, CSAT_TTL_MS / 1000,
    )) as Array<{ id: string; complaint_id: string }>;
    if (rows.length === 0) return { consumed: false };
    const survey = rows[0];

    let followUpTicketId: string | null = null;
    if (rating <= 2) {
      // Closed loop: file a follow-up ticket for the admin (<24h SLA is
      // operational; the dashboard shows ticket age from created_at).
      followUpTicketId = newId('tkt');
      await prisma.$executeRawUnsafe(
        `INSERT INTO pipeline_fallback_tickets
           (ticket_id, tenant_id, user_id, channel, stage, reason, detail, status)
         VALUES ($1,$2,$3,'whatsapp','CSAT','csat_low_rating',$4,'open')`,
        followUpTicketId, args.villageId, args.userId,
        `CSAT rating ${rating}/5 untuk laporan ${String(survey.complaint_id)}. ` +
          `Warga tidak puas — tindak lanjuti <24 jam.`,
      );
    }

    await prisma.$executeRawUnsafe(
      `UPDATE ai.csat_surveys
       SET status = 'answered', rating = $1, answered_at = now(), follow_up_ticket_id = $2
       WHERE id = $3`,
      rating, followUpTicketId, String(survey.id),
    );

    await appendAudit({
      tenantId: args.villageId,
      traceId: args.traceId,
      userId: args.userId,
      channel: 'whatsapp',
      stage: 'INGRESS',
      event: 'csat_answered',
      payload: {
        rating,
        complaint_id: String(survey.complaint_id),
        follow_up: followUpTicketId !== null,
      },
    }).catch(() => undefined);

    return {
      consumed: true,
      response: rating <= 2 ? CSAT_THANKS_LOW : CSAT_THANKS,
      rating,
      complaintId: String(survey.complaint_id),
    };
  } catch (err) {
    logger.warn('[csat] answer failed (fail-open: message flows through)', {
      error: (err as Error)?.message ?? String(err),
    });
    return { consumed: false };
  }
}

/** Lazy-expire stale pending surveys (also enforced by the answer query). */
export async function expireStaleSurveys(): Promise<number> {
  try {
    const prisma = await getPrisma();
    const rows = (await prisma.$queryRawUnsafe(
      `UPDATE ai.csat_surveys SET status = 'expired'
       WHERE status = 'sent' AND sent_at < now() - make_interval(secs => $1)
       RETURNING id`,
      CSAT_TTL_MS / 1000,
    )) as Array<{ id: string }>;
    return rows.length;
  } catch {
    return 0;
  }
}
