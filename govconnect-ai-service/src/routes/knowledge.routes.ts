/**
 * Knowledge Vector API Routes
 * 
 * Handles CRUD operations for knowledge vectors
 * Called by Dashboard when admin creates/updates/deletes knowledge
 * 
 * Endpoints:
 * - POST   /api/knowledge         - Add knowledge + generate embedding
 * - PUT    /api/knowledge/:id     - Update knowledge (re-embed)
 * - DELETE /api/knowledge/:id     - Delete knowledge vector
 * - GET    /api/knowledge/:id     - Get knowledge vector
 * - POST   /api/knowledge/search  - Vector search
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import logger from '../utils/logger';
import { config } from '../config/env';
import { generateEmbedding, generateBatchEmbeddings } from '../services/embedding.service';
import { smartChunkKnowledge } from '../services/ai-chunking.service';
import { generateAndStoreVariants, deleteVariants } from '../services/question-variant.service';
import {
  upsertKnowledgeVector,
  deleteKnowledgeVector,
  getKnowledgeVector,
  getKnowledgeEmbeddingStatuses,
  searchVectors,
  getVectorDbStats,
} from '../services/vector-db.service';
import { firstHeader, getParam } from '../utils/http';
import { internalApiKeyMatches } from '../utils/internal-auth';
import { clearRetrievalCache } from '../services/rag.service';
import { withAiBillingTurn } from '../services/ai-turn-billing.service';

const router = Router();

function estimateTokens(text: string): number {
  return Math.ceil(text.trim().split(/\s+/).filter(Boolean).length * 1.3);
}

function analyzeKnowledgeStructure(content: string) {
  const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const paragraphs = content.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean);
  const bulletLines = lines.filter(line => /^([-*•]\s+|\d+[.)]\s+)/.test(line)).length;
  const headerLines = lines.filter(line => /^#{1,6}\s+\S+/.test(line) || /^[A-Z0-9][^.!?]{3,80}:$/.test(line)).length;
  const tableLikeLines = lines.filter(line => line.includes('|') || line.includes('\t') || (line.match(/:/g) || []).length >= 2).length;
  return {
    estimatedTokens: estimateTokens(content),
    paragraphCount: paragraphs.length,
    bulletLines,
    headerLines,
    tableLikeLines,
    shouldChunk: paragraphs.length > 1 || bulletLines >= 3 || headerLines > 0 || tableLikeLines >= 2 || estimateTokens(content) >= 350,
  };
}

type KnowledgeScope = 'village' | 'global';

function resolveKnowledgeScope(input: { villageId?: string | null; scope?: string | null; isGlobal?: boolean | null }) {
  const isGlobal = input.scope === 'global' || input.isGlobal === true;
  if (isGlobal) return { villageId: null, scope: 'global' as KnowledgeScope, isGlobal: true };
  if (!input.villageId) throw new Error('village_id is required for village-scoped knowledge');
  return { villageId: input.villageId, scope: 'village' as KnowledgeScope, isGlobal: false };
}

async function embedKnowledgeChunks(input: {
  id: string;
  title: string;
  content: string;
  category: string;
  keywords?: string[];
  qualityScore?: number;
  villageId?: string | null;
  scope?: KnowledgeScope;
  isGlobal?: boolean;
}) {
  const structure = analyzeKnowledgeStructure(input.content);
  const chunks = structure.shouldChunk
    ? await smartChunkKnowledge(input.content, input.title, input.villageId || undefined)
    : [];

  const finalChunks = chunks.length > 0
    ? chunks
    : [{ title: input.title, category: input.category, content: input.content }];

  const texts = finalChunks.map(chunk => `${chunk.title}\n${chunk.content}`);
  const batchResult = await generateBatchEmbeddings(texts, {
    taskType: 'RETRIEVAL_DOCUMENT',
    outputDimensionality: 768,
    context: {
      village_id: input.villageId || null,
    },
  });

  for (let i = 0; i < finalChunks.length; i++) {
    await upsertKnowledgeVector({
      id: i === 0 ? input.id : `${input.id}_${i}`,
      villageId: input.villageId,
      title: finalChunks[i].title,
      content: finalChunks[i].content,
      category: finalChunks[i].category || input.category,
      keywords: input.keywords || [],
      embedding: batchResult.embeddings[i].values,
      embeddingModel: batchResult.embeddings[i].model,
      qualityScore: input.qualityScore || 1.0,
      scope: input.scope,
      isGlobal: input.isGlobal,
    });
  }

  return {
    chunksCount: finalChunks.length,
    chunks: finalChunks.map((chunk, i) => ({
      chunkId: i === 0 ? input.id : `${input.id}_${i}`,
      title: chunk.title,
      category: chunk.category || input.category,
    })),
    embeddingModel: batchResult.embeddings[0]?.model,
    structure,
  };
}

function buildKnowledgeIngestBillingGroupId(id: string, content: string): string {
  const contentHash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  return `ingest:knowledge:${id}:${contentHash}`;
}

async function withKnowledgeIngestBilling<T>(params: {
  id: string;
  content: string;
  villageId?: string | null;
}, handler: () => Promise<T>): Promise<T> {
  const traceId = `knowledge-${params.id}-${Date.now()}`;
  return withAiBillingTurn({
    village_id: params.villageId || null,
    message_id: `ingest:${params.id}`,
    trace_id: traceId,
    billing_group_id: buildKnowledgeIngestBillingGroupId(params.id, params.content),
    channel: 'system_ingest',
    session_id: `ingest:${params.id}`,
  }, handler);
}

// Middleware to verify internal API key
function verifyInternalKey(req: Request, res: Response, next: Function) {
  const apiKey = firstHeader(req.headers['x-internal-api-key']);
  if (!internalApiKeyMatches(apiKey)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
}

router.use(verifyInternalKey);

/**
 * POST /api/knowledge
 * Add new knowledge with embedding
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { id, title, content, category, keywords, qualityScore, village_id, villageId, scope, is_global, isGlobal } = req.body;

    if (!id || !title || !content || !category) {
      return res.status(400).json({
        error: 'Missing required fields: id, title, content, category'
      });
    }

    let resolvedScope;
    try {
      resolvedScope = resolveKnowledgeScope({
        villageId: village_id || villageId || null,
        scope,
        isGlobal: Boolean(is_global || isGlobal),
      });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }

    logger.info('Adding knowledge vector', { id, category, contentLength: content.length });

    const responsePayload = await withKnowledgeIngestBilling({
      id,
      content,
      villageId: resolvedScope.villageId,
    }, async () => {
      const embedded = await embedKnowledgeChunks({
        id,
        title,
        content,
        category,
        keywords,
        qualityScore,
        villageId: resolvedScope.villageId,
        scope: resolvedScope.scope,
        isGlobal: resolvedScope.isGlobal,
      });
      clearRetrievalCache(resolvedScope.villageId);

      return {
        statusCode: 201,
        body: {
          status: 'success',
          data: { id, ...embedded },
        },
      };
    });

    res.status(responsePayload.statusCode).json(responsePayload.body);

    generateAndStoreVariants(id, title, content, resolvedScope.villageId, 'knowledge', resolvedScope.scope, {
      village_id: resolvedScope.villageId,
      channel: 'system_ingest',
      message_id: `ingest:${id}`,
      session_id: `ingest:${id}`,
      billing_group_id: buildKnowledgeIngestBillingGroupId(id, content),
    }).catch((err: any) => {
      logger.warn('Question variant generation failed (non-blocking)', { id, error: err.message });
    });
  } catch (error: any) {
    logger.error('Failed to add knowledge', { error: error.message });
    res.status(500).json({ error: 'Failed to add knowledge vector' });
  }
});

/**
 * PUT /api/knowledge/:id
 * Update knowledge (delete old + add new = re-embed)
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = getParam(req, 'id');
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    const { title, content, category, keywords, qualityScore, village_id, villageId, scope, is_global, isGlobal } = req.body;

    if (!title || !content || !category) {
      return res.status(400).json({
        error: 'Missing required fields: title, content, category'
      });
    }

    let resolvedScope;
    try {
      resolvedScope = resolveKnowledgeScope({
        villageId: village_id || villageId || null,
        scope,
        isGlobal: Boolean(is_global || isGlobal),
      });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }

    logger.info('Updating knowledge vector', { id, category, contentLength: content.length });

    const responsePayload = await withKnowledgeIngestBilling({
      id,
      content,
      villageId: resolvedScope.villageId,
    }, async () => {
      await deleteKnowledgeVector(id);

      const embedded = await embedKnowledgeChunks({
        id,
        title,
        content,
        category,
        keywords,
        qualityScore,
        villageId: resolvedScope.villageId,
        scope: resolvedScope.scope,
        isGlobal: resolvedScope.isGlobal,
      });
      clearRetrievalCache(resolvedScope.villageId);

      return {
        statusCode: 200,
        body: {
          status: 'success',
          data: { id, ...embedded },
        },
      };
    });

    res.status(responsePayload.statusCode).json(responsePayload.body);

    deleteVariants(id).then(() =>
      generateAndStoreVariants(id, title, content, resolvedScope.villageId, 'knowledge', resolvedScope.scope, {
        village_id: resolvedScope.villageId,
        channel: 'system_ingest',
        message_id: `ingest:${id}`,
        session_id: `ingest:${id}`,
        billing_group_id: buildKnowledgeIngestBillingGroupId(id, content),
      })
    ).catch((err: any) => {
      logger.warn('Question variant regeneration failed (non-blocking)', { id, error: err.message });
    });
  } catch (error: any) {
    logger.error('Failed to update knowledge', { error: error.message });
    res.status(500).json({ error: 'Failed to update knowledge vector' });
  }
});

/**
 * DELETE /api/knowledge/:id
 * Delete knowledge vector
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = getParam(req, 'id');
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }

    logger.info('Deleting knowledge vector', { id });

    const deleted = await deleteKnowledgeVector(id);

    if (!deleted) {
      return res.status(404).json({ error: 'Knowledge vector not found' });
    }

    // Cleanup question variants
    deleteVariants(id).catch(() => {});

    clearRetrievalCache();

    res.json({ status: 'success', deleted: true });
  } catch (error: any) {
    logger.error('Failed to delete knowledge', { error: error.message });
    res.status(500).json({ error: 'Failed to delete knowledge vector' });
  }
});

/**
 * GET /api/knowledge/:id
 * Get knowledge vector by ID
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = getParam(req, 'id');
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }

    const knowledge = await getKnowledgeVector(id);

    if (!knowledge) {
      return res.status(404).json({ error: 'Knowledge vector not found' });
    }

    res.json({ data: knowledge });
  } catch (error: any) {
    logger.error('Failed to get knowledge', { error: error.message });
    res.status(500).json({ error: 'Failed to get knowledge vector' });
  }
});

/**
 * POST /api/knowledge/search
 * Vector search for knowledge
 */
