/**
 * Document Processing Route for AI Service
 * 
 * Internal API endpoint to process documents:
 * 1. Receive document content from Dashboard
 * 2. Chunk the text (with semantic chunking option)
 * 3. Generate embeddings
 * 4. Store chunks back to Dashboard
 * 5. Background embedding job management
 */

import { Router, Request, Response } from 'express';
import logger from '../utils/logger';
import { 
  processDocumentWithEmbeddings, 
  chunkText,
  semanticChunking,
  processDocumentSemanticChunking,
} from '../services/document-processor.service';
import { storeDocumentChunkEmbeddings } from '../services/vector-store.service';
import { config } from '../config/env';
import axios from 'axios';
import {
  queueKnowledgeEmbedding,
  queueDocumentEmbedding,
  queueBatchKnowledgeEmbedding,
  getEmbeddingJobStatus,
  getEmbeddingQueueStats,
  waitForEmbeddingJob,
} from '../services/embedding-worker.service';

const router = Router();

// Internal API key verification middleware
function verifyInternalKey(req: Request, res: Response, next: Function) {
  const apiKey = req.headers['x-internal-api-key'];
  
  if (!apiKey || apiKey !== config.internalApiKey) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  next();
}

/**
 * @swagger
 * /api/internal/process-document:
 *   post:
 *     tags: [Document Processing]
 *     summary: Process a document
 *     description: Process a document - chunk text and generate embeddings
 *     security:
 *       - InternalApiKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - documentId
 *               - content
 *             properties:
 *               documentId:
 *                 type: string
 *               content:
 *                 type: string
 *               mimeType:
 *                 type: string
 *               title:
 *                 type: string
 *               category:
 *                 type: string
 *     responses:
 *       200:
 *         description: Document processed successfully
 *       400:
 *         description: Invalid request
 *       403:
 *         description: Unauthorized
 */
router.post('/process-document', verifyInternalKey, async (req: Request, res: Response) => {
  const { documentId, content, mimeType, title, category } = req.body;
  
  if (!documentId || !content) {
    return res.status(400).json({ error: 'documentId and content are required' });
  }
  
  logger.info('Starting document processing', {
    documentId,
    contentLength: content.length,
    mimeType,
  });
  
  try {
    // Check if content is placeholder (needs external parsing)
    if (content === '[PDF_CONTENT_PLACEHOLDER]' || content === '[DOCX_CONTENT_PLACEHOLDER]') {
      // TODO: Implement PDF/DOCX parsing
      // For now, return error
      await updateDocumentStatus(documentId, 'failed', 'PDF/DOCX parsing not yet implemented');
      return res.status(400).json({ 
        error: 'PDF/DOCX parsing not yet implemented. Please upload TXT or MD files.' 
      });
    }
    
    // Process document with embeddings
    const embeddedChunks = await processDocumentWithEmbeddings(content, documentId, {
      chunkSize: 1000,
      chunkOverlap: 200,
    });
    
    if (embeddedChunks.length === 0) {
      await updateDocumentStatus(documentId, 'failed', 'No chunks generated from document');
      return res.status(400).json({ error: 'No chunks generated from document' });
    }
    
    // Store chunks with embeddings to Dashboard
    const stored = await storeDocumentChunkEmbeddings(documentId, embeddedChunks);
    
    if (!stored) {
      await updateDocumentStatus(documentId, 'failed', 'Failed to store chunks');
      return res.status(500).json({ error: 'Failed to store chunks' });
    }
    
    // Update document status to completed
    await updateDocumentStatus(documentId, 'completed', null, embeddedChunks.length);
    
    logger.info('Document processing completed', {
      documentId,
      chunksCount: embeddedChunks.length,
    });
    
    return res.json({
      success: true,
      chunksCount: embeddedChunks.length,
      message: 'Document processed and embeddings stored successfully',
    });
  } catch (error: any) {
    logger.error('Document processing failed', {
      documentId,
      error: error.message,
    });
    
    await updateDocumentStatus(documentId, 'failed', error.message);
    
    return res.status(500).json({
      error: 'Document processing failed',
      details: error.message,
    });
  }
});

