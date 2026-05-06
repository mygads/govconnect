/**
 * Embedding Service for GovConnect AI
 *
 * Semua request embedding sekarang wajib lewat AI gateway lane `EMBED`.
 * Service ini tetap menjaga:
 * - query embedding cache
 * - batch processing
 * - L2 normalization
 * - statistik internal
 */

import crypto from 'crypto';
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
import { callAIGatewayEmbeddings } from './ai-gateway.service';
import { getCurrentBillingContext } from './ai-turn-billing.service';
import { registerInterval } from '../utils/timer-registry';

const DEFAULT_MODEL = config.embeddingGateway.model;
const DEFAULT_DIMENSIONS: EmbeddingDimension = config.embeddingGateway.dimensions as EmbeddingDimension;
const MAX_BATCH_SIZE = 100;
const EMBEDDING_RETRY_COUNT = parseInt(process.env.EMBEDDING_RETRY_COUNT || '2', 10);
const EMBEDDING_RETRY_BASE_MS = parseInt(process.env.EMBEDDING_RETRY_BASE_MS || '750', 10);
const EMBEDDING_RETRY_MAX_MS = parseInt(process.env.EMBEDDING_RETRY_MAX_MS || '5000', 10);

interface CachedEmbedding {
  embedding: number[];
  timestamp: number;
  taskType: EmbeddingTaskType;
}

const embeddingCache = new Map<string, CachedEmbedding>();
const EMBEDDING_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_SIZE = 500;

let cacheStats = {
  hits: 0,
  misses: 0,
  evictions: 0,
};

let stats: EmbeddingStats = {
  totalEmbeddingsGenerated: 0,
  totalTokensUsed: 0,
  averageLatencyMs: 0,
  errorCount: 0,
  successRate: 100,
};

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

function normalizeForCache(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '');
}

function getCacheKey(text: string, taskType: EmbeddingTaskType): string {
  const normalized = normalizeForCache(text);
  return crypto.createHash('md5').update(`${taskType}:${normalized}`).digest('hex');
}

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

function evictOldestIfNeeded(): void {
  if (embeddingCache.size <= MAX_CACHE_SIZE) return;

  const entries = Array.from(embeddingCache.entries())
    .sort((a, b) => a[1].timestamp - b[1].timestamp);

  const toRemove = Math.floor(MAX_CACHE_SIZE * 0.2);
  for (let i = 0; i < toRemove && i < entries.length; i++) {
    embeddingCache.delete(entries[i][0]);
    cacheStats.evictions++;
  }

  logger.debug('Evicted oldest embedding cache entries', { evicted: toRemove });
}

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries: number = EMBEDDING_RETRY_COUNT,
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
        EMBEDDING_RETRY_MAX_MS,
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

function updateSuccessRate(): void {
  const totalAttempts = stats.totalEmbeddingsGenerated + stats.errorCount;
  if (totalAttempts > 0) {
    stats.successRate = (stats.totalEmbeddingsGenerated / totalAttempts) * 100;
  }
}

function resolveEmbeddingContext(context?: EmbeddingConfig['context']): EmbeddingConfig['context'] {
  const billingContext = getCurrentBillingContext();
  return {
    village_id: context?.village_id ?? billingContext?.village_id ?? null,
    wa_user_id: context?.wa_user_id ?? billingContext?.wa_user_id ?? null,
    session_id: context?.session_id ?? billingContext?.session_id ?? null,
    channel: context?.channel ?? billingContext?.channel ?? null,
    message_id: context?.message_id ?? billingContext?.message_id ?? null,
    trace_id: context?.trace_id ?? billingContext?.trace_id ?? null,
    billing_group_id: context?.billing_group_id ?? billingContext?.billing_group_id ?? null,
  };
}

function requiresEmbeddingBillingContext(taskType: EmbeddingTaskType): boolean {
  return taskType === 'RETRIEVAL_DOCUMENT';
}

function getEffectiveEmbeddingContext(
  taskType: EmbeddingTaskType,
  context?: EmbeddingConfig['context'],
): EmbeddingConfig['context'] {
  const resolved = resolveEmbeddingContext(context) ?? {};
  if (resolved.village_id || resolved.wa_user_id || resolved.session_id || resolved.channel || resolved.message_id || resolved.trace_id || resolved.billing_group_id) {
    return resolved;
  }
  return requiresEmbeddingBillingContext(taskType) ? resolved : (context ?? resolved);
}

