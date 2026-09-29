/**
 * R5: KB proposal routes — review queue for the knowledge suggester.
 *
 * AI proposes, human approves (P14). These endpoints only move proposals
 * between review states (pending → approved/rejected, approved →
 * published/withdrawn). Approval does NOT publish content into the KB —
 * there is no auto-promote path by design; publishing is a separate
 * explicit human step.
 *
 * Internal API only (dashboard calls these with the internal key).
 */
import { Router, Request, Response } from 'express';
import {
  canTransition,
  prismaProposalStore,
  runSuggesterForVillage,
  type KbProposal,
} from '../services/kb-suggester.service';
import { internalApiKeyMatches } from '../utils/internal-auth';

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

/** GET /api/kb-proposals?village_id=X&status=pending — review queue. */
router.get('/', async (req: Request, res: Response) => {
  const villageId = String(req.query.village_id ?? '');
  if (!villageId) return res.status(400).json({ error: 'village_id required' });
  const status = req.query.status as KbProposal['status'] | undefined;
  if (status && !['pending', 'approved', 'rejected', 'published', 'withdrawn'].includes(status)) {
    return res.status(400).json({ error: 'invalid status' });
  }
  const proposals = await prismaProposalStore.list(villageId, status);
  res.json({ success: true, proposals });
});

/** GET /api/kb-proposals/:id — proposal detail. */
router.get('/:id', async (req: Request, res: Response) => {
  const p = await prismaProposalStore.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'proposal not found' });
  res.json({ success: true, proposal: p });
});

/**
 * POST /api/kb-proposals/:id/approve — human approves the draft.
 * Moves pending → approved. Does NOT publish to the KB (no auto-promote).
 */
router.post('/:id/approve', async (req: Request, res: Response) => {
  const reviewer = String(req.body?.reviewer ?? '').trim();
  if (!reviewer) return res.status(400).json({ error: 'reviewer required' });
  const current = await prismaProposalStore.get(req.params.id);
  if (!current) return res.status(404).json({ error: 'proposal not found' });
  if (!canTransition(current.status, 'approved')) {
    return res.status(409).json({
      error: `cannot approve proposal in status '${current.status}'`,
    });
  }
  const p = await prismaProposalStore.setStatus(
    req.params.id, 'approved', reviewer, String(req.body?.note ?? ''),
  );
  res.json({
    success: true,
    proposal: p,
    note: 'Approved as a draft. Publishing to the KB is a separate explicit step — nothing was auto-promoted.',
  });
});

/** POST /api/kb-proposals/:id/reject — human rejects the draft. */
router.post('/:id/reject', async (req: Request, res: Response) => {
  const reviewer = String(req.body?.reviewer ?? '').trim();
  if (!reviewer) return res.status(400).json({ error: 'reviewer required' });
  const current = await prismaProposalStore.get(req.params.id);
  if (!current) return res.status(404).json({ error: 'proposal not found' });
  if (!canTransition(current.status, 'rejected')) {
    return res.status(409).json({
      error: `cannot reject proposal in status '${current.status}'`,
    });
  }
  const p = await prismaProposalStore.setStatus(
    req.params.id, 'rejected', reviewer, String(req.body?.note ?? ''),
  );
  res.json({ success: true, proposal: p });
});

/**
 * POST /api/kb-proposals/suggest — run the suggester for a village.
 * Called by the daily/weekly cron (and manually). Never called on the hot path.
 */
router.post('/suggest', async (req: Request, res: Response) => {
  const villageId = String(req.body?.village_id ?? req.query.village_id ?? '');
  if (!villageId) return res.status(400).json({ error: 'village_id required' });
  const days = Math.min(90, Math.max(1, Number(req.body?.days ?? 7) || 7));
  const created = await runSuggesterForVillage({ villageId, days });
  res.json({ success: true, village_id: villageId, proposals_created: created.length, proposals: created });
});

export default router;
