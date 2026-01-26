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
import logger from '../utils/logger';
import { config } from '../config/env';
import { generateEmbedding } from '../services/embedding.service';
import {
  upsertKnowledgeVector,
  deleteKnowledgeVector,
  getKnowledgeVector,
  getKnowledgeEmbeddingStatuses,
  searchVectors,
  getVectorDbStats,
} from '../services/vector-db.service';
import { firstHeader } from '../utils/http';

const router = Router();

// Middleware to verify internal API key
function verifyInternalKey(req: Request, res: Response, next: Function) {
  const apiKey = firstHeader(req.headers['x-internal-api-key']);
  if (!apiKey || apiKey !== config.internalApiKey) {
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
    const { id, title, content, category, keywords, qualityScore, village_id, villageId } = req.body;

    if (!id || !title || !content || !category) {
      return res.status(400).json({ 
        error: 'Missing required fields: id, title, content, category' 
      });
    }

    logger.info('Adding knowledge vector', { id, category });

    // Generate embedding
    const embeddingResult = await generateEmbedding(content, {
      taskType: 'RETRIEVAL_DOCUMENT',
      outputDimensionality: 768,
    });

    // Store in vector DB
    await upsertKnowledgeVector({
      id,
      villageId: village_id || villageId || null,
      title,
      content,
      category,
      keywords: keywords || [],
      embedding: embeddingResult.values,
      embeddingModel: embeddingResult.model,
      qualityScore: qualityScore || 1.0,
    });

    res.status(201).json({
      status: 'success',
      data: {
        id,
        embeddingDimensions: embeddingResult.dimensions,
        embeddingModel: embeddingResult.model,
      },
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
    const { id } = req.params;
    const { title, content, category, keywords, qualityScore, village_id, villageId } = req.body;

    if (!title || !content || !category) {
      return res.status(400).json({ 
        error: 'Missing required fields: title, content, category' 
      });
    }

    logger.info('Updating knowledge vector', { id, category });

    // Generate new embedding
    const embeddingResult = await generateEmbedding(content, {
      taskType: 'RETRIEVAL_DOCUMENT',
      outputDimensionality: 768,
    });

    // Upsert will replace the old vector
    await upsertKnowledgeVector({
      id,
      villageId: village_id || villageId || null,
      title,
      content,
      category,
      keywords: keywords || [],
      embedding: embeddingResult.values,
      embeddingModel: embeddingResult.model,
      qualityScore: qualityScore || 1.0,
    });

    res.json({
      status: 'success',
      data: {
        id,
        embeddingDimensions: embeddingResult.dimensions,
        embeddingModel: embeddingResult.model,
      },
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
    const { id } = req.params;

    logger.info('Deleting knowledge vector', { id });

    const deleted = await deleteKnowledgeVector(id);

    if (!deleted) {
      return res.status(404).json({ error: 'Knowledge vector not found' });
    }

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
    const { id } = req.params;

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
router.post('/embed-all', async (_req: Request, res: Response) => {
  logger.info('Starting bulk knowledge embedding');
  
  try {
    const axios = (await import('axios')).default;
    const { generateBatchEmbeddings } = await import('../services/embedding.service');
    
    // Fetch all knowledge from Dashboard
    const response = await axios.get(
      `${config.dashboardServiceUrl}/api/internal/knowledge`,
      {
        params: { limit: 500 },
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
    
    // Process in batches of 10
    const batchSize = 10;
    for (let i = 0; i < knowledgeItems.length; i += batchSize) {
      const batch = knowledgeItems.slice(i, i + batchSize);
      const texts = batch.map((k: any) => k.title ? `${k.title}\n\n${k.content}` : k.content);
      
      try {
        const embeddings = await generateBatchEmbeddings(texts, {
          taskType: 'RETRIEVAL_DOCUMENT',
          outputDimensionality: 768,
        });
        
        // Store each embedding to local vector DB
        for (let j = 0; j < batch.length; j++) {
          try {
            await upsertKnowledgeVector({
              id: batch[j].id,
              villageId: batch[j].village_id || null,
              title: batch[j].title || '',
              content: batch[j].content,
              category: batch[j].category || 'informasi_umum',
              keywords: batch[j].keywords || [],
              embedding: embeddings.embeddings[j].values,
              embeddingModel: embeddings.embeddings[j].model,
            });
            processed++;
          } catch (storeError) {
            failedMap.set(batch[j].id, batch[j]);
          }
        }
      } catch (batchError: any) {
        logger.error('Batch embedding failed', { error: batchError.message });
        batch.forEach((item: any) => failedMap.set(item.id, item));
      }
    }

    // Retry failed items once
    if (failedMap.size > 0) {
      logger.warn('Retrying failed knowledge embeddings', { count: failedMap.size });
      const retryItems = Array.from(failedMap.values());
      failedMap.clear();

      const retryBatchSize = 5;
      for (let i = 0; i < retryItems.length; i += retryBatchSize) {
        const retryBatch = retryItems.slice(i, i + retryBatchSize);
        const retryTexts = retryBatch.map((k: any) => k.title ? `${k.title}\n\n${k.content}` : k.content);

        try {
          const retryEmbeddings = await generateBatchEmbeddings(retryTexts, {
            taskType: 'RETRIEVAL_DOCUMENT',
            outputDimensionality: 768,
          });

          for (let j = 0; j < retryBatch.length; j++) {
            try {
              await upsertKnowledgeVector({
                id: retryBatch[j].id,
                villageId: retryBatch[j].village_id || null,
                title: retryBatch[j].title || '',
                content: retryBatch[j].content,
                category: retryBatch[j].category || 'informasi_umum',
                keywords: retryBatch[j].keywords || [],
                embedding: retryEmbeddings.embeddings[j].values,
                embeddingModel: retryEmbeddings.embeddings[j].model,
              });
              processed++;
            } catch (retryStoreError) {
              failedMap.set(retryBatch[j].id, retryBatch[j]);
            }
          }
        } catch (retryBatchError: any) {
          logger.error('Retry batch embedding failed', { error: retryBatchError.message });
          retryBatch.forEach((item: any) => failedMap.set(item.id, item));
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
