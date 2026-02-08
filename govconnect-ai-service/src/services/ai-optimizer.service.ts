/**
 * AI Optimizer Service
 * 
 * Mengoptimalkan AI processing dengan:
 * 1. Fast Intent Classification - Skip LLM untuk intent yang jelas
 * 2. Response Caching - Cache response untuk pertanyaan berulang
 * 3. Entity Pre-extraction - Ekstrak data sebelum LLM
 * 4. Smart Routing - Route ke handler yang tepat
 * 
 * Service ini TIDAK mengubah logic yang sudah ada, hanya menambahkan
 * layer optimasi di atas unified-message-processor.
 */

import logger from '../utils/logger';
import { getCacheStats } from './response-cache.service';
import { extractAllEntities, mergeEntities, ExtractionResult } from './entity-extractor.service';
import { ProcessMessageInput, ProcessMessageResult } from './unified-message-processor.service';

// ==================== TYPES ====================

export interface OptimizationResult {
  shouldSkipLLM: boolean;
  fastIntent: null; // Deprecated: fast intent classification removed, all intent via Micro NLU
  cachedResponse?: { response: string; guidanceText?: string; intent: string };
  extractedEntities?: ExtractionResult;
  optimizationApplied: string[];
}

export interface OptimizedProcessResult extends ProcessMessageResult {
  optimization?: {
    skippedLLM: boolean;
    usedCache: boolean;
    fastClassified: boolean;
    entitiesExtracted: number;
    savedTimeMs?: number;
  };
}

// ==================== OPTIMIZATION FUNCTIONS ======================================

/**
 * Pre-process message and determine optimization strategy
 */
export function preProcessMessage(
  message: string,
  userId: string,
  conversationHistory?: string,
  templateContext?: { villageName?: string | null; villageShortName?: string | null }
): OptimizationResult {
  const optimizationApplied: string[] = [];
  // Full LLM mode: no fast intent/template/cache, only entity pre-extraction.
  const extractedEntities = extractAllEntities(message, conversationHistory);
  if (extractedEntities.extractedCount > 0) {
    optimizationApplied.push('entity_extraction');
    
    logger.debug('[AIOptimizer] Entities extracted', {
      userId,
      count: extractedEntities.extractedCount,
      entities: Object.keys(extractedEntities.entities),
    });
  }
  
  return {
    shouldSkipLLM: false,
    fastIntent: null,
    extractedEntities,
    optimizationApplied,
  };
}

// ==================== METRICS & MONITORING ======================================

/**
 * Get optimization statistics
 */
export function getOptimizationStats(): {
  cache: ReturnType<typeof getCacheStats>;
  summary: {
    description: string;
  };
} {
  const cacheStats = getCacheStats();
  
  return {
    cache: cacheStats,
    summary: {
      description: `Cache hit rate: ${(cacheStats.hitRate * 100).toFixed(1)}%, Size: ${cacheStats.cacheSize}`,
    },
  };
}

// ==================== INITIALIZATION ====================

/**
 * Initialize optimizer (call on service startup)
 */
export function initializeOptimizer(): void {
  logger.info('[AIOptimizer] Initializing...');

  logger.info('[AIOptimizer] Initialization complete');
}

// ==================== INTEGRATION HELPER ====================

/**
 * Enhance LLM fields with pre-extracted entities
 * Call this after LLM response to fill any gaps
 */
export function enhanceLLMFields(
  llmFields: Record<string, any>,
  extractedEntities: ExtractionResult
): Record<string, any> {
  return mergeEntities(llmFields, extractedEntities.entities);
}

export default {
  preProcessMessage,
  getOptimizationStats,
  initializeOptimizer,
  enhanceLLMFields,
};
