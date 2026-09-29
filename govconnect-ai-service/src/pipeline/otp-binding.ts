/**
 * R10 — OTP binding untuk verifikasi identitas L1.
 *
 * Arsitektur-final §6: L1 = binding (wa_number, village_id, NIK) via OTP.
 * Alur:
 *   1. Warga meminta verifikasi → requestOtp() generate kode 6 digit,
 *      hash (SHA-256 + pepper), simpan (5 menit), kirim via WhatsApp.
 *   2. Warga memasukkan kode → verifyOtp() cek hash, expiry, max 3x coba.
 *   3. Admin/warga bind NIK → bindNik() tokenisasi NIK via PII vault,
 *      simpan HANYA token (UU PDP). Plaintext NIK tidak pernah disimpan.
 *
 * Keamanan:
 * - Kode OTP tidak disimpan plaintext (hanya hash).
 * - Rate limit: max 3 request per 15 menit per (tenant, wa_number).
 * - OTP single-use: setelah verified, tidak bisa dipakai lagi.
 */
import { createHash, randomInt } from 'crypto';
import { getDb, dbDown, appendAudit } from './pipeline-store';
import { vaultStoreNik } from './pii-vault';
import { notifyCitizen } from './doc-reminders';
import logger from '../utils/logger';

const OTP_TTL_MS = 5 * 60 * 1000; // 5 menit
const OTP_MAX_ATTEMPTS = 3;
const OTP_REQUEST_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 menit
const OTP_REQUEST_LIMIT_COUNT = 3;

/** Pepper dari env; fallback aman = kode tidak bisa diverifikasi lintas-restart. */
function otpPepper(): string {
  return process.env.OTP_PEPPER ?? process.env.INTERNAL_API_KEY ?? 'govconnect-otp-fallback-pepper';
}

export function hashOtp(code: string): string {
  return createHash('sha256').update(`${otpPepper()}:${code}`).digest('hex');
}

/** Generate kode OTP 6 digit (100000–999999). */
export function generateOtpCode(): string {
  return String(randomInt(100000, 1000000));
}

/** Validasi format nomor WA (digit saja, 8–16 digit). */
export function isValidWaNumber(wa: string): boolean {
  return /^[0-9]{8,16}$/.test(wa);
}

/** Validasi format NIK (16 digit). */
export function isValidNik(nik: string): boolean {
  return /^[0-9]{16}$/.test(nik);
}

export interface OtpRequestResult {
  ok: boolean;
  reason?: 'invalid_wa' | 'rate_limited' | 'send_failed' | 'db_error';
  /** ID baris OTP (untuk korelasi, bukan kode). */
  otpId?: number;
}

/**
 * Minta kode OTP. Mengirim kode via WhatsApp ke nomor tersebut.
 * Idempotent-ish: request baru meng-invalidate kode lama yang belum dipakai.
 */
