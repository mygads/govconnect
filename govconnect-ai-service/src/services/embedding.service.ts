/**
 * Embedding Service for GovConnect AI
 * 
 * Implements Gemini Embedding API (gemini-embedding-001) for semantic search and RAG
 * Based on Google's best practices from the Gemini Cookbook
 * 
 * Key features:
 * - Single and batch embedding generation
 * - Task-type optimization (RETRIEVAL_DOCUMENT, RETRIEVAL_QUERY, etc.)
 * - Configurable output dimensions (768 recommended for balance)
 * - L2 normalization for accurate cosine similarity
 * - Query embedding cache for reduced API calls
 * 
 * @see https://ai.google.dev/gemini-api/docs/embeddings
 */

import crypto from 'crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';
import logger from '../utils/logger';
import { config } from '../config/env';
import {
  EmbeddingTaskType,
  EmbeddingDimension,
  EmbeddingResult,
  BatchEmbeddingResult,
  EmbeddingConfig,
  EmbeddingStats,
} from '../types/embedding.types';

// Initialize Gemini client
const genAI = new GoogleGenerativeAI(config.geminiApiKey);

// Default configuration
const DEFAULT_MODEL = 'gemini-embedding-001';
const DEFAULT_DIMENSIONS: EmbeddingDimension = 768;
const MAX_BATCH_SIZE = 100; // Gemini API limit
const EMBEDDING_RETRY_COUNT = parseInt(process.env.EMBEDDING_RETRY_COUNT || '2', 10);
const EMBEDDING_RETRY_BASE_MS = parseInt(process.env.EMBEDDING_RETRY_BASE_MS || '750', 10);
const EMBEDDING_RETRY_MAX_MS = parseInt(process.env.EMBEDDING_RETRY_MAX_MS || '5000', 10);

function isBlankText(text: unknown): boolean {
  return typeof text !== 'string' || text.trim().length === 0;
}

function makeZeroEmbedding(dimensions: number, modelLabel: string): EmbeddingResult {
  return {
    values: Array.from({ length: dimensions }, () => 0),
    dimensions,
    model: modelLabel,
    normalized: false,
  };
}

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries: number = EMBEDDING_RETRY_COUNT
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      if (attempt >= maxRetries) {
        break;
      }

      const backoff = Math.min(
        EMBEDDING_RETRY_BASE_MS * Math.pow(2, attempt),
        EMBEDDING_RETRY_MAX_MS
      );
      const jitter = Math.floor(Math.random() * 250);

      logger.warn(`${label} failed, retrying`, {
        attempt: attempt + 1,
        maxRetries,
        backoffMs: backoff + jitter,
        error: error.message,
      });

      await new Promise(resolve => setTimeout(resolve, backoff + jitter));
    }
  }

  throw lastError;
}

// ============================================================================
// EMBEDDING CACHE - Reduces API calls for similar/repeated queries
// ============================================================================

interface CachedEmbedding {
  embedding: number[];
  timestamp: number;
  taskType: EmbeddingTaskType;
}

const embeddingCache = new Map<string, CachedEmbedding>();
const EMBEDDING_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_CACHE_SIZE = 500; // Maximum cached embeddings

// Cache statistics
let cacheStats = {
  hits: 0,
  misses: 0,
  evictions: 0,
};

/**
 * Normalize query text for cache key generation
 */
function normalizeForCache(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, ''); // Remove punctuation for fuzzy matching
}

/**
 * Generate cache key from text and task type
 */
function getCacheKey(text: string, taskType: EmbeddingTaskType): string {
  const normalized = normalizeForCache(text);
  const hash = crypto.createHash('md5').update(`${taskType}:${normalized}`).digest('hex');
  return hash;
}

/**
 * Clean up expired cache entries
 */
function cleanupExpiredCache(): void {
  const now = Date.now();
  let expired = 0;
  
  for (const [key, value] of embeddingCache.entries()) {
    if (now - value.timestamp > EMBEDDING_CACHE_TTL_MS) {
      embeddingCache.delete(key);
      expired++;
    }
  }
  
  if (expired > 0) {
    cacheStats.evictions += expired;
    logger.debug('Cleaned up expired embedding cache entries', { expired });
  }
}

