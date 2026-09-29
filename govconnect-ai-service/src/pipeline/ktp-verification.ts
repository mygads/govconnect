/**
 * Manual KTP verification by village staff (admin).
 *
 * DECISION (user, 2026-09-29): automatic OCR is PARKED. When identity L2
 * is required and the citizen sends a KTP photo, the pipeline creates a
 * PENDING verification request and does NOT call any OCR. A human
 * (perangkat desa) reviews the photo in the dashboard and approves/rejects.
 *
 * State machine: pending → approved | rejected (one-way; conditional
 * UPDATEs so concurrent admin clicks cannot double-transition).
 *
 * Privacy (UU PDP):
 * - Photo bytes live ONLY in the pending row. On approve/reject the bytes
 *   are wiped (photo_bytes = NULL); metadata + audit trail stay.
 * - Photo bytes are NEVER sent to any AI/LLM/OCR — only to the admin's
 *   dashboard over the authenticated internal API.
 *
 * Approve effects:
 * 1. fields validated (validateKtpFields — pure),
 * 2. status → approved, photo wiped, reviewer + timestamp recorded,
 * 3. identity ladder L2 granted (identitySetVerified),
 * 4. citizen notified.
 */

import { randomUUID, createHash } from 'crypto';
import {
  getDb, dbDown, appendAudit, identitySetVerified,
} from './pipeline-store';
import { notifyCitizen } from './doc-reminders';
import logger from '../utils/logger';

export type KtpVerificationStatus = 'pending' | 'approved' | 'rejected';

export const KTP_RECEIVED_COPY =
  'Foto KTP sudah kami terima dan petugas desa akan memverifikasi. ' +
  'Mohon tunggu kabar selanjutnya.';

export const KTP_APPROVED_COPY =
  'Kabar baik! Identitas Bapak/Ibu sudah terverifikasi oleh petugas desa. ' +
  'Sekarang Bapak/Ibu dapat membuat pengaduan atau permohonan layanan. Silakan lanjutkan.';

export const KTP_REJECTED_COPY = (reason: string): string =>
  'Mohon maaf, foto KTP yang Bapak/Ibu kirim belum dapat kami verifikasi. ' +
  `Alasan petugas: ${reason}. ` +
  'Silakan kirim ulang foto KTP yang jelas (seluruh KTP terlihat, tidak blur, tidak terpotong).';

export const MAX_KTP_PHOTO_BYTES = 8 * 1024 * 1024;

export interface KtpFields {
  nik?: string;
  nama?: string;
  tempat_lahir?: string;
  tanggal_lahir?: string; // YYYY-MM-DD
  alamat?: string;
}

/** Pure field validation (Indonesian messages, dashboard-friendly). */
export function validateKtpFields(fields: KtpFields): string[] {
  const errors: string[] = [];
  const nik = String(fields.nik ?? '').replace(/\D/g, '');
  if (nik.length !== 16) errors.push('NIK harus 16 digit angka.');
  const nama = String(fields.nama ?? '').trim();
  if (nama.length < 3) errors.push('Nama harus diisi (minimal 3 huruf).');
  const ttl = String(fields.tanggal_lahir ?? '').trim();
  if (ttl) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ttl)) {
      errors.push('Tanggal lahir harus format YYYY-MM-DD.');
    } else {
      const d = new Date(ttl + 'T00:00:00Z');
      const now = new Date();
      if (Number.isNaN(d.getTime())) errors.push('Tanggal lahir tidak valid.');
      else if (d > now) errors.push('Tanggal lahir tidak boleh di masa depan.');
      else if (now.getFullYear() - d.getFullYear() > 120) errors.push('Tanggal lahir tidak wajar (>120 tahun).');
    }
  } else {
    errors.push('Tanggal lahir harus diisi.');
  }
  return errors;
}

