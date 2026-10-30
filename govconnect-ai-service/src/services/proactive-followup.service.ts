/**
 * Proactive Follow-up — AI yang "nagih", bukan cuma ditanya.
 *
 * Mencari complaints yang stagnan (status OPEN/PENDING > N hari tanpa update),
 * lalu menghasilkan kandidat pesan follow-up natural untuk dikirim ke warga.
 *
 * Design principles:
 *  - TIDAK ada pengiriman otomatis. findStaleComplaints() hanya me-return
 *    KANDIDAT. Pengiriman tetap butuh approval admin/user (via dashboard
 *    atau endpoint terpisah). Ini mencegah spam dan menjaga kepercayaan warga.
 *  - Additive only: tidak mengubah flow complaint existing.
 *  - Never throws: aman dipanggil dari cron/endpoint.
 *  - Privacy: pesan follow-up tidak memuat PII selain nama pelapor (jika ada).
 */

import prisma from '../lib/prisma';
import logger from '../utils/logger';

export interface StaleComplaint {
  id: string;
  complaint_id: string;
  wa_user_id: string | null;
  village_id: string;
  kategori: string;
  deskripsi: string;
  rt_rw: string | null;
  reporter_name: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  days_stale: number;
}

export interface FollowupCandidate {
  complaint: StaleComplaint;
  message: string;
  suggested_action: 'check_status' | 'ask_update' | 'escalate';
}

const DEFAULT_STALE_DAYS = 3;
const MAX_CANDIDATES = 50;

/**
 * Cari complaints yang stagnan: status masih OPEN/PENDING/IN_PROGRESS
 * dan tidak ada update selama >= staleDays hari.
 */
export async function findStaleComplaints(
  villageId?: string,
  staleDays: number = DEFAULT_STALE_DAYS,
): Promise<StaleComplaint[]> {
  try {
    const villageFilter = villageId
      ? `AND c.village_id = '${villageId.replace(/'/g, "''")}'`
      : '';
    // Pakai $queryRaw dengan Prisma.sql untuk aman dari injection.
    const { Prisma } = await import('@prisma/client');
    const rows = await prisma.$queryRaw<StaleComplaint[]>`
      SELECT
        c.id,
        c.complaint_id,
        c.wa_user_id,
        c.village_id,
        c.kategori,
        c.deskripsi,
        c.rt_rw,
        c.reporter_name,
        c.status,
        c.created_at,
        c.updated_at,
        EXTRACT(DAY FROM NOW() - c.updated_at)::int AS days_stale
      FROM cases.complaints c
      WHERE c.deleted_at IS NULL
        AND c.status IN ('OPEN', 'PENDING', 'IN_PROGRESS', 'VERIFIED')
        AND c.updated_at < NOW() - (${staleDays} * INTERVAL '1 day')
        ${villageId ? Prisma.sql`AND c.village_id = ${villageId}` : Prisma.sql``}
      ORDER BY c.updated_at ASC
      LIMIT ${MAX_CANDIDATES}
    `;
    return rows;
  } catch (err) {
    logger.warn('[proactive-followup] findStaleComplaints failed', {
      error: String((err as Error)?.message ?? err).slice(0, 120),
    });
    return [];
  }
}

/**
 * Buat pesan follow-up natural dalam Bahasa Indonesia.
 *
 * Contoh output:
 *   "Pak, laporan jalan rusak di RT 03 sudah 3 hari. Mau saya cek statusnya ke petugas?"
 */
export function generateFollowupMessage(complaint: StaleComplaint): FollowupCandidate {
  const name = complaint.reporter_name?.trim();
  const greeting = name ? `${name}, ` : 'Pak/Bu, ';

  // Ringkas deskripsi: max 60 char, tanpa PII.
  const shortDesc = summarizeDeskripsi(complaint.deskripsi);
  const lokasi = complaint.rt_rw ? ` di ${complaint.rt_rw}` : '';
  const days = complaint.days_stale;

  let message: string;
  let suggested_action: FollowupCandidate['suggested_action'];

  if (days >= 7) {
    // Sudah seminggu: tawarkan eskalasi.
    message =
      `${greeting}laporan ${shortDesc}${lokasi} sudah ${days} hari belum ada kabar. ` +
      `Mau saya teruskan langsung ke perangkat desa agar diprioritaskan?`;
    suggested_action = 'escalate';
  } else if (days >= DEFAULT_STALE_DAYS) {
    // 3-6 hari: cek status biasa.
    message =
      `${greeting}laporan ${shortDesc}${lokasi} sudah ${days} hari. ` +
      `Mau saya cek statusnya ke petugas?`;
    suggested_action = 'check_status';
  } else {
    // < 3 hari tapi masuk kandidat (edge): tanya update ringan.
    message =
      `${greeting}sekadar mengabari, laporan ${shortDesc}${lokasi} sedang diproses. ` +
      `Ada info tambahan yang ingin disampaikan?`;
    suggested_action = 'ask_update';
  }

  return { complaint, message, suggested_action };
}

/**
 * Ringkas deskripsi keluhan jadi frasa pendek untuk pesan follow-up.
 * - Max 60 karakter.
 * - Redact potensi PII (NIK, nomor HP).
 */
function summarizeDeskripsi(deskripsi: string): string {
  let s = (deskripsi ?? '').trim();
  s = s.replace(/\b\d{16}\b/g, '[redacted]');
  s = s.replace(/\b08\d{8,11}\b/g, '[redacted]');
  // Ambil kalimat pertama atau potong 60 char.
  const firstSentence = s.split(/[.!?\n]/)[0]?.trim() ?? s;
  const short = firstSentence.length > 60 ? firstSentence.slice(0, 57) + '...' : firstSentence;
  return short || 'keluhan Bapak/Ibu';
}

/**
 * One-shot: ambil kandidat follow-up untuk satu desa (atau semua desa).
 * Return siap ditampilkan di dashboard untuk approval admin.
 */
export async function getFollowupCandidates(
  villageId?: string,
  staleDays: number = DEFAULT_STALE_DAYS,
): Promise<FollowupCandidate[]> {
  const stale = await findStaleComplaints(villageId, staleDays);
  const candidates = stale
    // Hanya yang punya wa_user_id (bisa dihubungi kembali).
    .filter((c) => c.wa_user_id)
    .map(generateFollowupMessage);
  logger.info('[proactive-followup] candidates generated', {
    villageId: villageId ?? 'all',
    staleCount: stale.length,
    candidateCount: candidates.length,
  });
  return candidates;
}