function buildSingleEmbeddingFallbackOptions(
  options: EmbeddingConfig,
  taskType: EmbeddingTaskType,
  normalize: boolean,
  model: string,
  outputDimensionality: EmbeddingDimension,
): EmbeddingConfig {
  return {
    ...options,
    model,
    outputDimensionality,
    taskType,
    normalize,
    useCache: false,
    context: getEffectiveEmbeddingContext(taskType, options.context),
  };
}

function finalizeEmbeddingValues(
  values: number[],
  outputDimensionality: number,
  normalize: boolean,
): { values: number[]; normalized: boolean } {
  let nextValues = values;

  if (nextValues.length > outputDimensionality) {
    nextValues = nextValues.slice(0, outputDimensionality);
  }

  if (normalize && outputDimensionality < 3072) {
    nextValues = normalizeEmbedding(nextValues);
    return { values: nextValues, normalized: true };
  }

  return { values: nextValues, normalized: false };
}

async function requestGatewayEmbeddings(
  input: string | string[],
  model: string,
  outputDimensionality: number,
  layerCall: 'embedding_single' | 'embedding_batch',
  context?: EmbeddingConfig['context'],
): Promise<{ embeddings: number[][]; model: string; durationMs: number }> {
  if (!config.embeddingGateway.enabled) {
    throw new Error('EMBED lane is not configured');
  }

  const result = await withRetry(
    () =>
      callAIGatewayEmbeddings({
        input,
        model,
        dimensions: outputDimensionality,
        timeoutMs: config.embeddingGateway.timeoutMs,
        layerType: 'embedding',
        callType: layerCall,
        context,
      }),
    'embedding-gateway',
  );

  if (!result) {
    throw new Error('Embedding gateway returned null');
  }

  return {
    embeddings: result.embeddings,
    model: result.model,
    durationMs: result.metrics.durationMs,
  };
}

registerInterval(cleanupExpiredCache, 5 * 60 * 1000, 'embedding-cache-cleanup');

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

export function clearEmbeddingCache(): void {
  embeddingCache.clear();
  cacheStats = { hits: 0, misses: 0, evictions: 0 };
  logger.info('Embedding cache cleared');
}

export async function generateEmbedding(
  text: string,
  options: EmbeddingConfig = {},
): Promise<EmbeddingResult> {
  const {
    model = DEFAULT_MODEL,
    outputDimensionality = DEFAULT_DIMENSIONS,
    taskType = 'RETRIEVAL_DOCUMENT',
    normalize = true,
    useCache = true,
  } = options;

  const startTime = Date.now();

  if (isBlankText(text)) {
    logger.warn('generateEmbedding called with blank text; returning zero vector', {
      taskType,
      dimensions: outputDimensionality,
    });
    return makeZeroEmbedding(outputDimensionality, 'empty');
  }

  if (useCache && taskType === 'RETRIEVAL_QUERY') {
    const cacheKey = getCacheKey(text, taskType);
    const cached = embeddingCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < EMBEDDING_CACHE_TTL_MS) {
      cacheStats.hits++;
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
    const gatewayResult = await requestGatewayEmbeddings(text, model, outputDimensionality, 'embedding_single', getEffectiveEmbeddingContext(taskType, options.context));
    const rawValues = gatewayResult.embeddings[0];
    const finalized = finalizeEmbeddingValues(rawValues, outputDimensionality, normalize);

    stats.totalEmbeddingsGenerated++;
    stats.averageLatencyMs = (stats.averageLatencyMs * (stats.totalEmbeddingsGenerated - 1) + gatewayResult.durationMs) / stats.totalEmbeddingsGenerated;
    stats.lastEmbeddingAt = new Date();
    updateSuccessRate();

    if (useCache && taskType === 'RETRIEVAL_QUERY') {
      const cacheKey = getCacheKey(text, taskType);
      embeddingCache.set(cacheKey, {
        embedding: finalized.values,
        timestamp: Date.now(),
        taskType,
      });
      evictOldestIfNeeded();
    }

    return {
      values: finalized.values,
      dimensions: finalized.values.length,
      model: gatewayResult.model,
      normalized: finalized.normalized,
    };
  } catch (error: any) {
    stats.errorCount++;
    updateSuccessRate();

    logger.error('Failed to generate embedding', {
      error: error.message,
      textLength: text.length,
      latencyMs: Date.now() - startTime,
    });

    throw error;
  }
}