/**
 * @swagger
 * /api/internal/embed-knowledge:
 *   post:
 *     tags: [Document Processing]
 *     summary: Embed single knowledge item
 *     description: Generate embedding for a single knowledge item
 *     security:
 *       - InternalApiKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - knowledgeId
 *               - content
 *             properties:
 *               knowledgeId:
 *                 type: string
 *               content:
 *                 type: string
 *               title:
 *                 type: string
 *     responses:
 *       200:
 *         description: Embedding generated successfully
 *       400:
 *         description: Invalid request
 *       403:
 *         description: Unauthorized
 */
router.post('/embed-knowledge', verifyInternalKey, async (req: Request, res: Response) => {
  const { knowledgeId, content, title } = req.body;
  
  if (!knowledgeId || !content) {
    return res.status(400).json({ error: 'knowledgeId and content are required' });
  }
  
  logger.info('Generating embedding for knowledge item', {
    knowledgeId,
    contentLength: content.length,
  });
  
  try {
    const { generateEmbedding } = await import('../services/embedding.service');
    
    // Combine title and content for better embedding
    const textToEmbed = title ? `${title}\n\n${content}` : content;
    
    const embedding = await generateEmbedding(textToEmbed, {
      taskType: 'RETRIEVAL_DOCUMENT',
      outputDimensionality: 768,
    });
    
    // Store embedding to Dashboard
    const { storeKnowledgeEmbedding } = await import('../services/vector-store.service');
    const stored = await storeKnowledgeEmbedding(knowledgeId, embedding.values);
    
    if (!stored) {
      return res.status(500).json({ error: 'Failed to store embedding' });
    }
    
    logger.info('Knowledge embedding generated and stored', {
      knowledgeId,
      dimensions: embedding.dimensions,
    });
    
    return res.json({
      success: true,
      dimensions: embedding.dimensions,
      model: embedding.model,
    });
  } catch (error: any) {
    logger.error('Failed to generate knowledge embedding', {
      knowledgeId,
      error: error.message,
    });
    
    return res.status(500).json({
      error: 'Failed to generate embedding',
      details: error.message,
    });
  }
});

/**
 * @swagger
 * /api/internal/embed-all-knowledge:
 *   post:
 *     tags: [Document Processing]
 *     summary: Embed all knowledge items
 *     description: Generate embeddings for all knowledge items without embeddings
 *     security:
 *       - InternalApiKey: []
 *     responses:
 *       200:
 *         description: Batch embedding completed
 *       403:
 *         description: Unauthorized
 */
