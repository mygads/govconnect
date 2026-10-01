import { Router, Request, Response } from 'express';
import logger from '../utils/logger';
import { firstHeader } from '../utils/http';
import { internalApiKeyMatches } from '../utils/internal-auth';
import {
  resolveTargetByModelId,
  resolveTargetByDraft,
  resolveTargetManual,
  runCompatibilityTest,
} from '../services/model-compatibility.service';

const router = Router();

function verifyInternalKey(req: Request, res: Response, next: Function) {
  const apiKey = firstHeader(req.headers['x-internal-api-key']);
  if (!internalApiKeyMatches(apiKey)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
}

// Model Compatibility Test — 11 capability tests (5 basic bobot 1x + 6 GovConnect smartness bobot 2x).
// Manual api_key dipakai transient, tidak pernah disimpan.
// Body: { model_id } | { draft: { provider_id, upstream_model_name, endpoint_path, supports_vision } } | { manual: { base_url, api_key, model_name } }
router.post('/compatibility', verifyInternalKey, async (req: Request, res: Response) => {
  try {
    const { model_id, draft, manual } = req.body || {};
    let target;
    if (typeof model_id === 'string' && model_id) {
      target = await resolveTargetByModelId(model_id);
    } else if (draft) {
      target = await resolveTargetByDraft(draft);
    } else if (manual) {
      target = await resolveTargetManual(manual);
    } else {
      return res.status(400).json({ success: false, error: 'model_id, draft, or manual is required' });
    }

    const report = await runCompatibilityTest(target);
    return res.json({ success: true, data: report });
  } catch (error: any) {
    logger.warn('Model compatibility test failed', { error: error.message });
    return res.status(400).json({
      success: false,
      error: error.message || 'Compatibility test failed',
    });
  }
});

export default router;