export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export interface KtpVerificationRow {
  id: string;
  village_id: string;
  user_id: string;
  channel: string;
  status: KtpVerificationStatus;
  photo_sha256: string;
  photo_mime: string;
  fields: KtpFields;
  reviewed_by: string;
  reviewed_at: string | null;
  reject_reason: string;
  created_at: string;
  has_photo: boolean;
}

/**
 * Create a pending verification. Idempotent per citizen: if a pending
 * request already exists for (village, user), the existing id is returned
 * and no duplicate row is created.
 */
export async function createKtpVerification(input: {
  villageId: string; userId: string; channel?: string;
  photoBytes: Buffer; photoMime?: string;
}): Promise<{ id: string; created: boolean } | null> {
  const db = await getDb();
  if (!db) return dbDown('createKtpVerification', null);
  if (input.photoBytes.length > MAX_KTP_PHOTO_BYTES) {
    logger.warn('[ktp] photo too large, intake refused', { bytes: input.photoBytes.length });
    return null;
  }
  const channel = input.channel ?? 'whatsapp';
  try {
    const existing = (await db.$queryRawUnsafe(
      `SELECT id FROM pipeline_ktp_verifications
        WHERE village_id = $1 AND user_id = $2 AND status = 'pending'
        ORDER BY created_at DESC LIMIT 1`,
      input.villageId, input.userId,
    )) as Array<{ id: string }>;
    if (existing[0]) return { id: existing[0].id, created: false };
    const id = randomUUID();
    await db.$executeRawUnsafe(
      `INSERT INTO pipeline_ktp_verifications
         (id, village_id, user_id, channel, photo_bytes, photo_sha256, photo_mime)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      id, input.villageId, input.userId, channel,
      input.photoBytes, sha256Hex(input.photoBytes), input.photoMime ?? 'image/jpeg',
    );
    await appendAudit({
      tenantId: input.villageId, traceId: randomUUID(), userId: input.userId,
      channel, stage: 'INGRESS', event: 'ktp_verification_requested',
      payload: { verificationId: id },
    }).catch(() => undefined);
    return { id, created: true };
  } catch (err) {
    logger.warn('[ktp] create failed', { error: String((err as Error)?.message ?? err).slice(0, 120) });
    return null;
  }
}

function rowFromDb(r: any): KtpVerificationRow {
  return {
    id: r.id, village_id: r.village_id, user_id: r.user_id, channel: r.channel,
    status: r.status, photo_sha256: r.photo_sha256, photo_mime: r.photo_mime,
    fields: (r.fields ?? {}) as KtpFields,
    reviewed_by: r.reviewed_by, reviewed_at: r.reviewed_at ?? null,
    reject_reason: r.reject_reason ?? '', created_at: r.created_at,
    has_photo: r.has_photo ?? r.photo_bytes != null,
  };
}

export async function getKtpVerification(
  villageId: string, id: string,
): Promise<KtpVerificationRow | null> {
  const db = await getDb();
  if (!db) return dbDown('getKtpVerification', null);
  try {
    const rows = (await db.$queryRawUnsafe(
      `SELECT id, village_id, user_id, channel, status, photo_sha256, photo_mime,
              fields, reviewed_by, reviewed_at, reject_reason, created_at,
              (photo_bytes IS NOT NULL) AS has_photo
         FROM pipeline_ktp_verifications
        WHERE id = $1 AND village_id = $2 LIMIT 1`,
      id, villageId,
    )) as any[];
    return rows[0] ? rowFromDb(rows[0]) : null;
  } catch {
    return null;
  }
}

/** Photo bytes for the admin split-view. NEVER logged, NEVER sent to AI. */
export async function getKtpPhoto(
  villageId: string, id: string,
): Promise<{ bytes: Buffer; mime: string } | null> {
  const db = await getDb();
  if (!db) return dbDown('getKtpPhoto', null);
  try {
    const rows = (await db.$queryRawUnsafe(
      `SELECT photo_bytes, photo_mime FROM pipeline_ktp_verifications
        WHERE id = $1 AND village_id = $2 LIMIT 1`,
      id, villageId,
    )) as Array<{ photo_bytes: Buffer | null; photo_mime: string }>;
    const r = rows[0];
    if (!r?.photo_bytes) return null;
    return { bytes: r.photo_bytes, mime: r.photo_mime || 'image/jpeg' };
  } catch {
    return null;
  }
}

export async function listKtpVerifications(
  villageId: string, opts?: { status?: KtpVerificationStatus; limit?: number; offset?: number },
): Promise<{ items: KtpVerificationRow[]; total: number; pendingCount: number }> {
  const db = await getDb();
  const empty = { items: [], total: 0, pendingCount: 0 };
  if (!db) return dbDown('listKtpVerifications', empty);
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  const offset = Math.max(opts?.offset ?? 0, 0);
  try {
    const statusFilter = opts?.status ? `AND status = '${opts.status}'` : '';
    const items = (await db.$queryRawUnsafe(
      `SELECT id, village_id, user_id, channel, status, photo_sha256, photo_mime,
              fields, reviewed_by, reviewed_at, reject_reason, created_at,
              (photo_bytes IS NOT NULL) AS has_photo
         FROM pipeline_ktp_verifications
        WHERE village_id = $1 ${statusFilter}
        ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      villageId,
    )) as any[];
    const totals = (await db.$queryRawUnsafe(
      `SELECT count(*) FILTER (WHERE status = 'pending') AS pending,
              count(*) AS total
         FROM pipeline_ktp_verifications WHERE village_id = $1`,
      villageId,
    )) as Array<{ pending: string; total: string }>;
    return {
      items: items.map(rowFromDb),
      total: Number(totals[0]?.total ?? 0),
      pendingCount: Number(totals[0]?.pending ?? 0),
    };
  } catch {
    return empty;
  }
}