router.post('/search', async (req: Request, res: Response) => {
  try {
    const { query, topK, minScore, categories, villageId } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    logger.info('Knowledge vector search', { queryLength: query.length, villageId });

    // Generate query embedding
    const queryEmbedding = await generateEmbedding(query, {
      taskType: 'RETRIEVAL_QUERY',
      outputDimensionality: 768,
      useCache: true,
      context: {
        village_id: typeof villageId === 'string' && villageId.trim() ? villageId.trim() : null,
      },
    });

    // Search vectors
    const results = await searchVectors(queryEmbedding.values, {
      topK: topK || 5,
      minScore: minScore || 0.7,
      categories,
      villageId,
      sourceTypes: ['knowledge'],
    });

    res.json({
      data: results,
      total: results.length,
    });
  } catch (error: any) {
    logger.error('Knowledge search failed', { error: error.message });
    res.status(500).json({ error: 'Search failed' });
  }
});

/**
 * GET /api/knowledge/stats
 * Get vector DB statistics
 */
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await getVectorDbStats();
    res.json({ data: stats });
  } catch (error: any) {
    logger.error('Failed to get stats', { error: error.message });
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

/**
 * POST /api/knowledge/status
 * Get embedding status for a list of knowledge IDs
 */
router.post('/status', async (req: Request, res: Response) => {
  try {
    const { ids } = req.body || {};

    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: 'ids must be an array' });
    }

    const uniqueIds = Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.trim())));
    if (uniqueIds.length === 0) {
      return res.json({ data: [] });
    }

    if (uniqueIds.length > 500) {
      return res.status(400).json({ error: 'Too many ids (max 500)' });
    }

    const statuses = await getKnowledgeEmbeddingStatuses(uniqueIds);

    return res.json({ data: statuses });
  } catch (error: any) {
    logger.error('Failed to get knowledge embedding statuses', { error: error.message });
    return res.status(500).json({ error: 'Failed to get knowledge embedding statuses' });
  }
});

