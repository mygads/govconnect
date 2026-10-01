/**
 * Cross-Session Memory — "last interaction" injection.
 *
 * Saat user kembali (diidentifikasi via wa_user_id / session user id),
 * ringkasan interaksi TERAKHIR di-inject ke prompt context agar AI terasa
 * "ingat" dan personal:
 *
 *   "Interaksi terakhir (3 hari lalu): user lapor jalan rusak di RT 03,
 *    status: sudah diperbaiki."
 *
 * Design principles:
 *  - Additive: memanfaatkan user_memory_entries yang sudah ada via
 *    searchUserMemories(). Tidak mengubah skema memory existing.
 *  - Session summary: saveSessionSummary() menyimpan ringkasan max 200 char
 *    saat session berakhir. Dipanggil dari titik session-end yang sudah ada.
 *  - Privacy: PII (NIK, nomor HP, email) di-redact sebelum disimpan.
 *    Tidak menyimpan isi KTP/dokumen identitas di summary.
 *  - Never throws: aman dipanggil dari hot path.
 */

import prisma from '../lib/prisma';
import logger from '../utils/logger';
import { searchUserMemories } from './hybrid-memory.service';

const MAX_SUMMARY_LENGTH = 200;
const LAST_INTERACTION_MAX_AGE_DAYS = 30;

export interface LastInteraction {
  summary: string;
  days_ago: number;
  memory_type: string;
  created_at: Date;
}

/**
 * Redact PII dari teks summary.
 */
export function redactPiiForMemory(text: string): string {
  if (!text) return '';
  let out = text.slice(0, MAX_SUMMARY_LENGTH);
  out = out.replace(/\b\d{16}\b/g, '[NIK]');
  out = out.replace(/\b08\d{8,11}\b/g, '[HP]');
  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]');
  return out.trim();
}

/**
 * Ambil interaksi terakhir user (paling relevan & terbaru).
 * Return null jika tidak ada interaksi dalam 30 hari terakhir.
 */
export async function getLastInteraction(
  wa_user_id: string,
  village_id?: string,
): Promise<LastInteraction | null> {
  try {
    const memories = await searchUserMemories({
      wa_user_id,
      // Query generik agar dapat memori terbaru tanpa bias topik.
      query: 'laporan terakhir status',
      village_id,
      limit: 1,
    });
    if (memories.length === 0) return null;

    const m = memories[0];
    const ageMs = Date.now() - new Date(m.created_at).getTime();
    const daysAgo = Math.floor(ageMs / (24 * 60 * 60 * 1000));

    if (daysAgo > LAST_INTERACTION_MAX_AGE_DAYS) return null;

    return {
      summary: redactPiiForMemory(m.content),
      days_ago: daysAgo,
      memory_type: m.memory_type,
      created_at: new Date(m.created_at),
    };
  } catch (err) {
    logger.debug('[last-interaction] getLastInteraction failed (non-fatal)', {
      error: String((err as Error)?.message ?? err).slice(0, 120),
    });
    return null;
  }
}

/**
 * Format untuk inject ke prompt context.
 *
 * Contoh:
 *   "[INTERAKSI TERAKHIR — 3 hari lalu]\nuser lapor jalan rusak di RT 03, status: sudah diperbaiki."
 */
export function formatLastInteractionForPrompt(
  interaction: LastInteraction | null,
): string | undefined {
  if (!interaction) return undefined;

  const timeLabel =
    interaction.days_ago === 0
      ? 'hari ini'
      : interaction.days_ago === 1
        ? 'kemarin'
        : `${interaction.days_ago} hari lalu`;

  return (
    `[INTERAKSI TERAKHIR — ${timeLabel}]\n` +
    `${interaction.summary}\n` +
    `(Gunakan info ini agar respons terasa personal. Jangan sebut "data tersimpan" — bersikaplah natural.)`
  );
}

/**
 * One-shot: ambil + format, siap di-inject ke prompt.
 */
export async function buildLastInteractionContext(
  wa_user_id: string,
  village_id?: string,
): Promise<string | undefined> {
  const interaction = await getLastInteraction(wa_user_id, village_id);
  return formatLastInteractionForPrompt(interaction);
}

/**
 * Simpan ringkasan session saat session berakhir.
 *
 * @param wa_user_id - identitas user
 * @param summary - ringkasan bebas (akan di-redact + dipotong 200 char)
 * @param memory_type - tipe memori (default: 'session_summary')
 * @param village_id - scope desa
 *
 * Contoh summary: "User lapor jalan rusak di RT 03. Tiket LAP-20261001-001 dibuat, status OPEN."
 */
export async function saveSessionSummary(input: {
  wa_user_id: string;
  summary: string;
  memory_type?: string;
  village_id?: string;
  memory_key?: string;
}): Promise<void> {
  try {
    const clean = redactPiiForMemory(input.summary);
    if (!clean) return;

    await prisma.user_memory_entries.create({
      data: {
        wa_user_id: input.wa_user_id,
        village_id: input.village_id ?? null,
        memory_type: input.memory_type ?? 'session_summary',
        memory_key: input.memory_key ?? `session_${Date.now()}`,
        content: clean,
        importance: 0.7, // session summary: penting tapi di bawah complaint aktif
      },
    });
    logger.debug('[last-interaction] session summary saved', {
      wa_user_id: input.wa_user_id.slice(0, 8) + '...',
    });
  } catch (err) {
    logger.debug('[last-interaction] saveSessionSummary failed (non-fatal)', {
      error: String((err as Error)?.message ?? err).slice(0, 120),
    });
  }
}
