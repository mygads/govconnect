/**
 * R5: KB publish service — writes approved proposals into the knowledge base.
 *
 * The suggester proposes, a human approves, and a human publishes.
 * This module is the publish step: it takes an approved KbProposal,
 * generates an embedding for the draft content, writes it to
 * ai.knowledge_vectors, and marks the proposal as 'published'.
 *
 * Design notes:
 * - Publish is NEVER automatic — always triggered by an explicit human action
 *   via POST /api/kb-proposals/:id/publish.
 * - The proposal status transitions approved → published (via canTransition).
 * - After publishing, the semantic cache for the village is invalidated so
 *   the new content is retrievable (R7 wiring).
 */

import prisma from '../lib/prisma';
import logger from '../utils/logger';
import {
  prismaProposalStore,
  canTransition,
  type KbProposal,
} from './kb-suggester.service';
import { semanticCacheInvalidate } from '../pipeline/pipeline-store';
import { runKbEvalGate } from './kb-eval-gate.service';

export interface PublishResult {
  vectorId: string;
  proposalId: string;
}

/**
 * W9: bila true, eval gate di-skip (darurat/ops). Dicatat di log.
 * Default false — gate aktif dan memblokir publish bila di bawah threshold.
 */
const SKIP_EVAL_GATE = process.env.KB_PUBLISH_SKIP_EVAL_GATE === 'true';

/**
 * Publish an approved proposal to the knowledge base.
 * @throws if the proposal is not in 'approved' status, the write fails,
 *   or the W9 eval gate fails (recall@20 < 0.85 atau refusal precision < 0.95).
 */
export async function publishProposalToKb(
  proposal: KbProposal,
  publisher: string,
): Promise<PublishResult> {
  if (proposal.status !== 'approved') {
    throw new Error(
      `Cannot publish proposal in status '${proposal.status}' — must be 'approved'`,
    );
  }
  if (!canTransition(proposal.status, 'published')) {
    throw new Error(
      `Invalid transition: '${proposal.status}' → 'published'`,
    );
  }

  const vectorId = `kb_pub_${proposal.id}`;
  const title = proposal.title.trim();
  const content = proposal.draft.trim();
  if (!title || !content) {
    throw new Error('Proposal title and draft must not be empty');
  }

  // W9 eval gate: blokir publish bila kualitas RAG di bawah threshold.
  // Bukan sekadar observability — ini enforcement.
  if (!SKIP_EVAL_GATE) {
    const gate = await runKbEvalGate(proposal.villageId);
    if (!gate.pass) {
      logger.warn('[kb-publish] BLOCKED by eval gate', {
        proposalId: proposal.id,
        villageId: proposal.villageId,
        failures: gate.failures,
      });
      throw new Error(
        `KB publish diblokir oleh eval gate: ${gate.failures.join('; ')}`,
      );
    }
    if (gate.skippedEmptyKb) {
      logger.info('[kb-publish] eval gate skipped (empty KB — first publish)', {
        proposalId: proposal.id,
        villageId: proposal.villageId,
      });
    }
  } else {
    logger.warn('[kb-publish] eval gate SKIPPED via KB_PUBLISH_SKIP_EVAL_GATE', {
      proposalId: proposal.id,
      villageId: proposal.villageId,
      publisher,
    });
  }

  // Generate embedding for the draft content.
  const { generateEmbedding } = await import('./embedding.service');
  const embResult = await generateEmbedding(content, {
    taskType: 'RETRIEVAL_DOCUMENT',
    outputDimensionality: 768,
    useCache: false,
  });
  const embedding = embResult.values;
  if (!embedding || embedding.length === 0) {
    throw new Error('Failed to generate embedding for proposal content');
  }
  const embeddingStr = `[${embedding.join(',')}]`;

  // Write to knowledge_vectors.
  await prisma.$executeRawUnsafe(
    `INSERT INTO ai.knowledge_vectors (
       id, village_id, scope, is_global, title, content, category,
       embedding, embedding_model, quality_score, created_at, updated_at
     ) VALUES ($1, $2, 'village', false, $3, $4, $5, $6::ai.vector, $7, $8, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       content = EXCLUDED.content,
       category = EXCLUDED.category,
       embedding = EXCLUDED.embedding,
       embedding_model = EXCLUDED.embedding_model,
       updated_at = NOW()`,
    vectorId,
    proposal.villageId,
    title,
    content,
    'suggester',
    embeddingStr,
    'publish',
    0.8,
  );

  // Mark proposal as published.
  await prismaProposalStore.setStatus(
    proposal.id,
    'published',
    publisher,
    `Published to KB as ${vectorId}`,
  );

  // R7: invalidate the semantic cache so the new content is retrievable.
  try {
    await semanticCacheInvalidate(proposal.villageId);
  } catch (err: any) {
    logger.warn('[kb-publish] semantic cache invalidation failed (non-fatal)', {
      villageId: proposal.villageId,
      error: err?.message ?? String(err),
    });
  }

  logger.info('[kb-publish] proposal published to KB', {
    proposalId: proposal.id,
    vectorId,
    villageId: proposal.villageId,
    publisher,
  });

  return { vectorId, proposalId: proposal.id };
}