/**
 * POST /api/knowledge/embed-all
 * Bulk embed all knowledge items from Dashboard
 * Migrated from /api/internal/embed-all-knowledge
 */
router.post('/embed-all', async (req: Request, res: Response) => {
  const villageId = typeof req.query.village_id === 'string' ? req.query.village_id.trim() : '';
  if (!villageId) {
    return res.status(400).json({ error: 'village_id is required' });
  }

  logger.info('Starting bulk knowledge embedding', { villageId });
  
  try {
    const axios = (await import('axios')).default;

    // Fetch all knowledge from Dashboard
    const response = await axios.get(
      `${config.dashboardServiceUrl}/api/internal/knowledge`,
      {
        params: { limit: 500, village_id: villageId },
        headers: { 'x-internal-api-key': config.internalApiKey },
        timeout: 30000,
      }
    );
    
    const knowledgeItems = response.data.data || [];
    
    if (knowledgeItems.length === 0) {
      return res.json({
        success: true,
        processed: 0,
        message: 'No knowledge items to process',
      });
    }
    
    let processed = 0;
    const failedMap = new Map<string, any>();
    
    for (const item of knowledgeItems) {
      try {
        const itemScope = resolveKnowledgeScope({
          villageId: item.village_id || null,
          scope: item.scope,
          isGlobal: Boolean(item.is_global),
        });
        await deleteKnowledgeVector(item.id);
        await embedKnowledgeChunks({
          id: item.id,
          villageId: itemScope.villageId,
          scope: itemScope.scope,
          isGlobal: itemScope.isGlobal,
          title: item.title || '',
          content: item.content,
          category: item.category || 'custom',
          keywords: item.keywords || [],
          qualityScore: item.quality_score || 1.0,
        });
        processed++;
      } catch (itemError: any) {
        logger.error('Knowledge embedding failed', { id: item.id, error: itemError.message });
        failedMap.set(item.id, item);
      }
    }

    if (failedMap.size > 0) {
      logger.warn('Retrying failed knowledge embeddings', { count: failedMap.size });
      const retryItems = Array.from(failedMap.values());
      failedMap.clear();

      for (const item of retryItems) {
        try {
          const itemScope = resolveKnowledgeScope({
            villageId: item.village_id || null,
            scope: item.scope,
            isGlobal: Boolean(item.is_global),
          });
          await deleteKnowledgeVector(item.id);
          await embedKnowledgeChunks({
            id: item.id,
            villageId: itemScope.villageId,
            scope: itemScope.scope,
            isGlobal: itemScope.isGlobal,
            title: item.title || '',
            content: item.content,
            category: item.category || 'custom',
            keywords: item.keywords || [],
            qualityScore: item.quality_score || 1.0,
          });
          processed++;
        } catch (retryError: any) {
          logger.error('Retry knowledge embedding failed', { id: item.id, error: retryError.message });
          failedMap.set(item.id, item);
        }
      }
    }
    
    logger.info('Bulk knowledge embedding completed', {
      processed,
      failed: failedMap.size,
      total: knowledgeItems.length,
    });
    
    return res.json({
      success: true,
      processed,
      failed: failedMap.size,
      total: knowledgeItems.length,
      failed_ids: Array.from(failedMap.keys()),
    });
  } catch (error: any) {
    logger.error('Bulk knowledge embedding failed', {
      error: error.message,
    });
    
    return res.status(500).json({
      error: 'Bulk embedding failed',
      details: error.message,
    });
  }
});

export default router;