router.post('/embed-all-knowledge', verifyInternalKey, async (req: Request, res: Response) => {
  logger.info('Starting bulk knowledge embedding');
  
  try {
    // Fetch all knowledge without embeddings from Dashboard
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
    
    const { generateBatchEmbeddings } = await import('../services/embedding.service');
    const { storeKnowledgeEmbedding } = await import('../services/vector-store.service');
    
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
        
        // Store each embedding
        for (let j = 0; j < batch.length; j++) {
          const stored = await storeKnowledgeEmbedding(
            batch[j].id,
            embeddings.embeddings[j].values
          );
          
          if (stored) {
            processed++;
          } else {
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

/**
 * Helper: Update document status in Dashboard
 */
async function updateDocumentStatus(
  documentId: string, 
  status: string, 
  errorMessage: string | null,
  totalChunks?: number
): Promise<void> {
  try {
    await axios.put(
      `${config.dashboardServiceUrl}/api/internal/documents/${documentId}`,
      {
        status,
        error_message: errorMessage,
        total_chunks: totalChunks,
      },
      {
        headers: { 'x-internal-api-key': config.internalApiKey },
        timeout: 10000,
      }
    );
  } catch (error: any) {
    logger.error('Failed to update document status', {
      documentId,
      status,
      error: error.message,
    });
  }
}

// ==================== SEMANTIC CHUNKING ENDPOINTS ====================

/**
 * @swagger
 * /api/internal/process-document-semantic:
 *   post:
 *     tags: [Document Processing]
 *     summary: Process document with semantic chunking
 *     description: Process document using paragraph-aware semantic chunking
 *     security:
 *       - InternalApiKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - documentId
 *               - content
 *             properties:
 *               documentId:
 *                 type: string
 *               content:
 *                 type: string
 *               mimeType:
 *                 type: string
 *               title:
 *                 type: string
 *               category:
 *                 type: string
 *               maxChunkSize:
 *                 type: integer
 *                 default: 1500
 *     responses:
 *       200:
 *         description: Document processed with semantic chunking
 *       400:
 *         description: Invalid request
 *       403:
 *         description: Unauthorized
 */
router.post('/process-document-semantic', verifyInternalKey, async (req: Request, res: Response) => {
  const { documentId, content, mimeType, title, category, maxChunkSize } = req.body;
  
  if (!documentId || !content) {
    return res.status(400).json({ error: 'documentId and content are required' });
  }
  
  logger.info('Starting semantic document processing', {
    documentId,
    contentLength: content.length,
    mimeType,
    maxChunkSize,
  });
  
  try {
    // Check if content is placeholder
    if (content === '[PDF_CONTENT_PLACEHOLDER]' || content === '[DOCX_CONTENT_PLACEHOLDER]') {
      await updateDocumentStatus(documentId, 'failed', 'PDF/DOCX parsing not yet implemented');
      return res.status(400).json({ 
        error: 'PDF/DOCX parsing not yet implemented. Please upload TXT or MD files.' 
      });
    }
    
    // Process document with semantic chunking
    const embeddedChunks = await processDocumentSemanticChunking(
      content, 
      documentId, 
      maxChunkSize || 1500
    );
    
    if (embeddedChunks.length === 0) {
      await updateDocumentStatus(documentId, 'failed', 'No chunks generated from document');
      return res.status(400).json({ error: 'No chunks generated from document' });
    }
    
    // Store chunks with embeddings to Dashboard
    const stored = await storeDocumentChunkEmbeddings(documentId, embeddedChunks);
    
    if (!stored) {
      await updateDocumentStatus(documentId, 'failed', 'Failed to store chunks');
      return res.status(500).json({ error: 'Failed to store chunks' });
    }
    
    // Update document status to completed
    await updateDocumentStatus(documentId, 'completed', null, embeddedChunks.length);
    
    logger.info('Semantic document processing completed', {
      documentId,
      chunksCount: embeddedChunks.length,
      method: 'semantic',
    });
    
    return res.json({
      success: true,
      chunksCount: embeddedChunks.length,
      method: 'semantic',
      message: 'Document processed with semantic chunking and embeddings stored successfully',
    });
  } catch (error: any) {
    logger.error('Semantic document processing failed', {
      documentId,
      error: error.message,
    });
    
    await updateDocumentStatus(documentId, 'failed', error.message);
    
    return res.status(500).json({
      error: 'Document processing failed',
      details: error.message,
    });
  }
});

// ==================== EMBEDDING JOB QUEUE ENDPOINTS ====================

/**
 * @swagger
 * /api/internal/embedding-jobs/knowledge:
 *   post:
 *     tags: [Document Processing]
 *     summary: Queue knowledge embedding job
 *     description: Queue async embedding job for a knowledge item
 *     security:
 *       - InternalApiKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - knowledgeId
 *             properties:
 *               knowledgeId:
 *                 type: string
 *               priority:
 *                 type: integer
 *               waitForCompletion:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Job queued or completed
 *       403:
 *         description: Unauthorized
 */
router.post('/embedding-jobs/knowledge', verifyInternalKey, async (req: Request, res: Response) => {
  const { knowledgeId, priority, waitForCompletion } = req.body;
  
  if (!knowledgeId) {
    return res.status(400).json({ error: 'knowledgeId is required' });
  }
  
  logger.info('Queueing knowledge embedding job', { knowledgeId, priority });
  
  const jobId = queueKnowledgeEmbedding(knowledgeId, priority || 0);
  
  if (waitForCompletion) {
    try {
      const result = await waitForEmbeddingJob(jobId, 60000);
      return res.json({
        success: true,
        jobId,
        status: result.status,
        result: result.result,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        jobId,
        error: error.message,
      });
    }
  }
  
  return res.json({
    success: true,
    jobId,
    message: 'Embedding job queued successfully',
  });
});

/**
 * @swagger
 * /api/internal/embedding-jobs/document:
 *   post:
 *     tags: [Document Processing]
 *     summary: Queue document embedding job
 *     description: Queue async embedding job for a document
 *     security:
 *       - InternalApiKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - documentId
 *             properties:
 *               documentId:
 *                 type: string
 *               priority:
 *                 type: integer
 *               waitForCompletion:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Job queued or completed
 *       403:
 *         description: Unauthorized
 */
router.post('/embedding-jobs/document', verifyInternalKey, async (req: Request, res: Response) => {
  const { documentId, priority, waitForCompletion } = req.body;
  
  if (!documentId) {
    return res.status(400).json({ error: 'documentId is required' });
  }
  
  logger.info('Queueing document embedding job', { documentId, priority });
  
  const jobId = queueDocumentEmbedding(documentId, priority || 0);
  
  if (waitForCompletion) {
    try {
      const result = await waitForEmbeddingJob(jobId, 120000); // 2 min timeout for documents
      return res.json({
        success: true,
        jobId,
        status: result.status,
        result: result.result,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        jobId,
        error: error.message,
      });
    }
  }
  
  return res.json({
    success: true,
    jobId,
    message: 'Document embedding job queued successfully',
  });
});

/**
 * @swagger
 * /api/internal/embedding-jobs/batch-knowledge:
 *   post:
 *     tags: [Document Processing]
 *     summary: Queue batch knowledge embedding
 *     description: Queue batch embedding regeneration for all knowledge items
 *     security:
 *       - InternalApiKey: []
 *     responses:
 *       200:
 *         description: Batch job queued
 *       403:
 *         description: Unauthorized
 */
router.post('/embedding-jobs/batch-knowledge', verifyInternalKey, async (req: Request, res: Response) => {
  logger.info('Queueing batch knowledge embedding job');
  
  const jobId = queueBatchKnowledgeEmbedding();
  
  return res.json({
    success: true,
    jobId,
    message: 'Batch knowledge embedding job queued successfully',
  });
});

/**
 * @swagger
 * /api/internal/embedding-jobs/{jobId}:
 *   get:
 *     tags: [Document Processing]
 *     summary: Get embedding job status
 *     description: Get status of an embedding job
 *     security:
 *       - InternalApiKey: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job status
 *       404:
 *         description: Job not found
 *       403:
 *         description: Unauthorized
 */
router.get('/embedding-jobs/:jobId', verifyInternalKey, async (req: Request, res: Response) => {
  const { jobId } = req.params;
  
  const job = getEmbeddingJobStatus(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  return res.json(job);
});

/**
 * @swagger
 * /api/internal/embedding-jobs-stats:
 *   get:
 *     tags: [Document Processing]
 *     summary: Get embedding job queue stats
 *     description: Get embedding job queue statistics
 *     security:
 *       - InternalApiKey: []
 *     responses:
 *       200:
 *         description: Queue statistics
 *       403:
 *         description: Unauthorized
 */
router.get('/embedding-jobs-stats', verifyInternalKey, async (req: Request, res: Response) => {
  const stats = getEmbeddingQueueStats();
  
  return res.json(stats);
});

export default router;
