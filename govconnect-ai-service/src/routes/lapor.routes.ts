/**
 * LAPOR! outbox drain route. Mounted with the internal API key middleware
 * in app.ts at /internal/lapor.
 *
 * - POST /internal/lapor/drain — claim pending outbox rows (SKIP LOCKED) and
 *   POST each to the configured LAPOR endpoint. Called by ops on a schedule
 *   (systemd timer / cron, e.g. daily). Safe to run often: rows are claimed
 *   atomically, so concurrent/duplicate runs cannot double-send.
 *
 * W17: drainLaporOutbox() previously had no caller — without this endpoint
 * (or an equivalent worker) the outbox would never be sent even with
 * LAPOR_ENABLED=true.
 */
import { Router, type Request, type Response } from 'express';
import { drainLaporOutbox } from '../pipeline/lapor-bridge';

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

export default router;
