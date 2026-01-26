/**
 * Unified Vector Search API Routes
 * 
 * Provides combined search across knowledge and documents
 * Used by RAG service for context retrieval
 * 
 * Endpoints:
 * - POST /api/search - Combined vector search
 * - GET  /api/search/stats - Vector DB statistics
 */

import { Router, Request, Response } from 'express';
import logger from '../utils/logger';
import { config } from '../config/env';
import { generateEmbedding } from '../services/embedding.service';
import { 
  searchVectors, 
  getVectorDbStats,
  recordBatchRetrievals,
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
 * POST /api/search
 * Combined vector search across knowledge and documents
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { 
      query, 
      embedding,  // Optional: pre-computed embedding
      topK = 5, 
      minScore = 0.7, 
      categories,
      sourceTypes = ['knowledge', 'document'],
      villageId,
      trackUsage = true,
    } = req.body;

    if (!query && !embedding) {
      return res.status(400).json({ error: 'Query or embedding is required' });
    }

    const startTime = Date.now();

    // Use provided embedding or generate new one
    let queryEmbedding: number[];
    if (embedding && Array.isArray(embedding)) {
      queryEmbedding = embedding;
    } else {
      try {
        const embeddingResult = await generateEmbedding(query, {
          taskType: 'RETRIEVAL_QUERY',
          outputDimensionality: 768,
          useCache: true,
        });
        queryEmbedding = embeddingResult.values;
      } catch (error: any) {
        const searchTimeMs = Date.now() - startTime;
        logger.warn('Embedding generation failed; returning empty search results', {
          error: error?.message,
        });
        return res.status(200).json({
          data: [],
          total: 0,
          searchTimeMs,
          warning: 'Embedding generation failed',
        });
      }
    }

    // Search vectors
    const results = await searchVectors(queryEmbedding, {
      topK,
      minScore,
      categories,
      sourceTypes,
      villageId,
    });

    // Track usage for knowledge items (for quality scoring)
    if (trackUsage && results.length > 0) {
      const knowledgeIds = results
        .filter(r => r.sourceType === 'knowledge')
        .map(r => r.id);
      
      if (knowledgeIds.length > 0) {
        // Fire and forget
        recordBatchRetrievals(knowledgeIds).catch(() => {});
      }
    }

    const searchTimeMs = Date.now() - startTime;

    res.json({
      data: results,
      total: results.length,
      searchTimeMs,
    });
  } catch (error: any) {
    logger.error('Vector search failed', { error: error.message });
    res.status(500).json({ error: 'Search failed' });
  }
});

/**
 * GET /api/search/stats
 * Get vector database statistics
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

export default router;
