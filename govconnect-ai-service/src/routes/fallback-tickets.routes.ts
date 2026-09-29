/**
 * Fallback tickets listing for admin UI.
 * Mounted in app.ts at /api/fallback-tickets (contract: GET /api/fallback-tickets?village_id=&reason=).
 *
 * Auth: same x-internal-api-key middleware as other admin-facing API routes
 * (see ktp-verifications.routes.ts). village_id is REQUIRED — tenant scoping
 * is enforced server-side; rows from other tenants are never returned.
 */
import { Router, type Request, type Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { internalApiKeyMatches } from '../utils/internal-auth';
import logger from '../utils/logger';

const router = Router();
const prisma = new PrismaClient();

function verifyInternalKey(req: Request, res: Response): boolean {
  const key = req.headers['x-internal-api-key'];
  if (!internalApiKeyMatches(key)) {
    res.status(403).json({ error: 'Unauthorized: invalid internal API key' });
    return false;
  }
  return true;
}

/**
 * GET /api/fallback-tickets?village_id=&reason=&status=&limit=&offset=
 * - village_id: required (tenant scope)
 * - reason: optional exact filter (e.g. csat_low_rating)
 * - status: optional exact filter, default 'open'; 'all' means no status filter
 * - limit: 1..200, default 50; offset: default 0
 */
router.get('/', async (req: Request, res: Response) => {
  if (!verifyInternalKey(req, res)) return;

  const villageId = String(req.query.village_id ?? '').trim();
  if (!villageId) {
    return res.status(400).json({ error: 'village_id is required' });
  }

  const reason = typeof req.query.reason === 'string' && req.query.reason.trim()
    ? req.query.reason.trim() : undefined;
  const status = typeof req.query.status === 'string' && req.query.status.trim()
    ? req.query.status.trim() : 'open';
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 200);
  const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);

  try {
    const where: Record<string, unknown> = { tenant_id: villageId };
    if (status && status !== 'all') where.status = status;
    if (reason) where.reason = reason;

    const [total, tickets] = await Promise.all([
      prisma.pipeline_fallback_tickets.count({ where }),
      prisma.pipeline_fallback_tickets.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: limit,
        skip: offset,
      }),
    ]);

    return res.json({
      success: true,
      village_id: villageId,
      total,
      limit,
      offset,
      tickets: tickets.map((t) => ({
        ticket_id: t.ticket_id,
        user_id: t.user_id,
        channel: t.channel,
        stage: t.stage,
        reason: t.reason,
        detail: t.detail,
        status: t.status,
        created_at: t.created_at,
      })),
    });
  } catch (err: any) {
    logger.error('fallback-tickets list failed', { villageId, reason, error: err?.message });
    return res.status(500).json({ error: err?.message ?? 'list failed' });
  }
});

export default router;
