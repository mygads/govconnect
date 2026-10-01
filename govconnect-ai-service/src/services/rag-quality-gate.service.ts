/**
 * W9: Live RAG quality gate.
 *
 * Runs on EVERY retrieval (wired into rag.service.ts `retrieveContext`).
 * Unlike kb-eval-gate.service.ts (publish-time eval), this gate inspects the
 * actual scores of each live retrieval and classifies quality so callers can
 * fall back to an honest generic answer instead of trusting shaky results.
 *
 * Classification:
 *   HIGH   — top1Score >= 0.85
 *   MEDIUM — 0.65 <= top1Score < 0.85
 *   LOW    — top1Score < 0.65, OR scoreGap (top1-top2) < 0.05 (ambiguous),
 *            OR no results at all.
 *
 * Metrics are persisted (fire-and-forget) to ai.rag_quality_metrics for
 * monitoring. Persistence never throws — a monitoring failure must never
 * break a citizen's retrieval.
 */
import logger from '../utils/logger';
import prisma from '../lib/prisma';
import type { RAGQualityAssessment, RAGQualityLevel } from '../types/embedding.types';

/** Top-1 score at or above this is HIGH quality. */
export const RAG_QUALITY_HIGH_MIN = Number(process.env.RAG_QUALITY_HIGH_MIN ?? '0.85');
/** Top-1 score at or above this (but below HIGH) is MEDIUM quality. */
export const RAG_QUALITY_MEDIUM_MIN = Number(process.env.RAG_QUALITY_MEDIUM_MIN ?? '0.65');
/**
 * When the gap between the best and second-best result is smaller than this,
 * the ranking is ambiguous → LOW regardless of absolute scores.
 */
export const RAG_QUALITY_MIN_GAP = Number(process.env.RAG_QUALITY_MIN_GAP ?? '0.05');

let tableEnsured = false;

/**
 * Pure function: classify retrieval quality from similarity scores.
 * No I/O — safe to unit test.
 */
export function evaluateRAGQuality(scores: ReadonlyArray<number>): RAGQualityAssessment {
  const clean = scores.filter((s) => typeof s === 'number' && Number.isFinite(s));
  const resultCount = clean.length;

  if (resultCount === 0) {
    return {
      level: 'LOW',
      top1Score: 0,
      top2Score: null,
      scoreGap: 0,
      resultCount: 0,
      avgScore: 0,
      reasons: ['no results returned'],
    };
  }

  const sorted = [...clean].sort((a, b) => b - a);
  const top1Score = sorted[0];
  const top2Score = sorted.length > 1 ? sorted[1] : null;
  const scoreGap = top2Score === null ? 0 : top1Score - top2Score;
  const avgScore = clean.reduce((sum, s) => sum + s, 0) / resultCount;
  const reasons: string[] = [];

  let level: RAGQualityLevel;
  if (top1Score < RAG_QUALITY_MEDIUM_MIN) {
    level = 'LOW';
    reasons.push(`top1 ${top1Score.toFixed(3)} < ${RAG_QUALITY_MEDIUM_MIN}`);
  } else if (top2Score !== null && scoreGap < RAG_QUALITY_MIN_GAP) {
    // Ambiguous ranking: best two candidates are nearly tied.
    level = 'LOW';
    reasons.push(`score gap ${scoreGap.toFixed(3)} < ${RAG_QUALITY_MIN_GAP} (ambiguous ranking)`);
  } else if (top1Score >= RAG_QUALITY_HIGH_MIN) {
    level = 'HIGH';
    reasons.push(`top1 ${top1Score.toFixed(3)} >= ${RAG_QUALITY_HIGH_MIN}`);
  } else {
    level = 'MEDIUM';
    reasons.push(`top1 ${top1Score.toFixed(3)} in [${RAG_QUALITY_MEDIUM_MIN}, ${RAG_QUALITY_HIGH_MIN})`);
  }

  return { level, top1Score, top2Score, scoreGap, resultCount, avgScore, reasons };
}

async function ensureQualityMetricsTable(): Promise<void> {
  if (tableEnsured) return;
  // Dedicated monitoring table in the ai schema. Created lazily so no
  // Prisma migration is required; failures are swallowed by the caller.
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ai.rag_quality_metrics (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      village_id TEXT,
      channel TEXT,
      query_preview TEXT,
      top1_score DOUBLE PRECISION NOT NULL,
      top2_score DOUBLE PRECISION,
      score_gap DOUBLE PRECISION NOT NULL,
      result_count INTEGER NOT NULL,
      avg_score DOUBLE PRECISION NOT NULL,
      quality_level TEXT NOT NULL,
      reasons TEXT[]
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_rag_quality_metrics_created
    ON ai.rag_quality_metrics (created_at DESC)
  `);
  tableEnsured = true;
}

export interface RecordRAGQualityInput {
  villageId?: string | null;
  channel?: string | null;
  queryPreview: string;
  assessment: RAGQualityAssessment;
}

/**
 * Persist one quality-gate observation. Fire-and-forget: never throws.
 */
export async function recordRAGQualityMetrics(input: RecordRAGQualityInput): Promise<void> {
  try {
    await ensureQualityMetricsTable();
    const id = `rqm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const a = input.assessment;
    await prisma.$executeRawUnsafe(
      `INSERT INTO ai.rag_quality_metrics
         (id, village_id, channel, query_preview, top1_score, top2_score, score_gap, result_count, avg_score, quality_level, reasons)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      id,
      input.villageId ?? null,
      input.channel ?? null,
      input.queryPreview.slice(0, 200),
      a.top1Score,
      a.top2Score,
      a.scoreGap,
      a.resultCount,
      a.avgScore,
      a.level,
      a.reasons,
    );
  } catch (error: any) {
    // Monitoring must never break retrieval.
    logger.debug('recordRAGQualityMetrics failed (non-fatal)', { error: error?.message });
  }
}
