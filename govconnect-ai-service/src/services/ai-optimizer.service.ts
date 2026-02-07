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

// ==================== QUICK RESPONSES ====================

/**
 * Quick responses for simple intents that don't need LLM
 */
const QUICK_RESPONSES: Record<string, { response: string; guidance?: string }> = {
  'THANKS': {
    response: 'Sama-sama Kak! 😊 Senang bisa membantu. Kalau ada yang perlu dibantu lagi, langsung chat aja ya!',
  },
  'CONFIRMATION': {
    response: '', // Will be handled by pending state
  },
  'REJECTION': {
    response: 'Baik Kak, tidak masalah. Ada yang lain yang bisa saya bantu?',
  },
};

// ==================== OPTIMIZATION FUNCTIONS ====================

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

/**
 * Handle quick responses for simple intents
 */
export function getQuickResponse(
  intent: string,
  extractedFields: Record<string, any>
): { response: string; guidance?: string } | null {
  // Check for quick response
  const quickResponse = QUICK_RESPONSES[intent];
  if (quickResponse && quickResponse.response) {
    return quickResponse;
  }
  
  return null;
}

/**
 * Post-process and cache response if applicable
 */
export function postProcessResponse(
  originalMessage: string,
  response: string,
  intent: string,
  guidanceText?: string
): void {
  return;
}

// ==================== METRICS & MONITORING ====================

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

/**
 * Determine if we should use fast path (skip full LLM processing)
 */
export function shouldUseFastPath(
  optimization: OptimizationResult,
  hasPendingState: boolean
): boolean {
  return false;
}

/**
 * Build fast path response
 */
export function buildFastPathResponse(
  optimization: OptimizationResult,
  startTime: number
): OptimizedProcessResult | null {
  // Return cached response
  if (optimization.cachedResponse) {
    return {
      success: true,
      response: optimization.cachedResponse.response,
      guidanceText: optimization.cachedResponse.guidanceText,
      intent: optimization.cachedResponse.intent,
      metadata: {
        processingTimeMs: Date.now() - startTime,
        hasKnowledge: true,
      },
      optimization: {
        skippedLLM: true,
        usedCache: true,
        fastClassified: true,
        entitiesExtracted: optimization.extractedEntities?.extractedCount || 0,
        savedTimeMs: 500, // Estimated LLM time saved
      },
    };
  }
  
  // DEPRECATED: Fast intent classification removed - all intent via Micro NLU
  // The fastIntent property is always null now
  
  return null;
}

export default {
  preProcessMessage,
  getQuickResponse,
  postProcessResponse,
  getOptimizationStats,
  initializeOptimizer,
  enhanceLLMFields,
  shouldUseFastPath,
  buildFastPathResponse,
};
