/**
 * LAPOR! outbox drain route. Mounted with the internal API key middleware
 * in app.ts at /internal/lapor.
 *
 * - POST /internal/lapor/drain — claim pending outbox rows (SKIP LOCKED) and
 *   POST each to the configured LAPOR endpoint. Called by ops on a schedule
 *   (systemd timer / cron, e.g. daily). Safe to run often: rows are claimed
 *   atomically, so concurrent/duplicate runs cannot double-send.
 * - POST /internal/lapor/webhook — receive status push from LAPOR! (or
 *   operator-assisted manual update when the LAPOR! API is unavailable).
 * - POST /internal/lapor/poll-status — poll LAPOR! for status of sent rows.
 *
 * W17: drainLaporOutbox() previously had no caller — without this endpoint
 * (or an equivalent worker) the outbox would never be sent even with
 * LAPOR_ENABLED=true. An in-process scheduler (startLaporDrainScheduler,
 * wired at server startup) now also drains automatically.
 */
import { Router, type Request, type Response } from 'express';
import {
  drainLaporOutbox,
  applyLaporStatusUpdate,
  pollLaporStatusUpdates,
  type LaporStatusUpdate,
} from '../pipeline/lapor-bridge';

const router = Router();

router.post('/drain', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(
      100,
      Math.max(1, Number(req.body?.limit ?? req.query.limit ?? 25)),
    );
    const result = await drainLaporOutbox(limit);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'failed to drain LAPOR outbox' });
  }
});

/**
 * W17: status sync balik dari LAPOR!.
 *
 * Body: { tracking_id: string, status: string, note?: string, source?: 'webhook'|'manual' }
 *
 * Dua mode:
 * 1. Webhook push dari LAPOR! (bila deployment-nya mendukung callback).
 * 2. Operator-assisted: admin mengisi tracking_id + status manual bila
 *    API LAPOR! tidak tersedia — JANGAN klaim API resmi ada.
 */
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const trackingId = String(body.tracking_id ?? '').trim();
    const status = String(body.status ?? '').trim();
    if (!trackingId || !status) {
      res.status(400).json({
        success: false,
        error: 'tracking_id dan status diperlukan',
      });
      return;
    }
    const sourceRaw = String(body.source ?? 'webhook');
    const source: LaporStatusUpdate['source'] =
      sourceRaw === 'manual' ? 'manual' : 'webhook';
    const result = await applyLaporStatusUpdate({
      tracking_id: trackingId,
      status,
      note: typeof body.note === 'string' ? body.note : undefined,
      source,
    });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'failed to apply LAPOR status update' });
  }
});

/**
 * W17: trigger polling status balik dari LAPOR! untuk baris 'sent' yang
 * punya tracking_id dan belum final. Skip bila sender tidak terkonfigurasi.
 */
router.post('/poll-status', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(
      100,
      Math.max(1, Number(req.body?.limit ?? req.query.limit ?? 20)),
    );
    const result = await pollLaporStatusUpdates(limit);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'failed to poll LAPOR status' });
  }
});

export default router;
