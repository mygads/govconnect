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
  searchVectors,
  getVectorDbStats,
} from '../services/vector-db.service';

const router = Router();

// Middleware to verify internal API key
function verifyInternalKey(req: Request, res: Response, next: Function) {
  const apiKey = req.headers['x-internal-api-key'];
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
    const { query, topK, minScore, categories } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    logger.info('Knowledge vector search', { queryLength: query.length });

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
    let failed = 0;
    
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
            failed++;
          }
        }
      } catch (batchError: any) {
        logger.error('Batch embedding failed', { error: batchError.message });
        failed += batch.length;
      }
    }
    
    logger.info('Bulk knowledge embedding completed', {
      processed,
      failed,
      total: knowledgeItems.length,
    });
    
    return res.json({
      success: true,
      processed,
      failed,
      total: knowledgeItems.length,
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
