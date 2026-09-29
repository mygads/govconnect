/**
 * A4 — admin review queue for media fraud signals (internal API).
 * GET /api/media-signals/recent?village_id=X&limit=50
 */
import { Router, type Request, type Response } from 'express';
import { internalApiKeyMatches } from '../utils/internal-auth';
import { getQuery, getParam } from '../utils/http';
import { listRecentMediaSignals } from '../pipeline/media-signals';

const router = Router();

function verifyInternalKey(req: Request, res: Response, next: Function) {
  const apiKey = Array.isArray(req.headers['x-internal-api-key'])
    ? req.headers['x-internal-api-key'][0]
    : req.headers['x-internal-api-key'];
  if (!internalApiKeyMatches(apiKey)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
}

router.use(verifyInternalKey);

router.get('/recent', async (req: Request, res: Response) => {
  const villageId = String(getQuery(req, 'village_id') ?? '');
  if (!villageId) return res.status(400).json({ error: 'village_id required' });
  const limit = Math.min(Math.max(Number(getQuery(req, 'limit') ?? 50) || 50, 1), 100);
  const signals = await listRecentMediaSignals(villageId, limit);
  res.json({ success: true, signals });
});

export default router;
