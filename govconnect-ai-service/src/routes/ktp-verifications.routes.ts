/**
 * Manual KTP verification — admin API.
 *
 * - GET    /api/ktp-verifications?village_id=X&status=pending — review queue
 * - GET    /api/ktp-verifications/:id?village_id=X — detail (no photo bytes)
 * - GET    /api/ktp-verifications/:id/photo?village_id=X — photo for split-view
 * - POST   /api/ktp-verifications/:id/approve { reviewed_by, fields } — validate → L2
 * - POST   /api/ktp-verifications/:id/reject  { reviewed_by, reason } — reason required
 *
 * Internal API only (dashboard calls these with the internal key).
 * Photo bytes are served ONLY here, to authenticated admins — never to AI.
 */
import { Router, type Request, type Response } from 'express';
import { internalApiKeyMatches } from '../utils/internal-auth';
import { getQuery, getParam } from '../utils/http';
import {
  listKtpVerifications, getKtpVerification, getKtpPhoto,
  approveKtpVerification, rejectKtpVerification, resolveKtpNikForReview,
  type KtpVerificationStatus,
} from '../pipeline/ktp-verification';

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

function villageIdOf(req: Request): string {
  return String(getQuery(req, 'village_id') ?? req.body?.village_id ?? '');
}

/** GET /api/ktp-verifications?village_id=X&status=pending&limit=50&offset=0 */
router.get('/', async (req: Request, res: Response) => {
  const villageId = villageIdOf(req);
  if (!villageId) return res.status(400).json({ error: 'village_id required' });
  const status = getQuery(req, 'status') as KtpVerificationStatus | undefined;
  if (status && !['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'invalid status' });
  }
  const limit = Math.min(Math.max(Number(getQuery(req, 'limit') ?? 50) || 50, 1), 200);
  const offset = Math.max(Number(getQuery(req, 'offset') ?? 0) || 0, 0);
  const result = await listKtpVerifications(villageId, { status, limit, offset });
  res.json({ success: true, ...result });
});

/** GET /api/ktp-verifications/:id?village_id=X */
router.get('/:id', async (req: Request, res: Response) => {
  const villageId = villageIdOf(req);
  if (!villageId) return res.status(400).json({ error: 'village_id required' });
  const id = getParam(req, 'id');
  if (!id) return res.status(400).json({ error: 'id required' });
  const item = await getKtpVerification(villageId, id);
  if (!item) return res.status(404).json({ error: 'not found' });
  res.json({ success: true, item });
});

/** GET /api/ktp-verifications/:id/photo?village_id=X — admin eyes only. */
router.get('/:id/photo', async (req: Request, res: Response) => {  const villageId = villageIdOf(req);
  if (!villageId) return res.status(400).json({ error: 'village_id required' });
  const id = getParam(req, 'id');
  if (!id) return res.status(400).json({ error: 'id required' });
  const photo = await getKtpPhoto(villageId, id);
  if (!photo) return res.status(404).json({ error: 'photo not available (decided or expired)' });
  res.setHeader('content-type', photo.mime);
  res.setHeader('cache-control', 'no-store');
  res.send(photo.bytes);
});

/**
 * GET /api/ktp-verifications/:id/nik?village_id=X&reviewed_by=Y
 * Decrypt-on-view: resolves the vault NIK token for the dashboard and
 * audits who looked at the NIK (ktp_nik_viewed). Returns
 * `{ nik }` or `{ nik: null, expired: true }` — never throws on expiry.
 */
router.get('/:id/nik', async (req: Request, res: Response) => {
  const villageId = villageIdOf(req);
  if (!villageId) return res.status(400).json({ error: 'village_id required' });
  const reviewedBy = String(getQuery(req, 'reviewed_by') ?? '').trim().slice(0, 200);
  const id = getParam(req, 'id');
  if (!id) return res.status(400).json({ error: 'id required' });
  const result = await resolveKtpNikForReview({
    villageId, id, reviewedBy: reviewedBy || 'unknown',
  });
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : 503;
    return res.status(status).json({ success: false, error: result.error });
  }
  res.setHeader('cache-control', 'no-store');
  res.json({ success: true, nik: result.nik ?? null, expired: !!result.expired });
});

/** POST /api/ktp-verifications/:id/approve */
router.post('/:id/approve', async (req: Request, res: Response) => {
  const b = req.body ?? {};
  const villageId = String(b.village_id ?? getQuery(req, 'village_id') ?? '');
  const reviewedBy = String(b.reviewed_by ?? b.reviewedBy ?? '').trim();
  if (!villageId) return res.status(400).json({ error: 'village_id required' });
  if (!reviewedBy) return res.status(400).json({ error: 'reviewed_by required' });
  const id = getParam(req, 'id');
  if (!id) return res.status(400).json({ error: 'id required' });
  const fields = (b.fields ?? {}) as Record<string, unknown>;
  const result = await approveKtpVerification({
    villageId, id, reviewedBy,
    fields: {
      nik: String(fields.nik ?? ''),
      nama: String(fields.nama ?? ''),
      tempat_lahir: String(fields.tempat_lahir ?? ''),
      tanggal_lahir: String(fields.tanggal_lahir ?? ''),
      alamat: String(fields.alamat ?? ''),
    },
  });
  if (!result.ok) {
    const status = result.validationErrors ? 422 : 409;
    return res.status(status).json({ success: false, ...result });
  }
  res.json({ success: true });
});

/** POST /api/ktp-verifications/:id/reject */
router.post('/:id/reject', async (req: Request, res: Response) => {
  const b = req.body ?? {};
  const villageId = String(b.village_id ?? getQuery(req, 'village_id') ?? '');
  const reviewedBy = String(b.reviewed_by ?? b.reviewedBy ?? '').trim();
  const reason = String(b.reason ?? '').trim();
  if (!villageId) return res.status(400).json({ error: 'village_id required' });
  if (!reviewedBy) return res.status(400).json({ error: 'reviewed_by required' });
  if (!reason) return res.status(400).json({ error: 'reason required' });
  const id = getParam(req, 'id');
  if (!id) return res.status(400).json({ error: 'id required' });
  const result = await rejectKtpVerification({
    villageId, id, reviewedBy, reason,
  });
  if (!result.ok) {
    return res.status(409).json({ success: false, ...result });
  }
  res.json({ success: true });
});

export default router;
