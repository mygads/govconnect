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
import { fastClassifyIntent, FastClassifyResult, isSimpleConfirmation, isSimpleThanks } from './fast-intent-classifier.service';
import { getCachedResponse, setCachedResponse, getCacheStats, preWarmCache } from './response-cache.service';
import { extractAllEntities, mergeEntities, ExtractionResult } from './entity-extractor.service';
import { ProcessMessageInput, ProcessMessageResult } from './unified-message-processor.service';
import { matchTemplate, TemplateContext } from './response-templates.service';

// ==================== TYPES ====================

export interface OptimizationResult {
  shouldSkipLLM: boolean;
  fastIntent: FastClassifyResult | null;
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
  templateContext?: TemplateContext
): OptimizationResult {
  const optimizationApplied: string[] = [];
  let shouldSkipLLM = false;
  
  // 1. Fast Intent Classification
  const fastIntent = fastClassifyIntent(message);
  if (fastIntent) {
    optimizationApplied.push('fast_intent');
    
    if (fastIntent.skipLLM) {
      shouldSkipLLM = true;
      optimizationApplied.push('skip_llm');
    }
    
    logger.info('[AIOptimizer] Fast intent classified', {
      userId,
      intent: fastIntent.intent,
      confidence: fastIntent.confidence,
      skipLLM: fastIntent.skipLLM,
    });
  }
  
  // 2. Check Response Templates (pattern-based, no LLM needed)
  const templateMatch = matchTemplate(message, templateContext);
  if (templateMatch.matched && templateMatch.response) {
    optimizationApplied.push('template_match');
    shouldSkipLLM = true;
    
    logger.info('[AIOptimizer] Template matched', {
      userId,
      intent: templateMatch.intent,
      confidence: templateMatch.confidence,
    });
    
    return {
      shouldSkipLLM: true,
      fastIntent: fastIntent || {
        intent: templateMatch.intent || 'UNKNOWN',
        confidence: templateMatch.confidence,
        skipLLM: true,
        extractedFields: {},
        reason: 'Template matched',
      },
      cachedResponse: {
        response: templateMatch.response,
        intent: templateMatch.intent || 'UNKNOWN',
      },
      optimizationApplied,
    };
  }
  
  // 3. Check Response Cache (only for cacheable intents)
  if (fastIntent && ['KNOWLEDGE_QUERY', 'GREETING'].includes(fastIntent.intent)) {
    const cached = getCachedResponse(message, fastIntent.intent);
    if (cached) {
      optimizationApplied.push('cache_hit');
      shouldSkipLLM = true;
      
      logger.info('[AIOptimizer] Cache hit', {
        userId,
        intent: cached.intent,
      });
      
      return {
        shouldSkipLLM: true,
        fastIntent,
        cachedResponse: {
          response: cached.response,
          guidanceText: cached.guidanceText,
          intent: cached.intent,
        },
        optimizationApplied,
      };
    }
  }
  
  // 4. Entity Pre-extraction
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
    shouldSkipLLM,
    fastIntent,
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
  // Cache the response for future use
  setCachedResponse(originalMessage, response, intent, guidanceText);
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
  
  // Pre-warm cache with common responses
  preWarmCache();
  
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
  // Don't skip if there's pending state that needs handling
  if (hasPendingState) {
    return false;
  }
  
  // Use fast path if we have cached response
  if (optimization.cachedResponse) {
    return true;
  }
  
  // Use fast path for simple intents
  if (optimization.fastIntent?.skipLLM) {
    const quickResponse = getQuickResponse(
      optimization.fastIntent.intent,
      optimization.fastIntent.extractedFields
    );
    return quickResponse !== null;
  }
  
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
  
  // Return quick response for simple intents
  if (optimization.fastIntent?.skipLLM) {
    const quickResponse = getQuickResponse(
      optimization.fastIntent.intent,
      optimization.fastIntent.extractedFields
    );
    
    if (quickResponse) {
      return {
        success: true,
        response: quickResponse.response,
        guidanceText: quickResponse.guidance,
        intent: optimization.fastIntent.intent,
        metadata: {
          processingTimeMs: Date.now() - startTime,
          hasKnowledge: false,
        },
        optimization: {
          skippedLLM: true,
          usedCache: false,
          fastClassified: true,
          entitiesExtracted: optimization.extractedEntities?.extractedCount || 0,
          savedTimeMs: 500,
        },
      };
    }
  }
  
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
