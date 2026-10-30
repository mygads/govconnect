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
import {
  requestOtp, verifyOtp, bindNik, getNikBinding, revokeNikBinding,
  isValidWaNumber, isValidNik,
} from '../pipeline/otp-binding';
import { getSidAdapter, isSidConfigured } from '../pipeline/sid-adapter';
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
// ── R10: OTP binding + NIK binding ─────────────────────────────────────
// Semua endpoint di bawah memakai verifyInternalKey yang sama (admin /
// dashboard proxy). OTP dikirim via WhatsApp oleh ai-service sendiri.

function bodyStr(v: unknown): string {
  return String((v as string) ?? '').trim();
}

/**
 * POST /api/identity/otp/request { village_id, wa_number, purpose? }
 * Generate + kirim OTP 6 digit via WhatsApp. Rate-limited 3x/15 mnt.
 */
router.post('/otp/request', async (req: Request, res: Response) => {
  if (!verifyInternalKey(req, res)) return;
  const villageId = bodyStr(req.body?.village_id);
  const waNumber = bodyStr(req.body?.wa_number).replace(/^\+/, '');
  const purpose = bodyStr(req.body?.purpose) || 'nik_binding';
  if (!villageId || !isValidWaNumber(waNumber)) {
    return res.status(400).json({ error: 'village_id dan wa_number (8-16 digit) wajib' });
  }
  const result = await requestOtp({ tenantId: villageId, waNumber, purpose });
  if (!result.ok) {
    const status = result.reason === 'rate_limited' ? 429 : 502;
    return res.status(status).json({ success: false, reason: result.reason });
  }
  return res.json({ success: true, otp_id: result.otpId });
});

/**
 * POST /api/identity/otp/verify { village_id, wa_number, code, purpose? }
 * Verifikasi kode OTP (single-use, max 3x coba, 5 menit).
 */
router.post('/otp/verify', async (req: Request, res: Response) => {
  if (!verifyInternalKey(req, res)) return;
  const villageId = bodyStr(req.body?.village_id);
  const waNumber = bodyStr(req.body?.wa_number).replace(/^\+/, '');
  const code = bodyStr(req.body?.code);
  const purpose = bodyStr(req.body?.purpose) || 'nik_binding';
  if (!villageId || !waNumber || !code) {
    return res.status(400).json({ error: 'village_id, wa_number, code wajib' });
  }
  const result = await verifyOtp({ tenantId: villageId, waNumber, code, purpose });
  if (!result.ok) {
    return res.status(400).json({ success: false, reason: result.reason });
  }
  return res.json({ success: true });
});

/**
 * POST /api/identity/nik/bind { village_id, wa_number, nik, verified_by?, note? }
 * Bind NIK setelah OTP terverifikasi. NIK ditokenisasi via PII vault —
 * plaintext tidak disimpan (UU PDP).
 */
router.post('/nik/bind', async (req: Request, res: Response) => {
  if (!verifyInternalKey(req, res)) return;
  const villageId = bodyStr(req.body?.village_id);
  const waNumber = bodyStr(req.body?.wa_number).replace(/^\+/, '');
  const nik = bodyStr(req.body?.nik);
  if (!villageId || !isValidWaNumber(waNumber) || !isValidNik(nik)) {
    return res.status(400).json({ error: 'village_id, wa_number valid, dan nik 16 digit wajib' });
  }
  const result = await bindNik({
    tenantId: villageId, waNumber, nik,
    verifiedBy: bodyStr(req.body?.verified_by),
    note: bodyStr(req.body?.note),
  });
  if (!result.ok) {
    const status = result.reason === 'otp_required' ? 403 : 500;
    return res.status(status).json({ success: false, reason: result.reason });
  }
  logger.info('NIK bound via OTP', { villageId, waNumber: waNumber.slice(0, 4) + '***' });
  return res.json({ success: true });
});

/**
 * GET /api/identity/nik/binding?village_id=…&wa_number=…
 * Status binding (tanpa membuka token NIK).
 */
router.get('/nik/binding', async (req: Request, res: Response) => {
  if (!verifyInternalKey(req, res)) return;
  const villageId = bodyStr(req.query?.village_id);
  const waNumber = bodyStr(req.query?.wa_number).replace(/^\+/, '');
  if (!villageId || !isValidWaNumber(waNumber)) {
    return res.status(400).json({ error: 'village_id dan wa_number wajib' });
  }
  const binding = await getNikBinding(villageId, waNumber);
  return res.json({
    success: true,
    bound: !!binding,
    method: binding?.method ?? null,
    verified_at: binding?.verifiedAt ?? null,
  });
});

/**
 * POST /api/identity/nik/revoke { village_id, wa_number }
 */
router.post('/nik/revoke', async (req: Request, res: Response) => {
  if (!verifyInternalKey(req, res)) return;
  const villageId = bodyStr(req.body?.village_id);
  const waNumber = bodyStr(req.body?.wa_number).replace(/^\+/, '');
  if (!villageId || !isValidWaNumber(waNumber)) {
    return res.status(400).json({ error: 'village_id dan wa_number wajib' });
  }
  const ok = await revokeNikBinding(villageId, waNumber);
  return res.json({ success: ok });
});

/**
 * GET /api/identity/sid/status?village_id=…
 * Jujur: apakah desa ini terhubung ke SID/OpenSID? Hari ini selalu false
 * kecuali adapter didaftarkan via registerSidAdapter().
 */
router.get('/sid/status', async (req: Request, res: Response) => {
  if (!verifyInternalKey(req, res)) return;
  const villageId = bodyStr(req.query?.village_id);
  if (!villageId) return res.status(400).json({ error: 'village_id wajib' });
  const configured = await isSidConfigured(villageId);
  return res.json({
    success: true,
    village_id: villageId,
    sid_configured: configured,
    adapter: getSidAdapter(villageId).name,
    note: configured
      ? 'SID terhubung untuk desa ini.'
      : 'SID/OpenSID belum dikonfigurasi. Verifikasi L2 tetap via jalur administratif manual oleh perangkat desa.',
  });
});

export default router;
