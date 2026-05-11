/**
 * Knowledge consistency service.
 *
 * Post-ingestion auditor that finds disagreements in the knowledge corpus:
 *
 *   1. doc-vs-doc — two document chunks discuss the same topic but carry
 *      different values (e.g., kepala desa named differently across files).
 *   2. doc-vs-db  — a chunk contradicts DB ground truth (e.g., contact
 *      number in PDF differs from ai.important_contacts).
 *   3. kb-vs-kb   — two curated knowledge entries disagree (swept
 *      periodically).
 *
 * Findings are persisted into `ai_knowledge_inconsistencies` for admin
 * review. This file owns pipelines (1) and (3). Pipeline (2) lives in
 * `doc-vs-db-pipeline.ts` because it needs the entity extractor.
 */

import prisma from '../lib/prisma';
import logger from '../utils/logger';
import { registerInterval } from '../utils/timer-registry';
import { searchVectors } from './vector-db.service';
import { generateEmbedding } from './embedding.service';
import type { VectorSearchResult } from '../types/embedding.types';

export type InconsistencyKind = 'doc_vs_doc' | 'doc_vs_db' | 'kb_vs_kb';
export type InconsistencySeverity = 'low' | 'medium' | 'high';
export type InconsistencyStatus = 'open' | 'resolved' | 'ignored';

export interface InconsistencyRecord {
  villageId?: string | null;
  kind: InconsistencyKind;
  topicHint?: string;
  sourceAId?: string;
  sourceAType?: string;
  sourceATitle?: string;
  sourceBId?: string;
  sourceBType?: string;
  sourceBTitle?: string;
  snippetA?: string;
  snippetB?: string;
  similarityScore?: number;
  severity?: InconsistencySeverity;
  detectedBy?: string;
}

const MAX_SNIPPET_LENGTH = 800;
const DOC_CONFLICT_MIN_JACCARD = 0.35;
const DOC_CONFLICT_MAX_JACCARD = 0.70; // above this we treat as duplicate, not conflict
const DEFAULT_TOP_K_NEIGHBORS = 8;

function truncate(text: string | null | undefined, max: number): string | undefined {
  if (!text) return undefined;
  return text.length > max ? `${text.substring(0, max - 1)}…` : text;
}

