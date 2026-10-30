/**
 * Confidence-Based Clarification — jangan ngarang kalau ragu.
 *
 * Ketika assessor LLM mengembalikan confidence rendah (< 0.6), agent TIDAK
 * boleh menebak-nebak. Sebagai gantinya, ajukan pertanyaan klarifikasi yang
 * SPESIFIK (bukan "maksud Anda apa?").
 *
 * Contoh:
 *   User: "saya mau bikin"
 *   Assessor: stage=COLLECT, confidence=0.45, candidates=[service_request, complaint]
 *   → "Apakah yang Anda maksud (a) mengurus surat/layanan, atau (b) melaporkan masalah?"
 *
 * Design principles:
 *  - Additive: dipanggil dari process-message-v2 setelah assessor, sebelum
 *    stage execution. Tidak mengubah flow existing.
 *  - Threshold konfigurable via env (default 0.6).
 *  - Klarifikasi spesifik: memakai kandidat stage/intent dari assessor untuk
 *    menyusun opsi konkret, bukan pertanyaan generik.
 *  - Never throws.
 */

import logger from '../utils/logger';

export const LOW_CONFIDENCE_THRESHOLD = Number(
  process.env.ASSESSOR_LOW_CONFIDENCE_THRESHOLD ?? 0.6,
);

export interface ClarificationCandidate {
  /** Label singkat untuk opsi, mis. "mengurus surat" */
  label: string;
  /** Stage atau intent yang diwakili opsi ini */
  stage: string;
}

export interface ClarificationResult {
  /** true jika klarifikasi diperlukan */
  needed: boolean;
  /** Pertanyaan klarifikasi spesifik (jika needed) */
  question?: string;
  /** Kandidat opsi (jika needed) */
  candidates?: ClarificationCandidate[];
  /** Confidence yang memicu klarifikasi */
  trigger_confidence?: number;
}

/**
 * Label Bahasa Indonesia yang ramah untuk setiap stage.
 */
const STAGE_LABELS_ID: Record<string, string> = {
  COLLECT: 'melaporkan masalah / mengurus layanan',
  INFORMATION: 'bertanya informasi',
  STATUS: 'mengecek status',
  EMERGENCY: 'melaporkan keadaan darurat',
  GREETING: 'menyapa',
  HANDOFF: 'berbicara dengan petugas',
  VERIFY: 'konfirmasi',
  TRIAGE: 'memulai percakapan',
};

/**
 * Tentukan apakah klarifikasi diperlukan berdasarkan confidence assessor.
 *
 * @param confidence - confidence dari assessor (0.0 - 1.0)
 * @param stage - stage yang diputuskan assessor
 * @param candidateStages - kandidat stage alternatif (jika assessor menyediakannya)
 */
export function shouldClarify(
  confidence: number,
  stage: string,
  candidateStages?: string[],
): ClarificationResult {
  // Confidence tinggi atau tidak valid → tidak perlu klarifikasi.
  if (!Number.isFinite(confidence) || confidence >= LOW_CONFIDENCE_THRESHOLD) {
    return { needed: false };
  }

  // Confidence sangat rendah (< 0.3) → serahkan ke handoff logic existing,
  // bukan klarifikasi (user kemungkinan ngetik ngawur / di luar domain).
  if (confidence < 0.3) {
    return { needed: false };
  }

  // Susun kandidat: stage terpilih + alternatif (max 3 opsi).
  const seen = new Set<string>();
  const candidates: ClarificationCandidate[] = [];

  const pushCandidate = (s: string) => {
    const key = s.toUpperCase();
    if (seen.has(key) || candidates.length >= 3) return;
    seen.add(key);
    candidates.push({
      label: STAGE_LABELS_ID[key] ?? key.toLowerCase().replace(/_/g, ' '),
      stage: key,
    });
  };

  pushCandidate(stage);
  for (const c of candidateStages ?? []) pushCandidate(c);

  // Jika hanya 1 kandidat, tambahkan opsi "lainnya" agar user tidak terjebak.
  if (candidates.length === 1) {
    candidates.push({ label: 'hal lain', stage: 'OTHER' });
  }

  if (candidates.length < 2) {
    return { needed: false };
  }

  // Susun pertanyaan spesifik dengan opsi berhuruf.
  const letters = ['a', 'b', 'c'];
  const optionsText = candidates
    .map((c, i) => `(${letters[i]}) ${c.label}`)
    .join(', ');

  const question =
    `Maaf, saya kurang yakin. Apakah yang Anda maksud ${optionsText}? ` +
    `Balas dengan hurufnya saja, mis. "${letters[0]}".`;

  logger.debug('[confidence-clarification] clarification triggered', {
    confidence,
    stage,
    candidateCount: candidates.length,
  });

  return {
    needed: true,
    question,
    candidates,
    trigger_confidence: confidence,
  };
}

/**
 * Parse jawaban user terhadap pertanyaan klarifikasi.
 * Return stage yang dipilih, atau null jika tidak dikenali.
 */
export function parseClarificationAnswer(
  message: string,
  candidates: ClarificationCandidate[],
): string | null {
  const text = (message ?? '').trim().toLowerCase();
  if (!text) return null;

  const letters = ['a', 'b', 'c'];

  // 1. Jawaban huruf: "a", "b", "(a)", "opsi a", "yang a"
  const letterMatch = text.match(/^(?:\(?([abc])\)?|opsi\s+([abc])|yang\s+([abc]))$/);
  if (letterMatch) {
    const letter = letterMatch[1] ?? letterMatch[2] ?? letterMatch[3];
    const idx = letters.indexOf(letter);
    if (idx >= 0 && idx < candidates.length) {
      return candidates[idx].stage;
    }
  }

  // 2. Jawaban mengandung label kandidat.
  for (const c of candidates) {
    if (c.stage === 'OTHER') continue;
    const labelWords = c.label.toLowerCase().split(/[\s/]+/);
    if (labelWords.some((w) => w.length > 3 && text.includes(w))) {
      return c.stage;
    }
  }

  return null;
}
