/**
 * Internal routes untuk fitur "pintar banget":
 *  - POST /api/internal/improvement/analyze — trigger improvement loop manual
 *  - GET  /api/internal/improvement/failures — lihat pola failures
 *  - GET  /api/internal/followup/candidates — kandidat proactive follow-up
 *
 * Semua endpoint butuh x-internal-api-key. TIDAK ada pengiriman otomatis —
 * follow-up hanya me-return kandidat untuk approval admin.
 */

import { Router, type Request, type Response } from 'express';
import { internalApiKeyMatches } from '../utils/internal-auth';
import { runImprovementCycle, analyzeFailures } from '../services/improvement-loop.service';
import { getFollowupCandidates } from '../services/proactive-followup.service';
import logger from '../utils/logger';

const router = Router();

function firstHeader(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function verifyInternalKey(req: Request, res: Response, next: () => void): void {
  const apiKey = firstHeader(req.headers['x-internal-api-key']);
  if (!internalApiKeyMatches(apiKey)) {
    res.status(403).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

router.use(verifyInternalKey);

/**
 * POST /api/internal/improvement/analyze
 * Body: { village_id: string, days?: number }
 *
 * Trigger manual improvement loop: analisis failures 7 hari terakhir +
 * generate saran perbaikan.
 */
router.post('/improvement/analyze', async (req: Request, res: Response) => {
  try {
    const village_id = String(req.body?.village_id ?? '').trim();
    if (!village_id) {
      res.status(400).json({ error: 'village_id required' });
      return;
    }
    const result = await runImprovementCycle(village_id);
    res.json({ status: 'success', data: result });
  } catch (err) {
    logger.warn('[smart-features] improvement/analyze failed', {
      error: String((err as Error)?.message ?? err).slice(0, 120),
    });
    res.status(500).json({ error: 'internal error' });
  }
});

/**
 * GET /api/internal/improvement/failures?village_id=X&days=7
 *
 * Lihat pola failures tanpa generate saran.
 */
router.get('/improvement/failures', async (req: Request, res: Response) => {
  try {
    const village_id = String(req.query.village_id ?? '').trim();
    if (!village_id) {
      res.status(400).json({ error: 'village_id required' });
      return;
    }
    const days = Math.max(1, Math.min(30, Number(req.query.days ?? 7)));
    const patterns = await analyzeFailures(village_id, days);
    res.json({ status: 'success', data: { patterns } });
  } catch (err) {
    logger.warn('[smart-features] improvement/failures failed', {
      error: String((err as Error)?.message ?? err).slice(0, 120),
    });
    res.status(500).json({ error: 'internal error' });
  }
});

/**
 * GET /api/internal/followup/candidates?village_id=X&stale_days=3
 *
 * Kandidat proactive follow-up. TIDAK mengirim otomatis — admin/user
 * me-review dan approve via dashboard sebelum dikirim.
 */
router.get('/followup/candidates', async (req: Request, res: Response) => {
  try {
    const village_id = String(req.query.village_id ?? '').trim() || undefined;
    const stale_days = Math.max(1, Math.min(30, Number(req.query.stale_days ?? 3)));
    const candidates = await getFollowupCandidates(village_id, stale_days);
    res.json({
      status: 'success',
      data: {
        candidates,
        count: candidates.length,
        note: 'Kandidat saja — tidak ada pengiriman otomatis. Approve via dashboard.',
      },
    });
  } catch (err) {
    logger.warn('[smart-features] followup/candidates failed', {
      error: String((err as Error)?.message ?? err).slice(0, 120),
    });
    res.status(500).json({ error: 'internal error' });
  }
});

export default router;