/**
 * Evict oldest entries if cache is too large
 */
function evictOldestIfNeeded(): void {
  if (embeddingCache.size <= MAX_CACHE_SIZE) return;
  
  // Find oldest entries
  const entries = Array.from(embeddingCache.entries())
    .sort((a, b) => a[1].timestamp - b[1].timestamp);
  
  // Remove oldest 20%
  const toRemove = Math.floor(MAX_CACHE_SIZE * 0.2);
  for (let i = 0; i < toRemove && i < entries.length; i++) {
    embeddingCache.delete(entries[i][0]);
    cacheStats.evictions++;
  }
  
  logger.debug('Evicted oldest embedding cache entries', { evicted: toRemove });
}

// Cleanup expired cache every 5 minutes
setInterval(cleanupExpiredCache, 5 * 60 * 1000);

/**
 * Get embedding cache statistics
 */
export function getEmbeddingCacheStats(): {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRate: number;
} {
  const total = cacheStats.hits + cacheStats.misses;
  return {
    size: embeddingCache.size,
    hits: cacheStats.hits,
    misses: cacheStats.misses,
    evictions: cacheStats.evictions,
    hitRate: total > 0 ? (cacheStats.hits / total) * 100 : 0,
  };
}

/**
 * Clear embedding cache
 */
export function clearEmbeddingCache(): void {
  embeddingCache.clear();
  cacheStats = { hits: 0, misses: 0, evictions: 0 };
  logger.info('Embedding cache cleared');
}

// ============================================================================
// EMBEDDING GENERATION
// ============================================================================

// Statistics tracking
let stats: EmbeddingStats = {
  totalEmbeddingsGenerated: 0,
  totalTokensUsed: 0,
  averageLatencyMs: 0,
  errorCount: 0,
  successRate: 100,
};

/**
 * Generate embedding for a single text
 * Uses cache for query embeddings to reduce API calls
 * 
 * @param text - The text to embed
 * @param options - Configuration options
 * @returns EmbeddingResult with normalized vector
 * 
 * @example
 * // For indexing a knowledge base document
 * const result = await generateEmbedding(
 *   "Jam operasional kelurahan adalah Senin-Jumat 08:00-15:00",
 *   { taskType: 'RETRIEVAL_DOCUMENT' }
 * );
 * 
 * @example
 * // For a user query (will be cached)
 * const result = await generateEmbedding(
 *   "jam buka kelurahan kapan?",
 *   { taskType: 'RETRIEVAL_QUERY' }
 * );
 */
