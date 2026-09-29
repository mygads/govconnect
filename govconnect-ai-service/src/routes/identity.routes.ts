/**
 * Identity revocation for admin UI.
 * Mounted in app.ts at /api/identity (contract: POST /api/identity/revoke { village_id, user_id }).
 *
 * Auth: same x-internal-api-key middleware as other admin-facing API routes
 * (see ktp-verifications.routes.ts). The tenant is derived from village_id in
 * the request body — the dashboard proxy injects it from the admin session,
 * never trusting client-supplied cross-tenant values.
 */
import { Router, type Request, type Response } from 'express';
import { internalApiKeyMatches } from '../utils/internal-auth';
import { identityRevoke } from '../pipeline/pipeline-store';
import logger from '../utils/logger';

const router = Router();

function verifyInternalKey(req: Request, res: Response): boolean {
  const key = req.headers['x-internal-api-key'];
  if (!internalApiKeyMatches(key)) {
    res.status(403).json({ error: 'Unauthorized: invalid internal API key' });
    return false;
  }
  return true;
}

/**
 * POST /api/identity/revoke { village_id, user_id }
 * Revokes the KTP/identity verification of a citizen within their own village.
 */
router.post('/revoke', async (req: Request, res: Response) => {
  if (!verifyInternalKey(req, res)) return;

  const villageId = String((req.body as any)?.village_id ?? '').trim();
  const userId = String((req.body as any)?.user_id ?? '').trim();
  if (!villageId || !userId) {
    return res.status(400).json({ error: 'village_id and user_id are required' });
  }

  try {
    const revoked = await identityRevoke(villageId, userId);
    logger.info('Identity revoked via admin API', { villageId, userId, revoked });
    return res.json({ success: true, village_id: villageId, user_id: userId, revoked });
  } catch (err: any) {
    logger.error('identity revoke failed', { villageId, userId, error: err?.message });
    return res.status(500).json({ error: err?.message ?? 'revoke failed' });
  }
});

export default router;