/** Wipe photo bytes after the decision (retention policy). Keeps metadata. */
async function wipeKtpPhoto(db: any, id: string): Promise<void> {
  await db.$executeRawUnsafe(
    `UPDATE pipeline_ktp_verifications SET photo_bytes = NULL WHERE id = $1`, id,
  );
}

export interface KtpDecision {
  ok: boolean;
  error?: string;
  validationErrors?: string[];
}

/** Approve: validate → pending→approved → L2 → wipe photo → notify. */
export async function approveKtpVerification(input: {
  villageId: string; id: string; reviewedBy: string; fields: KtpFields;
}): Promise<KtpDecision> {
  const db = await getDb();
  if (!db) return dbDown('approveKtpVerification', { ok: false, error: 'database_unavailable' });
  const validationErrors = validateKtpFields(input.fields);
  if (validationErrors.length > 0) return { ok: false, validationErrors };
  const traceId = randomUUID();
  try {
    const claimed = Number(await db.$executeRawUnsafe(
      `UPDATE pipeline_ktp_verifications
          SET status = 'approved', fields = $3::jsonb,
              reviewed_by = $4, reviewed_at = now(), reject_reason = ''
        WHERE id = $1 AND village_id = $2 AND status = 'pending'`,
      input.id, input.villageId,
      JSON.stringify({
        nik: String(input.fields.nik ?? '').replace(/\D/g, ''),
        nama: String(input.fields.nama ?? '').trim(),
        tempat_lahir: String(input.fields.tempat_lahir ?? '').trim(),
        tanggal_lahir: String(input.fields.tanggal_lahir ?? '').trim(),
        alamat: String(input.fields.alamat ?? '').trim(),
      }),
      input.reviewedBy.slice(0, 200),
    ) as unknown as number);
    if (claimed !== 1) {
      return { ok: false, error: 'not_pending_or_not_found' };
    }
    await wipeKtpPhoto(db, input.id);
    const ver = await getKtpVerification(input.villageId, input.id);
    if (ver) {
      await identitySetVerified(input.villageId, ver.user_id, input.reviewedBy, `KTP manual review ${input.id}`);
    }
    await appendAudit({
      tenantId: input.villageId, traceId, userId: ver?.user_id ?? '',
      channel: ver?.channel ?? 'whatsapp', stage: 'EXECUTE',
      event: 'ktp_verification_approved',
      payload: { verificationId: input.id, reviewedBy: input.reviewedBy },
    }).catch(() => undefined);
    if (ver) {
      await notifyCitizen(input.villageId, ver.user_id, KTP_APPROVED_COPY);
    }
    return { ok: true };
  } catch (err) {
    logger.warn('[ktp] approve failed', { error: String((err as Error)?.message ?? err).slice(0, 120) });
    return { ok: false, error: 'approve_failed' };
  }
}