export async function generateEmbedding(
  text: string,
  options: EmbeddingConfig = {}
): Promise<EmbeddingResult> {
  const {
    model = DEFAULT_MODEL,
    outputDimensionality = DEFAULT_DIMENSIONS,
    taskType = 'RETRIEVAL_DOCUMENT',
    normalize = true,
    useCache = true, // Enable cache by default for queries
  } = options;

  const startTime = Date.now();

  // Empty/blank text is not embeddable; return zero vector so callers can continue safely.
  // This prevents batch embedding failures when some records have empty content.
  if (isBlankText(text)) {
    logger.warn('generateEmbedding called with blank text; returning zero vector', {
      taskType,
      dimensions: outputDimensionality,
    });
    return makeZeroEmbedding(outputDimensionality, 'empty');
  }

  // Check cache for query embeddings (RETRIEVAL_QUERY task type)
  // Only cache queries since document embeddings are stored in DB
  if (useCache && taskType === 'RETRIEVAL_QUERY') {
    const cacheKey = getCacheKey(text, taskType);
    const cached = embeddingCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < EMBEDDING_CACHE_TTL_MS) {
      cacheStats.hits++;
      logger.debug('Embedding cache hit', {
        textLength: text.length,
        cacheSize: embeddingCache.size,
      });
      
      return {
        values: cached.embedding,
        dimensions: cached.embedding.length,
        model: 'cached',
        normalized: true,
      };
    }
    cacheStats.misses++;
  }

  try {
    logger.debug('Generating embedding', {
      textLength: text.length,
      model,
      dimensions: outputDimensionality,
      taskType,
    });

    // Get embedding model
    const embeddingModel = genAI.getGenerativeModel({ model });

    // Call Gemini API - embedContent accepts string directly or EmbedContentRequest
    const result = await withRetry(
      () => embeddingModel.embedContent(text),
      'embedContent'
    );

    let values = result.embedding.values;

    // Truncate to desired dimensions if needed
    if (values.length > outputDimensionality) {
      values = values.slice(0, outputDimensionality);
    }

    // Normalize embedding for dimensions < 3072
    // This is required for accurate cosine similarity
    if (normalize && outputDimensionality < 3072) {
      values = normalizeEmbedding(values);
    }

    const endTime = Date.now();
    const latencyMs = endTime - startTime;

    // Update stats
    stats.totalEmbeddingsGenerated++;
    stats.averageLatencyMs = (stats.averageLatencyMs * (stats.totalEmbeddingsGenerated - 1) + latencyMs) / stats.totalEmbeddingsGenerated;
    stats.lastEmbeddingAt = new Date();
    updateSuccessRate(true);

    // Cache query embeddings for future use
    if (useCache && taskType === 'RETRIEVAL_QUERY') {
      const cacheKey = getCacheKey(text, taskType);
      embeddingCache.set(cacheKey, {
        embedding: values,
        timestamp: Date.now(),
        taskType,
      });
      evictOldestIfNeeded();
      
      logger.debug('Embedding cached', {
        cacheSize: embeddingCache.size,
        textLength: text.length,
      });
    }

    logger.debug('Embedding generated successfully', {
      dimensions: values.length,
      latencyMs,
    });

    return {
      values,
      dimensions: values.length,
      model,
      normalized: normalize && outputDimensionality < 3072,
    };
  } catch (error: any) {
    const endTime = Date.now();
    stats.errorCount++;
    updateSuccessRate(false);

    logger.error('Failed to generate embedding', {
      error: error.message,
      textLength: text.length,
      latencyMs: endTime - startTime,
    });

    throw error;
  }
}

/**
 * Generate embeddings for multiple texts in batch
 * More efficient than calling generateEmbedding multiple times
 * 
 * @param texts - Array of texts to embed
 * @param options - Configuration options
 * @returns BatchEmbeddingResult with all embeddings
 */