function tokenize(content: string): Set<string> {
  return new Set(
    content
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function inferSeverity(jaccardScore: number): InconsistencySeverity {
  if (jaccardScore >= 0.55) return 'high';
  if (jaccardScore >= 0.45) return 'medium';
  return 'low';
}

export async function recordInconsistency(rec: InconsistencyRecord): Promise<string | null> {
  try {
    const created = await (prisma as any).ai_knowledge_inconsistencies.create({
      data: {
        village_id: rec.villageId ?? null,
        kind: rec.kind,
        topic_hint: rec.topicHint ?? null,
        source_a_id: rec.sourceAId ?? null,
        source_a_type: rec.sourceAType ?? null,
        source_a_title: rec.sourceATitle ?? null,
        source_b_id: rec.sourceBId ?? null,
        source_b_type: rec.sourceBType ?? null,
        source_b_title: rec.sourceBTitle ?? null,
        snippet_a: truncate(rec.snippetA, MAX_SNIPPET_LENGTH) ?? null,
        snippet_b: truncate(rec.snippetB, MAX_SNIPPET_LENGTH) ?? null,
        similarity_score: rec.similarityScore ?? null,
        severity: rec.severity ?? 'medium',
        status: 'open',
        detected_by: rec.detectedBy ?? null,
      },
      select: { id: true },
    });
    return created.id;
  } catch (error: any) {
    logger.warn('Failed to persist knowledge inconsistency', {
      error: error.message,
      kind: rec.kind,
      sourceA: rec.sourceAId,
      sourceB: rec.sourceBId,
    });
    return null;
  }
}

interface DocChunk {
  id: string;
  document_id: string;
  village_id: string | null;
  content: string;
  document_title: string | null;
  section_title: string | null;
  embedding: unknown;
}

/**
 * Doc-vs-doc pipeline. Runs after a document has finished ingesting.
 *
 * Strategy: for each chunk of the just-ingested document, run a vector
 * search within the same village across OTHER documents. Score the
 * overlap via Jaccard on normalized content — if the overlap falls in
 * the conflict band (35-70%), we have same-topic-different-data pair.
 *
 * Threshold is identical to the runtime RAG conflict detector so the
 * admin and runtime agree on what counts as a conflict.
 */
export async function runDocVsDocForDocument(params: {
  documentId: string;
  villageId?: string | null;
  /** Maximum number of chunks from the new document to probe. */
  maxChunksToProbe?: number;
  /** How many neighbors to consider per chunk. */
  topK?: number;
}): Promise<number> {
  const { documentId, villageId } = params;
  const maxChunksToProbe = params.maxChunksToProbe ?? 8;
  const topK = params.topK ?? DEFAULT_TOP_K_NEIGHBORS;

  if (!documentId) return 0;

  const newChunks = await prisma.$queryRawUnsafe<DocChunk[]>(
    `SELECT id, document_id, village_id, content, document_title, section_title
       FROM ai."document_vectors"
      WHERE document_id = $1
      ORDER BY chunk_index ASC
      LIMIT $2`,
    documentId,
    maxChunksToProbe,
  ).catch((err) => {
    logger.warn('doc-vs-doc: failed to fetch new chunks', { documentId, error: err.message });
    return [] as DocChunk[];
  });

  if (newChunks.length === 0) return 0;

  let recorded = 0;
  const seenPairs = new Set<string>();

  for (const newChunk of newChunks) {
    let queryEmbedding: { values: number[] } | null = null;
    try {
      queryEmbedding = await generateEmbedding(newChunk.content, {
        taskType: 'RETRIEVAL_QUERY',
        outputDimensionality: 768,
        useCache: true,
      });
    } catch (err: any) {
      logger.warn('doc-vs-doc: embedding failed, skipping chunk', {
        chunkId: newChunk.id,
        error: err.message,
      });
      continue;
    }

    const neighbors: VectorSearchResult[] = await searchVectors(queryEmbedding.values, {
      topK,
      minScore: 0.45,
      sourceTypes: ['document'],
      villageId: villageId ?? undefined,
    }).catch(() => []);

    const newTokens = tokenize(newChunk.content);

    for (const neighbor of neighbors) {
      // Skip chunks from the same document.
      const neighborDocId = (neighbor.metadata?.documentId as string | undefined) || '';
      if (!neighborDocId || neighborDocId === documentId) continue;

      const neighborTokens = tokenize(neighbor.content);
      const overlap = jaccard(newTokens, neighborTokens);

      if (overlap < DOC_CONFLICT_MIN_JACCARD || overlap >= DOC_CONFLICT_MAX_JACCARD) {
        continue;
      }

      const pairKey = [newChunk.id, neighbor.id].sort().join('::');
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      const id = await recordInconsistency({
        villageId: villageId ?? null,
        kind: 'doc_vs_doc',
        topicHint: inferTopicHint(newChunk.content, neighbor.content),
        sourceAId: newChunk.id,
        sourceAType: 'document',
        sourceATitle: newChunk.document_title || 'Dokumen baru',
        sourceBId: neighbor.id,
        sourceBType: 'document',
        sourceBTitle: neighbor.source || 'Dokumen lain',
        snippetA: newChunk.content,
        snippetB: neighbor.content,
        similarityScore: overlap,
        severity: inferSeverity(overlap),
        detectedBy: 'doc_vs_doc_pipeline',
      });

      if (id) recorded++;
    }
  }

  if (recorded > 0) {
    logger.info('doc-vs-doc: recorded inconsistencies', {
      documentId,
      villageId,
      recorded,
    });
  }

  return recorded;
}

const TOPIC_HINT_RULES: Array<{ pattern: RegExp; hint: string }> = [
  { pattern: /\b(?:\+?62|0)\d{2,3}[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/, hint: 'phone_number' },
  { pattern: /\b\d{1,2}[:.]\d{2}\b/, hint: 'operating_hours' },
  { pattern: /\b(syarat|persyaratan|berkas|dokumen)\b/i, hint: 'service_requirements' },
  { pattern: /\b(biaya|tarif|harga|Rp\s*\d)\b/i, hint: 'service_cost' },
  { pattern: /\b(jl\.|jalan|alamat|rt\s*\d|rw\s*\d)\b/i, hint: 'address' },
  { pattern: /\b(kepala\s+desa|kades|lurah|sekretaris\s+desa|sekdes|rt|rw)\b/i, hint: 'office_role' },
];

function inferTopicHint(a: string, b: string): string | undefined {
  const combined = `${a}\n${b}`;
  for (const rule of TOPIC_HINT_RULES) {
    if (rule.pattern.test(combined)) return rule.hint;
  }
  return undefined;
}

/**
 * KB-vs-KB sweep. Walks curated knowledge entries within a village and
 * flags pairs with conflict-band overlap. Intended for periodic cron use,
 * not post-ingest (too expensive to run on every upload).
 */
export async function runKbVsKbSweep(params: {
  villageId: string;
  batchSize?: number;
}): Promise<number> {
  const { villageId } = params;
  const batchSize = params.batchSize ?? 200;
  if (!villageId) return 0;

  const rows = await prisma.$queryRawUnsafe<
    Array<{ id: string; title: string; content: string; category: string | null }>
  >(
    `SELECT id, title, content, category
       FROM ai."knowledge_vectors"
      WHERE village_id = $1
      ORDER BY updated_at DESC
      LIMIT $2`,
    villageId,
    batchSize,
  ).catch((err) => {
    logger.warn('kb-vs-kb: failed to fetch knowledge rows', { villageId, error: err.message });
    return [] as Array<{ id: string; title: string; content: string; category: string | null }>;
  });

  if (rows.length < 2) return 0;

  const tokenized = rows.map((row) => ({ ...row, tokens: tokenize(row.content) }));

  let recorded = 0;
  const seenPairs = new Set<string>();

  for (let i = 0; i < tokenized.length; i++) {
    const a = tokenized[i];
    for (let j = i + 1; j < tokenized.length; j++) {
      const b = tokenized[j];
      const overlap = jaccard(a.tokens, b.tokens);
      if (overlap < DOC_CONFLICT_MIN_JACCARD || overlap >= DOC_CONFLICT_MAX_JACCARD) continue;

      const pairKey = [a.id, b.id].sort().join('::');
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      const id = await recordInconsistency({
        villageId,
        kind: 'kb_vs_kb',
        topicHint: inferTopicHint(a.content, b.content),
        sourceAId: a.id,
        sourceAType: 'knowledge',
        sourceATitle: a.title,
        sourceBId: b.id,
        sourceBType: 'knowledge',
        sourceBTitle: b.title,
        snippetA: a.content,
        snippetB: b.content,
        similarityScore: overlap,
        severity: inferSeverity(overlap),
        detectedBy: 'kb_sweep',
      });
      if (id) recorded++;
    }
  }

  if (recorded > 0) {
    logger.info('kb-vs-kb sweep: recorded inconsistencies', { villageId, recorded });
  }
  return recorded;
}

export interface ListFilters {
  villageId?: string;
  kind?: InconsistencyKind;
  status?: InconsistencyStatus;
  severity?: InconsistencySeverity;
  limit?: number;
  offset?: number;
}

export async function listInconsistencies(filters: ListFilters) {
  const where: Record<string, unknown> = {};
  if (filters.villageId) where.village_id = filters.villageId;
  if (filters.kind) where.kind = filters.kind;
  if (filters.status) where.status = filters.status;
  if (filters.severity) where.severity = filters.severity;

  const [items, total] = await Promise.all([
    (prisma as any).ai_knowledge_inconsistencies.findMany({
      where,
      orderBy: { detected_at: 'desc' },
      take: Math.min(filters.limit ?? 50, 200),
      skip: filters.offset ?? 0,
    }),
    (prisma as any).ai_knowledge_inconsistencies.count({ where }),
  ]);

  return { items, total };
}

export async function updateInconsistencyStatus(
  id: string,
  patch: { status: InconsistencyStatus; resolvedBy?: string; resolutionNote?: string },
  villageId?: string,
) {
  const existing = await (prisma as any).ai_knowledge_inconsistencies.findUnique({
    where: { id },
    select: { id: true, village_id: true },
  });

  if (!existing) {
    const error = new Error('Inconsistency not found') as Error & { code?: string };
    error.code = 'NOT_FOUND';
    throw error;
  }

  if (villageId && existing.village_id !== villageId) {
    const error = new Error('Forbidden') as Error & { code?: string };
    error.code = 'FORBIDDEN';
    throw error;
  }

  return (prisma as any).ai_knowledge_inconsistencies.update({
    where: { id },
    data: {
      status: patch.status,
      resolved_at: patch.status === 'open' ? null : new Date(),
      resolved_by: patch.resolvedBy ?? null,
      resolution_note: patch.resolutionNote ?? null,
    },
  });
}

/**
 * Periodic KB sweep across all active villages.
 *
 * Runs every N hours (default 24h, configurable via KB_SWEEP_INTERVAL_MS).
 * Skipped when disabled via KB_SWEEP_ENABLED=false.
 */
let sweepInFlight = false;

async function runKbSweepTick(): Promise<void> {
  if (sweepInFlight) {
    logger.debug('kb-vs-kb sweep: previous tick still running, skipping');
    return;
  }
  sweepInFlight = true;
  try {
    const villages = await prisma.$queryRawUnsafe<Array<{ village_id: string }>>(
      `SELECT DISTINCT village_id
         FROM ai."knowledge_vectors"
        WHERE village_id IS NOT NULL
        LIMIT 500`,
    ).catch(() => [] as Array<{ village_id: string }>);

    let totalRecorded = 0;
    for (const row of villages) {
      try {
        totalRecorded += await runKbVsKbSweep({ villageId: row.village_id });
      } catch (error: any) {
        logger.warn('kb-vs-kb sweep: village failed', {
          villageId: row.village_id,
          error: error.message,
        });
      }
    }
    if (totalRecorded > 0) {
      logger.info('kb-vs-kb sweep tick done', { villages: villages.length, recorded: totalRecorded });
    }
  } finally {
    sweepInFlight = false;
  }
}

if (process.env.KB_SWEEP_ENABLED !== 'false') {
  const intervalMs = Math.max(
    60_000,
    Number(process.env.KB_SWEEP_INTERVAL_MS || 24 * 60 * 60 * 1000),
  );
  registerInterval(
    () => {
      runKbSweepTick().catch((error: any) =>
        logger.error('kb-vs-kb sweep tick failed', { error: error.message }),
      );
    },
    intervalMs,
    'kb-consistency-sweep',
  );
  logger.info('kb-vs-kb periodic sweep scheduled', { intervalMs });
}
