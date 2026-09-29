/**
 * A1: handoff summary routes — latest auto-generated takeover summary
 * for a conversation, so the dashboard can show staff the context.
 *
 * Internal API only (dashboard calls these with the internal key).
 */
import { Router, type Request, type Response } from 'express';
import { internalApiKeyMatches } from '../utils/internal-auth';
import { getLatestHandoffSummary } from '../pipeline/handoff-summary';

const router = Router();

function firstHeader(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function verifyInternalKey(req: Request, res: Response, next: Function) {
  const apiKey = firstHeader(req.headers['x-internal-api-key']);
  if (!internalApiKeyMatches(apiKey)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
}

router.use(verifyInternalKey);

/** GET /api/handoffs/latest?village_id=X&user_id=Y&channel=whatsapp */
router.get('/latest', async (req: Request, res: Response) => {
  const villageId = String(req.query.village_id ?? '');
  const userId = String(req.query.user_id ?? '');
  const channel = String(req.query.channel ?? 'whatsapp');
  if (!villageId || !userId) {
    return res.status(400).json({ error: 'village_id and user_id required' });
  }
  const summary = await getLatestHandoffSummary(villageId, userId, channel);
  if (!summary) return res.status(404).json({ error: 'no handoff summary' });
  res.json({ success: true, summary });
});

export default router;
