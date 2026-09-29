/**
 * R16 reminder + broadcast routes. Mounted with the internal API key
 * middleware in app.ts.
 *
 * - POST /internal/reminders/doc-sweep — run the H+3 reminder sweep.
 *   Called by ops on a schedule (systemd timer / cron, e.g. hourly).
 *   Safe to run often: each reminder is sent at most once.
 * - POST /internal/reminders/schedule — manually schedule a doc reminder.
 * - POST /internal/broadcast/consent — set broadcast opt-in for a user.
 * - POST /internal/broadcast/send — broadcast ONLY to opted-in users.
 */
import { Router, type Request, type Response } from 'express';
import {
  scheduleDocReminder, runDocReminderSweep,
  setBroadcastOptIn, sendBroadcast,
} from '../pipeline/doc-reminders';

const router = Router();

router.post('/doc-sweep', async (req: Request, res: Response) => {
  try {
    const limit = Number(req.body?.limit ?? req.query.limit ?? 100);
    const result = await runDocReminderSweep({ limit });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'failed to run doc reminder sweep' });
  }
});

router.post('/schedule', async (req: Request, res: Response) => {
  try {
    const b = req.body ?? {};
    const villageId = String(b.village_id ?? b.villageId ?? '');
    const userId = String(b.user_id ?? b.userId ?? '');
    const ticketRef = String(b.ticket_ref ?? b.ticketRef ?? '');
    if (!villageId || !userId || !ticketRef) {
      return res.status(400).json({ error: 'village_id, user_id, ticket_ref required' });
    }
    const ok = await scheduleDocReminder({
      villageId, userId,
      channel: String(b.channel ?? 'whatsapp'),
      ticketRef,
      ticketKind: String(b.ticket_kind ?? 'complaint'),
      docKind: String(b.doc_kind ?? 'dokumen_pendukung'),
    });
    res.json({ success: ok });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'failed to schedule doc reminder' });
  }
});

router.post('/broadcast/consent', async (req: Request, res: Response) => {
  try {
    const b = req.body ?? {};
    const villageId = String(b.village_id ?? b.villageId ?? '');
    const userId = String(b.user_id ?? b.userId ?? '');
    if (!villageId || !userId) {
      return res.status(400).json({ error: 'village_id, user_id required' });
    }
    const ok = await setBroadcastOptIn(
      villageId, userId,
      String(b.channel ?? 'whatsapp'),
      b.opt_in ?? b.optIn === true,
    );
    res.json({ success: ok });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'failed to set broadcast consent' });
  }
});

router.post('/broadcast/send', async (req: Request, res: Response) => {
  try {
    const b = req.body ?? {};
    const villageId = String(b.village_id ?? b.villageId ?? '');
    const text = String(b.text ?? b.message ?? '');
    const userIds = Array.isArray(b.user_ids ?? b.userIds)
      ? (b.user_ids ?? b.userIds).map(String).filter(Boolean)
      : [];
    if (!villageId || !text || userIds.length === 0) {
      return res.status(400).json({ error: 'village_id, text, user_ids[] required' });
    }
    if (userIds.length > 5000) {
      return res.status(400).json({ error: 'too many recipients (max 5000)' });
    }
    const result = await sendBroadcast({
      villageId,
      channel: String(b.channel ?? 'whatsapp'),
      userIds,
      text,
      sentBy: String(b.sent_by ?? b.sentBy ?? 'dashboard'),
    });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'failed to send broadcast' });
  }
});

export default router;
