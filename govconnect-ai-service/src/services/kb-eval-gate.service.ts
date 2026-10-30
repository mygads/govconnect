/**
 * W9: KB eval gate — threshold enforcement for RAG quality.
 *
 * Arsitektur-final §8.1 W9 mensyaratkan eval gate dengan:
 * - recall@20 ≥ 0.85
 * - refusal precision ≥ 0.95
 *
 * Sebelumnya "eval gate" hanya harness manual (golden-set-eval) tanpa
 * threshold yang di-enforce — observability, bukan gate. Modul ini
 * mengimplementasikan gate yang MEMBLOKIR publish KB bila di bawah
 * threshold (dipakai oleh kb-publish.service.ts).
 *
 * Dua probe (tanpa LLM, cepat, deterministik):
 * 1. recall@20: sampel ≤20 dokumen KB published milik desa; embed judul;
 *    hybridSearch topK=20; hit bila dokumen sumber muncul di hasil.
 * 2. refusal precision: 10 query out-of-domain (topik yang tidak mungkin
 *    ada di KB desa); "refusal" yang benar = tidak ada hasil ≥ minScore.
 *    precision = refusal benar / total probe.
 */

import logger from '../utils/logger';
import { hybridSearch } from './hybrid-search.service';

export const KB_EVAL_RECALL_AT_20_MIN = Number(
  process.env.KB_EVAL_RECALL_AT_20_MIN ?? '0.85',
);
export const KB_EVAL_REFUSAL_PRECISION_MIN = Number(
  process.env.KB_EVAL_REFUSAL_PRECISION_MIN ?? '0.95',
);
const GATE_SAMPLE_SIZE = Number(process.env.KB_EVAL_GATE_SAMPLE_SIZE ?? '20');

/** Query out-of-domain: tidak mungkin ada di KB layanan desa. */
const REFUSAL_PROBES = [
  'jadwal penerbangan jakarta singapura hari ini',
  'harga saham BBCA penutupan kemarin',
  'resep rendang padang asli minang',
  'cara root hp android terbaru',
  'skor pertandingan liga inggris tadi malam',
  'tutorial main gitar untuk pemula',
  'harga emas antam per gram hari ini',
  'cara daftar cpns 2026 online',
  'sinopsis film bioskop terbaru',
  'kurs dollar ke rupiah hari ini',
];

export interface KbEvalGateResult {
  pass: boolean;
  recallAt20: number;
  refusalPrecision: number;
  recallSamples: number;
  refusalSamples: number;
  failures: string[];
  /** Bila true, gate di-skip karena KB kosong (tidak ada yang diukur). */
  skippedEmptyKb: boolean;
}

type PrismaLike = {
  $queryRawUnsafe: (query: string, ...args: unknown[]) => Promise<unknown>;
};

async function getPrisma(): Promise<PrismaLike | null> {
  try {
    const mod = await import('../lib/prisma');
    return mod.default as PrismaLike;
  } catch {
    return null;
  }
}

/**
 * Jalankan eval gate untuk KB milik desa. Mengembalikan pass/fail beserta
 * metrik. Tidak melempar — kegagalan infrastruktur → gate gagal (fail-closed)
 * kecuali KB kosong (tidak ada yang diukur → skip dengan catatan).
 */
export async function runKbEvalGate(villageId: string): Promise<KbEvalGateResult> {
  const failures: string[] = [];
  const prisma = await getPrisma();
  if (!prisma) {
    return {
      pass: false, recallAt20: 0, refusalPrecision: 0,
      recallSamples: 0, refusalSamples: 0,
      failures: ['database tidak tersedia (fail-closed)'],
      skippedEmptyKb: false,
    };
  }

  try {
    // ── Probe 1: recall@20 ──
    const docs = (await prisma.$queryRawUnsafe(
      `SELECT id, title FROM ai.knowledge_vectors
        WHERE village_id = $1
        ORDER BY updated_at DESC
        LIMIT $2`,
      villageId, GATE_SAMPLE_SIZE,
    )) as Array<{ id: string; title: string }>;

    if (docs.length === 0) {
      // KB kosong: tidak ada yang diukur. Publish pertama tetap diizinkan
      // (gate tidak bisa menilai apa-apa) tapi dicatat.
      logger.info('[kb-eval-gate] skipped: village KB is empty', { villageId });
      return {
        pass: true, recallAt20: 1, refusalPrecision: 1,
        recallSamples: 0, refusalSamples: 0, failures: [],
        skippedEmptyKb: true,
      };
    }

    let recallHits = 0;
    for (const doc of docs) {
      try {
        // hybridSearch menghitung embedding query secara internal.
        const results = await hybridSearch(doc.title, {
          topK: 20,
          minScore: 0.3,
          villageId,
        });
        if (results.some((r) => String(r.id) === String(doc.id))) {
          recallHits++;
        }
      } catch (err) {
        logger.debug('[kb-eval-gate] recall probe item failed', {
          docId: doc.id,
          error: String((err as Error)?.message ?? err).slice(0, 80),
        });
      }
    }
    const recallAt20 = docs.length > 0 ? recallHits / docs.length : 1;

    // ── Probe 2: refusal precision ──
    let correctRefusals = 0;
    for (const probe of REFUSAL_PROBES) {
      try {
        const results = await hybridSearch(probe, {
          topK: 5,
          minScore: 0.65,
          villageId,
        });
        // Refusal yang benar = tidak ada hasil di atas threshold.
        if (results.length === 0) correctRefusals++;
      } catch (err) {
        logger.debug('[kb-eval-gate] refusal probe item failed', {
          error: String((err as Error)?.message ?? err).slice(0, 80),
        });
      }
    }
    const refusalPrecision = REFUSAL_PROBES.length > 0
      ? correctRefusals / REFUSAL_PROBES.length
      : 1;

    if (recallAt20 < KB_EVAL_RECALL_AT_20_MIN) {
      failures.push(
        `recall@20=${recallAt20.toFixed(3)} < ${KB_EVAL_RECALL_AT_20_MIN} ` +
        `(${recallHits}/${docs.length} sampel)`,
      );
    }
    if (refusalPrecision < KB_EVAL_REFUSAL_PRECISION_MIN) {
      failures.push(
        `refusal_precision=${refusalPrecision.toFixed(3)} < ${KB_EVAL_REFUSAL_PRECISION_MIN} ` +
        `(${correctRefusals}/${REFUSAL_PROBES.length} probe)`,
      );
    }

    const pass = failures.length === 0;
    logger.info('[kb-eval-gate] gate evaluated', {
      villageId, pass, recallAt20: Number(recallAt20.toFixed(3)),
      refusalPrecision: Number(refusalPrecision.toFixed(3)),
      failures,
    });

    return {
      pass,
      recallAt20: Number(recallAt20.toFixed(3)),
      refusalPrecision: Number(refusalPrecision.toFixed(3)),
      recallSamples: docs.length,
      refusalSamples: REFUSAL_PROBES.length,
      failures,
      skippedEmptyKb: false,
    };
  } catch (err) {
    // Fail-closed: error infrastruktur → gate gagal, publish diblokir.
    const msg = `eval gate error (fail-closed): ${String((err as Error)?.message ?? err).slice(0, 120)}`;
    logger.warn('[kb-eval-gate] ' + msg, { villageId });
    return {
      pass: false, recallAt20: 0, refusalPrecision: 0,
      recallSamples: 0, refusalSamples: 0,
      failures: [msg],
      skippedEmptyKb: false,
    };
  }
}