export async function generateBatchEmbeddings(
  texts: string[],
  options: EmbeddingConfig = {}
): Promise<BatchEmbeddingResult> {
  const {
    model = DEFAULT_MODEL,
    outputDimensionality = DEFAULT_DIMENSIONS,
    taskType = 'RETRIEVAL_DOCUMENT',
    normalize = true,
  } = options;

  const startTime = Date.now();

  if (texts.length === 0) {
    return {
      embeddings: [],
      processingTimeMs: 0,
    };
  }

  // Gemini batchEmbedContents can fail if some entries are blank.
  // We skip blank entries in the API call and fill their slots with zero vectors.
  const cleanedTexts = texts.map((t) => (typeof t === 'string' ? t : ''));
  const nonBlankTexts: string[] = [];
  const nonBlankIndexes: number[] = [];
  for (let i = 0; i < cleanedTexts.length; i++) {
    if (!isBlankText(cleanedTexts[i])) {
      nonBlankIndexes.push(i);
      nonBlankTexts.push(cleanedTexts[i]);
    }
  }

  if (nonBlankTexts.length === 0) {
    return {
      embeddings: cleanedTexts.map(() => makeZeroEmbedding(outputDimensionality, 'empty')),
      processingTimeMs: 0,
    };
  }

  // Split into batches if needed
  if (nonBlankTexts.length > MAX_BATCH_SIZE) {
    logger.info('Splitting large batch into smaller chunks', {
      totalTexts: nonBlankTexts.length,
      batchSize: MAX_BATCH_SIZE,
    });

    // We must preserve original positions; process in chunks of non-blank inputs.
    const filled: EmbeddingResult[] = cleanedTexts.map(() => makeZeroEmbedding(outputDimensionality, 'empty'));
    for (let i = 0; i < nonBlankTexts.length; i += MAX_BATCH_SIZE) {
      const chunkTexts = nonBlankTexts.slice(i, i + MAX_BATCH_SIZE);
      const chunkIndexes = nonBlankIndexes.slice(i, i + MAX_BATCH_SIZE);
      const chunkResult = await generateBatchEmbeddings(chunkTexts, options);
      for (let j = 0; j < chunkIndexes.length; j++) {
        if (chunkResult.embeddings[j]) {
          filled[chunkIndexes[j]] = chunkResult.embeddings[j];
        }
      }
    }

    return {
      embeddings: filled,
      processingTimeMs: Date.now() - startTime,
    };
  }

  try {
    logger.info('Generating batch embeddings', {
      count: nonBlankTexts.length,
      model,
      dimensions: outputDimensionality,
      taskType,
    });

    // Get embedding model
    const embeddingModel = genAI.getGenerativeModel({ model });

    // Prepare batch request - include model explicitly to avoid API validation issues
    const requestModel = model.startsWith('models/') ? model : `models/${model}`;
    const batchResult = await withRetry(
      () =>
        embeddingModel.batchEmbedContents({
          requests: nonBlankTexts.map(text => ({
            model: requestModel,
            content: { role: 'user', parts: [{ text }] },
          })),
        }),
      'batchEmbedContents'
    );

    // Process results
    const nonBlankEmbeddings: EmbeddingResult[] = batchResult.embeddings.map(embedding => {
      let values = embedding.values;

      // Truncate to desired dimensions if needed
      if (values.length > outputDimensionality) {
        values = values.slice(0, outputDimensionality);
      }

      // Normalize embedding for dimensions < 3072
      if (normalize && outputDimensionality < 3072) {
        values = normalizeEmbedding(values);
      }

      return {
        values,
        dimensions: values.length,
        model,
        normalized: normalize && outputDimensionality < 3072,
      };
    });

    const embeddings: EmbeddingResult[] = cleanedTexts.map(() => makeZeroEmbedding(outputDimensionality, 'empty'));
    for (let i = 0; i < nonBlankIndexes.length; i++) {
      const idx = nonBlankIndexes[i];
      if (nonBlankEmbeddings[i]) {
        embeddings[idx] = nonBlankEmbeddings[i];
      }
    }

    const endTime = Date.now();
    const latencyMs = endTime - startTime;

    // Update stats
    stats.totalEmbeddingsGenerated += nonBlankTexts.length;
    stats.averageLatencyMs = (stats.averageLatencyMs + latencyMs) / 2;
    stats.lastEmbeddingAt = new Date();
    updateSuccessRate(true);

    logger.info('Batch embeddings generated successfully', {
      count: nonBlankEmbeddings.length,
      avgDimensions: nonBlankEmbeddings[0]?.dimensions,
      latencyMs,
    });

    return {
      embeddings,
      processingTimeMs: latencyMs,
    };
  } catch (error: any) {
    logger.warn('Batch embedding failed, attempting single-request fallback', {
      error: error.message,
      count: nonBlankTexts.length,
    });

    try {
      const fallbackEmbeddings = await Promise.all(
        nonBlankTexts.map(text =>
          generateEmbedding(text, {
            model,
            outputDimensionality,
            taskType,
            normalize,
            useCache: false,
          })
        )
      );

      const embeddings: EmbeddingResult[] = cleanedTexts.map(() =>
        makeZeroEmbedding(outputDimensionality, 'empty')
      );
      for (let i = 0; i < nonBlankIndexes.length; i++) {
        const idx = nonBlankIndexes[i];
        if (fallbackEmbeddings[i]) {
          embeddings[idx] = fallbackEmbeddings[i];
        }
      }

      const latencyMs = Date.now() - startTime;

      logger.info('Fallback single embeddings generated successfully', {
        count: fallbackEmbeddings.length,
        avgDimensions: fallbackEmbeddings[0]?.dimensions,
        latencyMs,
      });

      return {
        embeddings,
        processingTimeMs: latencyMs,
      };
    } catch (fallbackError: any) {
      const endTime = Date.now();
      stats.errorCount++;
      updateSuccessRate(false);

      logger.error('Failed to generate batch embeddings', {
        error: error.message,
        fallbackError: fallbackError.message,
        count: texts.length,
        latencyMs: endTime - startTime,
      });

      throw error;
    }
  }
}