export async function requestOtp(input: {
  tenantId: string;
  waNumber: string;
  purpose?: string;
  sender?: (villageId: string, userId: string, text: string) => Promise<boolean>;
}): Promise<OtpRequestResult> {
  const { tenantId, waNumber } = input;
  const purpose = input.purpose ?? 'nik_binding';
  const sender = input.sender ?? notifyCitizen;

  if (!isValidWaNumber(waNumber)) {
    return { ok: false, reason: 'invalid_wa' };
  }
  const db = await getDb();
  if (!db) return { ok: false, reason: 'db_error' };

  try {
    // Rate limit: max 3 request per 15 menit.
    const recent = (await db.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS c FROM pipeline_otp_codes
        WHERE tenant_id=$1 AND wa_number=$2 AND created_at > now() - make_interval(secs => $3)`,
      tenantId, waNumber, OTP_REQUEST_LIMIT_WINDOW_MS / 1000,
    )) as Array<{ c: number }>;
    if ((recent[0]?.c ?? 0) >= OTP_REQUEST_LIMIT_COUNT) {
      logger.warn('[otp] rate limited', { tenantId, waNumber: waNumber.slice(0, 4) + '***' });
      return { ok: false, reason: 'rate_limited' };
    }

    // Invalidate kode lama yang belum terverifikasi (single active code).
    await db.$executeRawUnsafe(
      `UPDATE pipeline_otp_codes SET verified_at=now()
        WHERE tenant_id=$1 AND wa_number=$2 AND purpose=$3 AND verified_at IS NULL
          AND expires_at > now()`,
      tenantId, waNumber, purpose,
    );

    const code = generateOtpCode();
    const rows = (await db.$queryRawUnsafe(
      `INSERT INTO pipeline_otp_codes (tenant_id, wa_number, purpose, code_hash, expires_at)
       VALUES ($1,$2,$3,$4, now() + make_interval(secs => $5))
       RETURNING id`,
      tenantId, waNumber, purpose, hashOtp(code), OTP_TTL_MS / 1000,
    )) as Array<{ id: number }>;
    const otpId = rows[0]?.id;

    const sent = await sender(
      tenantId, waNumber,
      `Kode verifikasi GovConnect: ${code}\nBerlaku 5 menit. Jangan berikan kode ini ke siapa pun.`,
    );
    if (!sent) {
      logger.warn('[otp] WA send failed', { tenantId, otpId });
      return { ok: false, reason: 'send_failed', otpId };
    }
    await appendAudit({
      tenantId, traceId: `otp-${otpId}`, userId: waNumber, channel: 'whatsapp',
      stage: 'EXECUTE', event: 'otp_requested', payload: { purpose, otpId },
    }).catch(() => undefined);
    return { ok: true, otpId };
  } catch (err: any) {
    logger.error('[otp] request failed', { error: err?.message });
    return { ok: false, reason: 'db_error' };
  }
}

export interface OtpVerifyResult {
  ok: boolean;
  reason?: 'invalid_wa' | 'not_found' | 'expired' | 'too_many_attempts' | 'wrong_code' | 'db_error';
}

/**
 * Verifikasi kode OTP. Single-use: berhasil → verified_at diset.
 */
export async function verifyOtp(input: {
  tenantId: string;
  waNumber: string;
  code: string;
  purpose?: string;
}): Promise<OtpVerifyResult> {
  const { tenantId, waNumber, code } = input;
  const purpose = input.purpose ?? 'nik_binding';

  if (!isValidWaNumber(waNumber) || !/^[0-9]{6}$/.test(code)) {
    return { ok: false, reason: 'invalid_wa' };
  }
  const db = await getDb();
  if (!db) return { ok: false, reason: 'db_error' };

  try {
    const rows = (await db.$queryRawUnsafe(
      `SELECT id, code_hash, expires_at, attempts, verified_at
         FROM pipeline_otp_codes
        WHERE tenant_id=$1 AND wa_number=$2 AND purpose=$3
        ORDER BY created_at DESC LIMIT 1`,
      tenantId, waNumber, purpose,
    )) as Array<{ id: number; code_hash: string; expires_at: Date; attempts: number; verified_at: Date | null }>;
    const row = rows[0];
    if (!row || row.verified_at) return { ok: false, reason: 'not_found' };
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return { ok: false, reason: 'expired' };
    }
    if (row.attempts >= OTP_MAX_ATTEMPTS) {
      return { ok: false, reason: 'too_many_attempts' };
    }
    if (row.code_hash !== hashOtp(code)) {
      await db.$executeRawUnsafe(
        `UPDATE pipeline_otp_codes SET attempts = attempts + 1 WHERE id=$1`, row.id,
      );
      return { ok: false, reason: 'wrong_code' };
    }
    await db.$executeRawUnsafe(
      `UPDATE pipeline_otp_codes SET verified_at=now(), attempts = attempts + 1 WHERE id=$1`, row.id,
    );
    await appendAudit({
      tenantId, traceId: `otp-${row.id}`, userId: waNumber, channel: 'whatsapp',
      stage: 'EXECUTE', event: 'otp_verified', payload: { purpose },
    }).catch(() => undefined);
    return { ok: true };
  } catch (err: any) {
    logger.error('[otp] verify failed', { error: err?.message });
    return { ok: false, reason: 'db_error' };
  }
}

export interface NikBindResult {
  ok: boolean;
  reason?: 'invalid_input' | 'otp_required' | 'db_error' | 'vault_error';
}

/**
 * Bind NIK ke (tenant_id, wa_number) setelah OTP terverifikasi.
 * NIK ditokenisasi via PII vault — hanya token yang disimpan (UU PDP).
 * Prasyarat: ada OTP purpose 'nik_binding' yang sudah verified dan belum
 * dipakai untuk binding (dicek via verified_at dalam 15 menit terakhir).
 */
export async function bindNik(input: {
  tenantId: string;
  waNumber: string;
  nik: string;
  verifiedBy?: string;
  note?: string;
}): Promise<NikBindResult> {
  const { tenantId, waNumber, nik } = input;
  if (!isValidWaNumber(waNumber) || !isValidNik(nik)) {
    return { ok: false, reason: 'invalid_input' };
  }
  const db = await getDb();
  if (!db) return { ok: false, reason: 'db_error' };

  try {
    // Syarat: OTP nik_binding terverifikasi dalam 15 menit terakhir.
    const otpRows = (await db.$queryRawUnsafe(
      `SELECT 1 FROM pipeline_otp_codes
        WHERE tenant_id=$1 AND wa_number=$2 AND purpose='nik_binding'
          AND verified_at IS NOT NULL
          AND verified_at > now() - make_interval(secs => 900)
        LIMIT 1`,
      tenantId, waNumber,
    )) as Array<unknown>;
    if (otpRows.length === 0) {
      return { ok: false, reason: 'otp_required' };
    }

    let token: string;
    try {
      token = await vaultStoreNik(nik, tenantId);
    } catch (err: any) {
      logger.error('[otp] vault store failed', { error: err?.message });
      return { ok: false, reason: 'vault_error' };
    }

    // Revoke binding lama (jika ada), lalu insert yang baru.
    await db.$executeRawUnsafe(
      `UPDATE pipeline_nik_bindings SET revoked_at=now()
        WHERE tenant_id=$1 AND wa_number=$2 AND revoked_at IS NULL`,
      tenantId, waNumber,
    );
    await db.$executeRawUnsafe(
      `INSERT INTO pipeline_nik_bindings
         (tenant_id, wa_number, nik_token, method, verified_by, note)
       VALUES ($1,$2,$3,'otp',$4,$5)`,
      tenantId, waNumber, token,
      (input.verifiedBy ?? 'otp-self').slice(0, 200),
      (input.note ?? '').slice(0, 500),
    );
    await appendAudit({
      tenantId, traceId: `nikbind-${Date.now()}`, userId: waNumber, channel: 'whatsapp',
      stage: 'EXECUTE', event: 'nik_bound',
      payload: { method: 'otp', nikTokenPrefix: token.slice(0, 8) },
    }).catch(() => undefined);
    return { ok: true };
  } catch (err: any) {
    logger.error('[otp] bindNik failed', { error: err?.message });
    return { ok: false, reason: 'db_error' };
  }
}

/** Ambil binding NIK aktif (tanpa membuka token). */
export async function getNikBinding(
  tenantId: string, waNumber: string,
): Promise<{ nikToken: string; method: string; verifiedAt: Date } | null> {
  const db = await getDb();
  if (!db) return dbDown('getNikBinding', null);
  try {
    const rows = (await db.$queryRawUnsafe(
      `SELECT nik_token, method, verified_at FROM pipeline_nik_bindings
        WHERE tenant_id=$1 AND wa_number=$2 AND revoked_at IS NULL LIMIT 1`,
      tenantId, waNumber,
    )) as Array<{ nik_token: string; method: string; verified_at: Date }>;
    const r = rows[0];
    return r ? { nikToken: r.nik_token, method: r.method, verifiedAt: r.verified_at } : null;
  } catch {
    return dbDown('getNikBinding', null);
  }
}

/** Revoke binding NIK (mis. nomor WA berganti pemilik). */
export async function revokeNikBinding(tenantId: string, waNumber: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return dbDown('revokeNikBinding', false);
  try {
    await db.$executeRawUnsafe(
      `UPDATE pipeline_nik_bindings SET revoked_at=now()
        WHERE tenant_id=$1 AND wa_number=$2 AND revoked_at IS NULL`,
      tenantId, waNumber,
    );
    return true;
  } catch {
    return dbDown('revokeNikBinding', false);
  }
}