export async function generateBatchEmbeddings(
  texts: string[],
  options: EmbeddingConfig = {},
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

  if (nonBlankTexts.length > MAX_BATCH_SIZE) {
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
    const gatewayResult = await requestGatewayEmbeddings(nonBlankTexts, model, outputDimensionality, 'embedding_batch', getEffectiveEmbeddingContext(taskType, options.context));
    const nonBlankEmbeddings = gatewayResult.embeddings.map((values) => {
      const finalized = finalizeEmbeddingValues(values, outputDimensionality, normalize);
      return {
        values: finalized.values,
        dimensions: finalized.values.length,
        model: gatewayResult.model,
        normalized: finalized.normalized,
      };
    });

    const embeddings: EmbeddingResult[] = cleanedTexts.map(() => makeZeroEmbedding(outputDimensionality, 'empty'));
    for (let i = 0; i < nonBlankIndexes.length; i++) {
      const idx = nonBlankIndexes[i];
      if (nonBlankEmbeddings[i]) {
        embeddings[idx] = nonBlankEmbeddings[i];
      }
    }

    stats.totalEmbeddingsGenerated += nonBlankTexts.length;
    stats.averageLatencyMs = (stats.averageLatencyMs + gatewayResult.durationMs) / 2;
    stats.lastEmbeddingAt = new Date();
    updateSuccessRate();

    return {
      embeddings,
      processingTimeMs: gatewayResult.durationMs,
    };
  } catch (error: any) {
    logger.warn('Batch embedding failed, attempting single-request fallback', {
      error: error.message,
      count: nonBlankTexts.length,
    });

    try {
      const fallbackEmbeddings = await Promise.all(
        nonBlankTexts.map(text =>
          generateEmbedding(text, buildSingleEmbeddingFallbackOptions(options, taskType, normalize, model, outputDimensionality)),
        ),
      );

      const embeddings: EmbeddingResult[] = cleanedTexts.map(() => makeZeroEmbedding(outputDimensionality, 'empty'));
      for (let i = 0; i < nonBlankIndexes.length; i++) {
        const idx = nonBlankIndexes[i];
        if (fallbackEmbeddings[i]) {
          embeddings[idx] = fallbackEmbeddings[i];
        }
      }

      return {
        embeddings,
        processingTimeMs: Date.now() - startTime,
      };
    } catch (fallbackError: any) {
      stats.errorCount++;
      updateSuccessRate();

      logger.error('Failed to generate batch embeddings', {
        error: error.message,
        fallbackError: fallbackError.message,
        count: texts.length,
        latencyMs: Date.now() - startTime,
      });

      throw error;
    }
  }
}

export function normalizeEmbedding(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));

  if (norm === 0) {
    logger.warn('Attempted to normalize zero vector');
    return values;
  }

  return values.map(v => v / norm);
}

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
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

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

export function findTopKSimilar(
  queryEmbedding: number[],
  embeddings: number[][],
  topK: number = 5,
  minScore: number = 0,
): Array<{ index: number; score: number }> {
  const scores: Array<{ index: number; score: number }> = [];

  for (let i = 0; i < embeddings.length; i++) {
    const score = dotProduct(queryEmbedding, embeddings[i]);
    if (score >= minScore) {
      scores.push({ index: i, score });
    }
  }

  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, topK);
}

export function getEmbeddingStats(): EmbeddingStats {
  return { ...stats };
}

export function resetEmbeddingStats(): void {
  stats = {
    totalEmbeddingsGenerated: 0,
    totalTokensUsed: 0,
    averageLatencyMs: 0,
    errorCount: 0,
    successRate: 100,
  };
}

export function isValidDimension(dim: number): dim is EmbeddingDimension {
  return [128, 256, 512, 768, 1536, 2048, 3072].includes(dim);
}

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