/**
 * Normalize embedding vector to unit length (L2 normalization)
 * Required for accurate cosine similarity with dimensions < 3072
 * 
 * @param values - The embedding vector to normalize
 * @returns Normalized vector with unit length
 */
export function normalizeEmbedding(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  
  if (norm === 0) {
    logger.warn('Attempted to normalize zero vector');
    return values;
  }

  return values.map(v => v / norm);
}

/**
 * Calculate cosine similarity between two embeddings
 * 
 * @param a - First embedding vector
 * @param b - Second embedding vector
 * @returns Similarity score between -1 and 1 (1 = most similar)
 * 
 * @example
 * const sim = cosineSimilarity(queryEmbedding.values, docEmbedding.values);
 * if (sim > 0.7) console.log('High similarity!');
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  
  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}

/**
 * Calculate dot product between two embeddings
 * Use this for normalized embeddings (faster than cosine similarity)
 * 
 * @param a - First embedding vector (should be normalized)
 * @param b - Second embedding vector (should be normalized)
 * @returns Dot product (equivalent to cosine similarity for normalized vectors)
 */
export function dotProduct(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result += a[i] * b[i];
  }

  return result;
}

/**
 * Calculate Euclidean distance between two embeddings
 * Lower distance = more similar
 * 
 * @param a - First embedding vector
 * @param b - Second embedding vector
 * @returns Euclidean distance (0 = identical)
 */
export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let sumSquaredDiff = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sumSquaredDiff += diff * diff;
  }

  return Math.sqrt(sumSquaredDiff);
}

/**
 * Find top-K most similar embeddings from a collection
 * 
 * @param queryEmbedding - The query embedding to match against
 * @param embeddings - Collection of embeddings to search
 * @param topK - Number of results to return
 * @param minScore - Minimum similarity threshold
 * @returns Sorted array of indices and scores
 */
export function findTopKSimilar(
  queryEmbedding: number[],
  embeddings: number[][],
  topK: number = 5,
  minScore: number = 0
): Array<{ index: number; score: number }> {
  const scores: Array<{ index: number; score: number }> = [];

  for (let i = 0; i < embeddings.length; i++) {
    const score = dotProduct(queryEmbedding, embeddings[i]);
    if (score >= minScore) {
      scores.push({ index: i, score });
    }
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  // Return top K
  return scores.slice(0, topK);
}

/**
 * Get current embedding service statistics
 */
export function getEmbeddingStats(): EmbeddingStats {
  return { ...stats };
}

/**
 * Reset embedding statistics
 */
export function resetEmbeddingStats(): void {
  stats = {
    totalEmbeddingsGenerated: 0,
    totalTokensUsed: 0,
    averageLatencyMs: 0,
    errorCount: 0,
    successRate: 100,
  };
}

/**
 * Update success rate calculation
 */
function updateSuccessRate(success: boolean): void {
  const totalAttempts = stats.totalEmbeddingsGenerated + stats.errorCount;
  if (totalAttempts > 0) {
    stats.successRate = (stats.totalEmbeddingsGenerated / totalAttempts) * 100;
  }
}

/**
 * Validate embedding dimensions
 */
export function isValidDimension(dim: number): dim is EmbeddingDimension {
  return [128, 256, 512, 768, 1536, 2048, 3072].includes(dim);
}

/**
 * Get recommended task type based on use case
 */
export function getRecommendedTaskType(useCase: 'query' | 'document' | 'classification' | 'clustering' | 'similarity'): EmbeddingTaskType {
  switch (useCase) {
    case 'query':
      return 'RETRIEVAL_QUERY';
    case 'document':
      return 'RETRIEVAL_DOCUMENT';
    case 'classification':
      return 'CLASSIFICATION';
    case 'clustering':
      return 'CLUSTERING';
    case 'similarity':
      return 'SEMANTIC_SIMILARITY';
    default:
      return 'RETRIEVAL_DOCUMENT';
  }
}
