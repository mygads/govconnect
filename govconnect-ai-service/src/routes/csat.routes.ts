/**
 * R12 CSAT trigger route. Mounted with the internal API key middleware in
 * app.ts. Called by notification-service after a DONE notification is
 * delivered.
 */
import { Router, type Request, type Response } from 'express';
import { triggerCsatSurvey, expireStaleSurveys, isCsatEnabled } from '../services/csat.service';

const router = Router();

router.post('/trigger', async (req: Request, res: Response) => {
  try {
    const { village_id, villageId, user_id, userId, channel, complaint_id, complaintId } = req.body ?? {};
    const result = await triggerCsatSurvey({
      villageId: village_id ?? villageId ?? '',
      userId: user_id ?? userId ?? '',
      channel: channel ?? 'whatsapp',
      complaintId: complaint_id ?? complaintId ?? '',
    });
    res.json({ success: result.sent, enabled: isCsatEnabled(), ...result });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'failed to trigger csat survey' });
  }
});

/** Housekeeping: expire stale pending surveys. Called by cron/operator. */
router.post('/expire', async (_req: Request, res: Response) => {
  try {
    const expired = await expireStaleSurveys();
    res.json({ success: true, expired });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'failed to expire surveys' });
  }
});

export default router;
