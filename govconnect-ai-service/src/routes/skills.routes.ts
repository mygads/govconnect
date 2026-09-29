/**
 * R4: village skill admin routes.
 *
 * Skills are built INACTIVE and require explicit human activation —
 * there is no auto-promote path (P14). The agent only ever sees ACTIVE
 * skills (via getSkillIndex / load_skill).
 *
 * Internal API only (dashboard calls these with the internal key).
 */
import { Router, Request, Response } from 'express';
import {
  getSkillIndex,
  getSkillAdmin,
  createSkill,
  setSkillActive,
} from '../services/skill-loader.service';
import {
  buildSkillFromDocument,
  validateSkillDraft,
} from '../services/skill-format';
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

/** GET /api/skills?village_id=X — active skill index (what the agent sees). */
router.get('/', async (req: Request, res: Response) => {
  const villageId = String(req.query.village_id ?? '');
  if (!villageId) return res.status(400).json({ error: 'village_id required' });
  res.json({ success: true, skills: await getSkillIndex(villageId) });
});

/** GET /api/skills/:slug?village_id=X — admin detail (incl. inactive). */
router.get('/:slug', async (req: Request, res: Response) => {
  const villageId = String(req.query.village_id ?? '');
  if (!villageId) return res.status(400).json({ error: 'village_id required' });
  const skill = await getSkillAdmin(villageId, req.params.slug);
  if (!skill) return res.status(404).json({ error: 'skill not found' });
  res.json({ success: true, skill });
});

/**
 * POST /api/skills/build — draft a skill from a document's procedural
 * content. Stored INACTIVE; a human reviews and activates it.
 */
router.post('/build', async (req: Request, res: Response) => {
  const villageId = String(req.body?.village_id ?? '');
  const title = String(req.body?.title ?? '');
  const text = String(req.body?.text ?? '');
  if (!villageId || !title || !text) {
    return res.status(400).json({ error: 'village_id, title, text required' });
  }
  const draft = buildSkillFromDocument({ title, text });
  const err = validateSkillDraft(draft);
  if (err) return res.status(400).json({ error: err });
  const created = await createSkill({
    villageId,
    slug: draft.slug,
    title: draft.title,
    description: draft.description,
    body: draft.body,
    triggers: draft.triggers,
    sourceDocumentId: req.body?.source_document_id ? String(req.body.source_document_id) : undefined,
    createdBy: req.body?.created_by ? String(req.body.created_by) : 'admin',
  });
  res.json({
    success: true,
    skill: { ...created, is_active: false },
    note: 'Draft stored INACTIVE. Activate explicitly after human review — nothing was auto-promoted.',
  });
});

/** POST /api/skills/:slug/activate — explicit human activation. */
router.post('/:slug/activate', async (req: Request, res: Response) => {
  const villageId = String(req.body?.village_id ?? '');
  if (!villageId) return res.status(400).json({ error: 'village_id required' });
  const ok = await setSkillActive(villageId, req.params.slug, true);
  if (!ok) return res.status(404).json({ error: 'skill not found' });
  res.json({ success: true, slug: req.params.slug, is_active: true });
});

/** POST /api/skills/:slug/deactivate */
router.post('/:slug/deactivate', async (req: Request, res: Response) => {
  const villageId = String(req.body?.village_id ?? '');
  if (!villageId) return res.status(400).json({ error: 'village_id required' });
  const ok = await setSkillActive(villageId, req.params.slug, false);
  if (!ok) return res.status(404).json({ error: 'skill not found' });
  res.json({ success: true, slug: req.params.slug, is_active: false });
});

export default router;