/** Reject: reason required → pending→rejected → wipe photo → notify. */
export async function rejectKtpVerification(input: {
  villageId: string; id: string; reviewedBy: string; reason: string;
}): Promise<KtpDecision> {
  const db = await getDb();
  if (!db) return dbDown('rejectKtpVerification', { ok: false, error: 'database_unavailable' });
  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: 'reject_reason_required' };
  const traceId = randomUUID();
  try {
    const claimed = Number(await db.$executeRawUnsafe(
      `UPDATE pipeline_ktp_verifications
          SET status = 'rejected', reviewed_by = $4, reviewed_at = now(),
              reject_reason = $3
        WHERE id = $1 AND village_id = $2 AND status = 'pending'`,
      input.id, input.villageId, reason.slice(0, 500), input.reviewedBy.slice(0, 200),
    ) as unknown as number);
    if (claimed !== 1) {
      return { ok: false, error: 'not_pending_or_not_found' };
    }
    await wipeKtpPhoto(db, input.id);
    const ver = await getKtpVerification(input.villageId, input.id);
    await appendAudit({
      tenantId: input.villageId, traceId, userId: ver?.user_id ?? '',
      channel: ver?.channel ?? 'whatsapp', stage: 'EXECUTE',
      event: 'ktp_verification_rejected',
      payload: { verificationId: input.id, reviewedBy: input.reviewedBy, reason: reason.slice(0, 200) },
    }).catch(() => undefined);
    if (ver) {
      await notifyCitizen(input.villageId, ver.user_id, KTP_REJECTED_COPY(reason));
    }
    return { ok: true };
  } catch (err) {
    logger.warn('[ktp] reject failed', { error: String((err as Error)?.message ?? err).slice(0, 120) });
    return { ok: false, error: 'reject_failed' };
  }
}

/** Latest approved identity fields for slot pre-fill (verified data only). */
export async function getVerifiedIdentity(
  villageId: string, userId: string,
): Promise<KtpFields | null> {
  const db = await getDb();
  if (!db) return dbDown('getVerifiedIdentity', null);
  try {
    const rows = (await db.$queryRawUnsafe(
      `SELECT fields FROM pipeline_ktp_verifications
        WHERE village_id = $1 AND user_id = $2 AND status = 'approved'
        ORDER BY reviewed_at DESC LIMIT 1`,
      villageId, userId,
    )) as Array<{ fields: KtpFields }>;
    const f = rows[0]?.fields;
    return f && typeof f === 'object' ? f : null;
  } catch {
    return null;
  }
}

/**
 * Pre-fill identity-ish slots from VERIFIED data (not OCR). Pure.
 * Returns which slots were filled — for audit.
 */
export function prefillSlotsFromVerifiedIdentity(
  slots: Record<string, unknown>, identity: KtpFields,
): string[] {
  const filled: string[] = [];
  const put = (key: string, value: unknown) => {
    if (value && !slots[key]) {
      slots[key] = value;
      filled.push(key);
    }
  };
  put('reporter_name', identity.nama);
  put('nik', identity.nik);
  put('alamat', identity.alamat);
  return filled;
}
