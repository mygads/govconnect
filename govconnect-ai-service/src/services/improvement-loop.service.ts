/**
 * Improvement Loop — pola Fin Operator (arsitektur v4).
 *
 * Setiap percakapan yang berakhir dengan fallback / error / handoff dicatat
 * sebagai "failure". Secara berkala, failures diagregasi untuk menemukan pola
 * yang berulang, lalu menghasilkan saran perbaikan konkret:
 *   - tambah question variant untuk frasa yang sering gagal
 *   - tambah dokumen KB untuk topik yang tidak terjawab
 *   - perbaiki prompt/stage yang sering salah
 *
 * Design principles:
 *  - Additive only: tidak mengubah flow existing. recordFailure() dipanggil
 *    dari titik-titik failure yang sudah ada (fallback, error, handoff).
 *  - Never throws: semua fungsi aman dipanggil dari hot path.
 *  - Privacy: user_message disimpan max 500 char, dan PII (NIK 16 digit,
 *    nomor HP) di-redact sebelum disimpan.
 *  - Human-in-the-loop: suggestImprovements() hanya MENGUSULKAN. Tidak ada
 *    perubahan otomatis ke KB/prompt tanpa approval admin.
 */

import prisma from '../lib/prisma';
import logger from '../utils/logger';

export type FailureType =
  | 'fallback'        // agent tidak bisa jawab -> fallback generik
  | 'error'           // exception / AGENT_ERROR
  | 'handoff'         // diserahkan ke petugas manusia
  | 'low_confidence'  // assessor confidence < threshold
  | 'empty_output';   // LLM return kosong

export interface FailureInput {
  village_id: string;
  session_id: string;
  user_message: string;
  failure_type: FailureType;
  stage?: string;
  intent?: string;
}

export interface FailurePattern {
  failure_type: FailureType;
  stage: string | null;
  count: number;
  sample_messages: string[];
  first_seen: Date;
  last_seen: Date;
}

export interface ImprovementSuggestion {
  pattern: FailurePattern;
  suggestion_type: 'add_question_variant' | 'add_kb_document' | 'fix_prompt' | 'review_stage_routing';
  suggestion: string;
  priority: 'high' | 'medium' | 'low';
}

const MAX_MESSAGE_LENGTH = 500;
const ANALYSIS_WINDOW_DAYS = 7;
const PATTERN_THRESHOLD = 5; // pola muncul >5x dalam 7 hari -> saran

/**
 * Redact PII dari pesan sebelum disimpan.
 * - NIK: 16 digit berurutan -> [NIK_REDACTED]
 * - Nomor HP: 08xx dengan 9-13 digit -> [PHONE_REDACTED]
 */
export function redactPii(text: string): string {
  if (!text) return '';
  let out = text.slice(0, MAX_MESSAGE_LENGTH);
  // NIK: 16 digit
  out = out.replace(/\b\d{16}\b/g, '[NIK_REDACTED]');
  // Nomor HP Indonesia: 08 diikuti 8-11 digit
  out = out.replace(/\b08\d{8,11}\b/g, '[PHONE_REDACTED]');
  // Email
  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[EMAIL_REDACTED]');
  return out;
}

async function ensureTable(): Promise<void> {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS ai.conversation_failures (
      id TEXT PRIMARY KEY,
      village_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      user_message TEXT NOT NULL,
      failure_type TEXT NOT NULL,
      stage TEXT,
      intent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS idx_conv_failures_village_created
    ON ai.conversation_failures (village_id, created_at DESC)
  `;
  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS idx_conv_failures_type
    ON ai.conversation_failures (failure_type, created_at DESC)
  `;
}

let tableEnsured = false;

/**
 * Catat satu failure. Aman dipanggil dari hot path — tidak pernah throw.
 */
export async function recordFailure(input: FailureInput): Promise<void> {
  try {
    if (!tableEnsured) {
      await ensureTable();
      tableEnsured = true;
    }
    const { randomUUID } = await import('crypto');
    await prisma.$executeRaw`
      INSERT INTO ai.conversation_failures
        (id, village_id, session_id, user_message, failure_type, stage, intent)
      VALUES (
        ${randomUUID()},
        ${input.village_id},
        ${input.session_id},
        ${redactPii(input.user_message)},
        ${input.failure_type},
        ${input.stage ?? null},
        ${input.intent ?? null}
      )
    `;
  } catch (err) {
    // Improvement loop tidak boleh merusak percakapan user.
    logger.debug('[improvement-loop] recordFailure failed (non-fatal)', {
      error: String((err as Error)?.message ?? err).slice(0, 120),
    });
  }
}

/**
 * Agregasi failures dalam N hari terakhir per (failure_type, stage).
 * Return pola teratas, diurut dari yang paling sering.
 */
export async function analyzeFailures(
  villageId: string,
  days: number = ANALYSIS_WINDOW_DAYS,
): Promise<FailurePattern[]> {
  try {
    if (!tableEnsured) {
      await ensureTable();
      tableEnsured = true;
    }
    const rows = await prisma.$queryRaw<FailurePattern[]>`
      SELECT
        failure_type,
        stage,
        COUNT(*)::int AS count,
        ARRAY_AGG(user_message ORDER BY created_at DESC) AS sample_messages,
        MIN(created_at) AS first_seen,
        MAX(created_at) AS last_seen
      FROM ai.conversation_failures
      WHERE village_id = ${villageId}
        AND created_at >= NOW() - (${days} * INTERVAL '1 day')
      GROUP BY failure_type, stage
      ORDER BY COUNT(*) DESC
      LIMIT 20
    `;
    // Batasi sample messages ke 3 terbaru per pola (hemat memori).
    return rows.map((r) => ({
      ...r,
      sample_messages: (r.sample_messages ?? []).slice(0, 3),
    }));
  } catch (err) {
    logger.warn('[improvement-loop] analyzeFailures failed', {
      error: String((err as Error)?.message ?? err).slice(0, 120),
    });
    return [];
  }
}

/**
 * Untuk setiap pola yang muncul > threshold, generate saran perbaikan konkret.
 * Ini HEURISTIK berbasis aturan — bukan LLM — agar murah dan deterministik.
 * Saran LLM yang lebih kaya bisa ditambahkan nanti sebagai enhancement.
 */
export function suggestImprovements(
  patterns: FailurePattern[],
  threshold: number = PATTERN_THRESHOLD,
): ImprovementSuggestion[] {
  const suggestions: ImprovementSuggestion[] = [];

  for (const pattern of patterns) {
    if (pattern.count <= threshold) continue;

    const samples = pattern.sample_messages.slice(0, 3).join(' | ').slice(0, 200);
    const priority: 'high' | 'medium' | 'low' =
      pattern.count > threshold * 3 ? 'high' : pattern.count > threshold * 1.5 ? 'medium' : 'low';

    switch (pattern.failure_type) {
      case 'fallback':
        suggestions.push({
          pattern,
          suggestion_type: 'add_kb_document',
          priority,
          suggestion:
            `Topik tidak terjawab ${pattern.count}x dalam 7 hari` +
            (pattern.stage ? ` pada stage ${pattern.stage}` : '') +
            `. Contoh: "${samples}". ` +
            `Saran: tambah/ perbaiki dokumen KB untuk topik ini, atau tambah question variants.`,
        });
        break;

      case 'low_confidence':
        suggestions.push({
          pattern,
          suggestion_type: 'add_question_variant',
          priority,
          suggestion:
            `Assessor ragu ${pattern.count}x dalam 7 hari` +
            (pattern.stage ? ` (stage: ${pattern.stage})` : '') +
            `. Contoh: "${samples}". ` +
            `Saran: tambah question variants untuk frasa-frasa ini agar routing lebih yakin.`,
        });
        break;

      case 'handoff':
        suggestions.push({
          pattern,
          suggestion_type: 'review_stage_routing',
          priority,
          suggestion:
            `${pattern.count}x handoff ke petugas dalam 7 hari` +
            (pattern.stage ? ` dari stage ${pattern.stage}` : '') +
            `. Contoh: "${samples}". ` +
            `Saran: review apakah kasus-kasus ini seharusnya bisa ditangani AI (tambah KB/flow), ` +
            `atau memang benar perlu manusia (pastikan queue admin termonitor).`,
        });
        break;

      case 'error':
      case 'empty_output':
        suggestions.push({
          pattern,
          suggestion_type: 'fix_prompt',
          priority: 'high',
          suggestion:
            `${pattern.count}x ${pattern.failure_type} dalam 7 hari` +
            (pattern.stage ? ` pada stage ${pattern.stage}` : '') +
            `. Contoh: "${samples}". ` +
            `Saran: investigasi teknis — cek log AI gateway untuk error rate provider, ` +
            `atau perbaiki prompt yang menyebabkan empty output.`,
        });
        break;
    }
  }

  return suggestions;
}

/**
 * One-shot: analisis + saran untuk satu desa.
 */
export async function runImprovementCycle(
  villageId: string,
): Promise<{ patterns: FailurePattern[]; suggestions: ImprovementSuggestion[] }> {
  const patterns = await analyzeFailures(villageId);
  const suggestions = suggestImprovements(patterns);
  logger.info('[improvement-loop] cycle complete', {
    villageId,
    patternCount: patterns.length,
    suggestionCount: suggestions.length,
  });
  return { patterns, suggestions };
}
