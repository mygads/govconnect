/**
 * Unified Message Processor Service — ORCHESTRATOR
 *
 * SINGLE SOURCE OF TRUTH for message processing across all channels
 * (WhatsApp, Webchat, etc.).
 *
 * Decomposed into focused modules (Jan 2025):
 *   ump-types.ts         — shared interfaces (ProcessMessageInput/Result)
 *   ump-state.ts         — LRU caches, photo helpers, pending-state accessors
 *   ump-utils.ts         — name extraction, history, address, context builders
 *   complaint-handler.ts — complaint CRUD + address confirmation
 *   service-handler.ts   — service info / request / edit
 *   status-handler.ts    — status check (complaint & service request)
 *   agent/*              — single orchestrator agent + explicit tools
 *
 * This file retains only:
 *   • processUnifiedMessage (the main orchestrator)
 *   • barrel re-exports for backward compatibility
 */

import logger from '../utils/logger';
import { getWIBDateTime } from '../utils/wib-datetime';
import { sanitizeUserInput } from './context-builder.service';
import { getVillageProfileSummary } from './knowledge.service';
import { isSpamMessage } from './rag.service';
import { getAutoFillSuggestionsWithFallback } from './user-profile.service';
import { normalizeText } from './text-normalizer.service';
import { classifyMessage } from './micro-llm-matcher.service';
import type { UnifiedClassifyResult } from './micro-llm-matcher.service';
import { aiAnalyticsService } from './ai-analytics.service';
import { createProcessingTracker } from './processing-status.service';
import { getSmartFallback, getErrorFallback } from './fallback-response.service';
import { validateResponse } from './ump-formatters';
import type { ChannelType } from './ump-formatters';
import { getCachedResponse, setCachedResponse } from './response-cache.service';
import { buildHybridMemorySummary } from './hybrid-memory.service';

// ── Decomposed module imports ──
import type { ProcessMessageInput, ProcessMessageResult } from './ump-types';
import { incrementActiveProcessing, decrementActiveProcessing } from './ump-state';
import {
  fetchConversationHistoryFromChannel,
  appendToHistoryCache,
  buildAgentConversationContext,
} from './ump-utils';
import { handleComplaintCreation, handleComplaintUpdate, handleCancellationRequest, handleHistory } from './complaint-handler';
import { handleServiceInfo, handleServiceRequestCreation, handleServiceRequestEditLink } from './service-handler';
import { runAgent } from './agent';
import { handleStatusCheck } from './status-handler';
import {
  tryHandleLatePreAgentState,
  tryHandlePendingOffers,
  tryHandleProtocolGuards,
} from './pre-agent-state-router.service';

// ── Barrel re-exports (backward compatibility) ──
export type { ChannelType } from './ump-formatters';
export { validateResponse } from './ump-formatters';
export type { ProcessMessageInput, ProcessMessageResult } from './ump-types';
export {
  clearAllUMPCaches,
  clearUserCaches,
  getUMPCacheStats,
  getActiveProcessingCount,
  drainActiveProcessing,
  getPendingAddressConfirmation,
  clearPendingAddressConfirmation,
  setPendingAddressConfirmation,
  clearPendingCancelConfirmation,
  setPendingCancelConfirmation,
  getPendingServiceFormOffer,
  clearPendingServiceFormOffer,
  setPendingServiceFormOffer,
  getPendingAddressRequest,
  clearPendingAddressRequest,
  setPendingAddressRequest,
} from './ump-state';
export { isVagueAddress, resolveComplaintTypeConfig } from './ump-utils';
export { handleComplaintCreation, handleComplaintUpdate, handleCancellationRequest, handleHistory } from './complaint-handler';
export { handleServiceInfo, handleServiceRequestCreation, handleServiceRequestEditLink } from './service-handler';
export { handleStatusCheck } from './status-handler';

/**
 * Process message from any channel
 * This is the SINGLE SOURCE OF TRUTH for message processing
 * 
 * OPTIMIZATION FLOW:
 * 1. Spam check
 * 2. Pending state check
 * 3. Fast intent classification (NEW)
 * 4. Response cache check (NEW)
 * 5. Entity pre-extraction (NEW)
 * 6. If fast path available → return cached/quick response
 * 7. Otherwise → full LLM processing
 */

// ── Agent mode helpers ──

interface AgentProcessInput {
  userId: string;
  message: string;
  channel: 'whatsapp' | 'webchat';
  villageId?: string;
  conversationSummary?: string;
  recentConversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  memorySummary?: string;
  villageName?: string;
  userName?: string | null;
  traceId: string;
  startTime: number;
  tracker: ReturnType<typeof createProcessingTracker>;
  notifyStage: (stage: string, progress: number) => void;
}

const CACHEABLE_AGENT_TOOLS = new Set([
  'get_village_profile',
  'get_service_info',
  'get_complaint_categories',
  'get_emergency_contacts',
  'search_knowledge',
  'search_documents',
]);

function isCacheableAgentResult(result: ProcessMessageResult): boolean {
  const toolsUsed = Array.isArray(result.metadata?.toolsUsed) ? result.metadata.toolsUsed : [];
  if (toolsUsed.length === 0) {
    return false;
  }

  return toolsUsed.every((tool) => CACHEABLE_AGENT_TOOLS.has(tool));
}

function deriveAnalyticsIntent(result: ProcessMessageResult): string {
  if (result.intent && result.intent !== 'AGENT') {
    return result.intent;
  }

  const toolsUsed = Array.isArray(result.metadata?.toolsUsed) ? result.metadata.toolsUsed : [];

  if (toolsUsed.includes('create_complaint')) return 'CREATE_COMPLAINT';
  if (toolsUsed.includes('update_complaint')) return 'UPDATE_COMPLAINT';
  if (toolsUsed.includes('create_service_request')) return 'CREATE_SERVICE_REQUEST';
  if (toolsUsed.includes('get_service_request_edit_link')) return 'EDIT_SERVICE_REQUEST';
  if (toolsUsed.includes('check_status')) return 'CHECK_STATUS';
  if (toolsUsed.includes('cancel_request')) return 'CANCEL_REQUEST';
  if (toolsUsed.includes('get_my_history')) return 'HISTORY';
  if (toolsUsed.includes('search_documents')) return 'DOCUMENT_SEARCH';
  if (toolsUsed.includes('search_knowledge')) return 'KNOWLEDGE_QUERY';
  if (toolsUsed.includes('get_service_info')) return 'SERVICE_INFO';
  if (toolsUsed.includes('get_village_profile')) return 'VILLAGE_PROFILE';
  if (toolsUsed.includes('get_emergency_contacts')) return 'EMERGENCY_CONTACTS';
  if (toolsUsed.includes('search_user_memory')) return 'MEMORY_LOOKUP';

  return result.intent || 'DIRECT_RESPONSE';
}

function deriveAnalyticsSource(result: ProcessMessageResult): string {
  if (result.intent === 'SPAM') return 'spam_guard';
  if (result.intent === 'ERROR') return 'fallback_error';
  if (result.metadata.agentMode === 'response_cache') return 'response_cache';
  if (result.metadata.agentMode === 'single_orchestrator') return 'agent';
  if (result.metadata.agentMode === 'pre_agent_guard') return 'pre_agent_guard';
  return 'orchestrator';
}

async function processWithAgent(input: AgentProcessInput): Promise<ProcessMessageResult> {
  const {
    userId,
    message,
    channel,
    villageId,
    conversationSummary,
    recentConversationHistory,
    memorySummary,
    villageName,
    userName,
    traceId,
    startTime,
    tracker,
    notifyStage,
  } = input;

  tracker.thinking();
  notifyStage('thinking', 60);

  try {
    const result = await runAgent(
      message,
      {
        villageName: villageName ?? undefined,
        memorySummary,
        currentDatetime: String(getWIBDateTime()),
        userName,
      },
      {
        userId,
        villageId,
        channel,
      },
      {
        summary: conversationSummary,
        recentMessages: recentConversationHistory,
      },
    );

    tracker.complete();
    notifyStage('done', 100);

    logger.info('🤖 [Agent] Response generated', {
      traceId,
      userId,
      channel,
      mode: 'agent',
      toolsUsed: result.toolsUsed,
      iterations: result.iterations,
      totalTokens: result.totalTokens,
      model: result.model,
      durationMs: result.durationMs,
    });

    return {
      success: true,
      response: result.replyText,
      intent: 'AGENT',
      metadata: {
        processingTimeMs: Date.now() - startTime,
        model: result.model,
        hasKnowledge: result.toolsUsed.includes('search_knowledge') || result.toolsUsed.includes('search_documents'),
        agentMode: 'single_orchestrator',
        toolsUsed: result.toolsUsed,
        toolTrace: result.toolTrace,
        traceId,
      },
    };
  } catch (error: any) {
    logger.error('🤖 [Agent] Error', { traceId, userId, error: error.message });
    tracker.complete();

    return {
      success: true,
      response: 'Maaf, terjadi gangguan pada sistem. Silakan coba lagi nanti.',
      intent: 'AGENT_ERROR',
      metadata: {
        processingTimeMs: Date.now() - startTime,
        hasKnowledge: false,
        agentMode: 'single_orchestrator',
        traceId,
      },
      error: error.message,
    };
  }
}

export async function processUnifiedMessage(input: ProcessMessageInput): Promise<ProcessMessageResult> {
  incrementActiveProcessing();
  const startTime = Date.now();
  const { userId, message, channel, conversationHistory, mediaUrl, villageId, isEvaluation, onStageChange } = input;
  let resolvedHistory = conversationHistory;
  let finalResult: ProcessMessageResult | null = null;
  const finish = (result: ProcessMessageResult) => {
    finalResult = result;
    return result;
  };
  
  // Generate trace ID for correlating all logs in this request
  const traceId = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  
  const tracker = createProcessingTracker(userId);
  
  // Wire up onStageChange callback so the caller (e.g. WhatsApp orchestrator)
  // can react to processing stage transitions (e.g. start typing at 80%).
  const notifyStage = (stage: string, progress: number) => {
    if (onStageChange) {
      try { onStageChange(stage, progress); } catch (_) { /* non-critical */ }
    }
  };
  
  logger.info('🎯 [UnifiedProcessor] Processing message', {
    traceId,
    userId,
    channel,
    messageLength: message.length,
    hasHistory: !!conversationHistory,
    hasMedia: !!mediaUrl,
  });
  
  try {
    // Update status: reading message
    tracker.reading();
    notifyStage('reading', 20);
    
    // Step 0: Input length guard — reject absurdly long messages before any LLM work
    const MAX_INPUT_LENGTH = 4000; // ~1000 tokens, well above any realistic user message
    if (message.length > MAX_INPUT_LENGTH) {
      logger.warn('🚫 [UnifiedProcessor] Message too long, rejected', { traceId, userId, channel, length: message.length });
      return finish({
        success: true,
        response: 'Maaf, pesan Anda terlalu panjang. Mohon kirim pesan yang lebih singkat (maksimal beberapa paragraf).',
        intent: 'UNKNOWN',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
      });
    }

    // Step 1: Spam check
    if (isSpamMessage(message)) {
      logger.warn('🚫 [UnifiedProcessor] Spam detected', { userId, channel });
      return finish({
        success: false,
        response: '',
        intent: 'SPAM',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        error: 'Spam message detected',
      });
    }

    const resolvedVillageId = villageId;
    const agentChannel = channel === 'webchat' ? 'webchat' : 'whatsapp';

    // Cumulative timeout budget for micro-NLU classifiers (prevents worst-case stacking)
    const MICRO_NLU_BUDGET_MS = 8000;
    let microNluElapsedMs = 0;
    const hasMicroNluBudget = () => microNluElapsedMs < MICRO_NLU_BUDGET_MS;
    const withMicroNluBudget = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      if (!hasMicroNluBudget()) {
        logger.warn('[UnifiedProcessor] Micro-NLU budget exhausted, skipping classifier', {
          elapsed: microNluElapsedMs, budget: MICRO_NLU_BUDGET_MS,
        });
        return fallback;
      }
      const t0 = Date.now();
      try {
        const remaining = MICRO_NLU_BUDGET_MS - microNluElapsedMs;
        return await Promise.race([
          fn(),
          new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Micro-NLU budget timeout')), remaining)),
        ]);
      } finally {
        microNluElapsedMs += Date.now() - t0;
      }
    };

    // Classify greeting once via micro NLU and cache the result for multiple usage points
    // Uses unified classifier that returns message_type + rag_needed + categories in ONE call
    let unifiedClassifyResult: UnifiedClassifyResult | null = null;
    let unifiedClassified = false;
    const getUnifiedClassification = async (): Promise<UnifiedClassifyResult | null> => {
      if (!unifiedClassified) {
        unifiedClassified = true;
        try {
          unifiedClassifyResult = await withMicroNluBudget(
            () => classifyMessage(message.trim(), {
              village_id: resolvedVillageId,
              wa_user_id: userId,
              session_id: userId,
              channel,
            }),
            null
          );
        } catch (error: any) {
          logger.warn('[UnifiedProcessor] Unified NLU classify failed', { error: error.message });
          unifiedClassifyResult = null;
        }
      }
      return unifiedClassifyResult;
    };

    if (channel === 'whatsapp' && (!resolvedHistory || resolvedHistory.length === 0)) {
      resolvedHistory = await fetchConversationHistoryFromChannel(userId, resolvedVillageId);
      // Append current user message to cache so subsequent calls see it
      appendToHistoryCache(userId, 'user', message);
      logger.info('📚 [UnifiedProcessor] Loaded WhatsApp history', {
        userId,
        historyCount: resolvedHistory?.length || 0,
      });
    }

    const protocolGuardResult = tryHandleProtocolGuards({
      userId,
      mediaType: input.mediaType,
      traceId,
      startTime,
    });
    if (protocolGuardResult) {
      tracker.complete();
      return finish(protocolGuardResult);
    }

    const pendingOfferResult = await tryHandlePendingOffers({
      userId,
      message,
      channel: agentChannel,
      villageId: resolvedVillageId,
      traceId,
      startTime,
      runWithMicroBudget: withMicroNluBudget,
    });
    if (pendingOfferResult) {
      return finish(pendingOfferResult);
    }

    const latePreAgentResult = await tryHandleLatePreAgentState({
      userId,
      message,
      channel: agentChannel,
      villageId: resolvedVillageId,
      traceId,
      startTime,
      mediaUrl,
      getUnifiedClassification,
      runWithMicroBudget: withMicroNluBudget,
      tracker,
      notifyStage,
    });
    if (latePreAgentResult) {
      return finish(latePreAgentResult);
    }

    // Step 2.5: AI Optimization - Pre-process message
    const conversationContext = resolvedHistory?.length
      ? await buildAgentConversationContext(userId, resolvedHistory)
      : { summary: undefined, recentMessages: [] as Array<{ role: 'user' | 'assistant'; content: string }> };
    let templateContext: { villageName?: string | null; villageShortName?: string | null } | undefined;

    // Step 3: Sanitize and correct typos
    let sanitizedMessage = sanitizeUserInput(message);
    sanitizedMessage = normalizeText(sanitizedMessage);

    const [savedProfile, memorySummary] = await Promise.all([
      getAutoFillSuggestionsWithFallback(userId),
      buildHybridMemorySummary({
        wa_user_id: userId,
        query: sanitizedMessage,
        village_id: resolvedVillageId,
      }),
    ]);

    if (resolvedVillageId) {
      const profile = await getVillageProfileSummary(resolvedVillageId);
      if (profile?.name) {
        templateContext = {
          villageName: profile.name,
          villageShortName: profile.short_name || null,
        };
      }
    }

    const cachedKnowledge = !isEvaluation
      ? getCachedResponse(sanitizedMessage, 'KNOWLEDGE_QUERY', resolvedVillageId)
      : null;
    if (cachedKnowledge) {
      tracker.complete();
      notifyStage('done', 100);

      return finish({
        success: true,
        response: cachedKnowledge.response,
        guidanceText: cachedKnowledge.guidanceText,
        intent: 'KNOWLEDGE_QUERY',
        metadata: {
          processingTimeMs: Date.now() - startTime,
          hasKnowledge: true,
          agentMode: 'response_cache',
          toolsUsed: [],
          traceId,
        },
      });
    }

    // ── Agent Mode (always active) ──
    // Spam guard and pending-state guards stay outside the agent, but
    // deterministic question answering now goes through the same tool-calling agent.
    const agentResult = await processWithAgent({
      userId,
      message: sanitizedMessage,
      channel: channel as 'whatsapp' | 'webchat',
      villageId: resolvedVillageId,
      conversationSummary: conversationContext.summary,
      recentConversationHistory: conversationContext.recentMessages,
      memorySummary,
      villageName: templateContext?.villageName ?? undefined,
      userName: savedProfile.nama_lengkap ?? null,
      traceId,
      startTime,
      tracker,
      notifyStage,
    });

    if (!isEvaluation && agentResult.success && isCacheableAgentResult(agentResult)) {
      setCachedResponse(
        sanitizedMessage,
        agentResult.response,
        'KNOWLEDGE_QUERY',
        agentResult.guidanceText,
        resolvedVillageId,
      );
    }

    return finish(agentResult);
    
  } catch (error: any) {
    const processingTimeMs = Date.now() - startTime;
    
    // Update status: error
    tracker.error(error.message);
    
    logger.error('❌ [UnifiedProcessor] Processing failed', {
      traceId,
      userId,
      channel,
      error: error.message,
      processingTimeMs,
    });
    
    // Use smart fallback based on context
    
    // Determine error type for better fallback
    let errorType: string | undefined;
    if (error.message?.includes('timeout') || error.message?.includes('ETIMEDOUT')) {
      errorType = 'TIMEOUT';
    } else if (error.message?.includes('rate limit') || error.message?.includes('429')) {
      errorType = 'RATE_LIMIT';
    } else if (error.message?.includes('ECONNREFUSED') || error.message?.includes('503')) {
      errorType = 'SERVICE_DOWN';
    }
    
    // Get smart fallback - tries to continue conversation flow if possible
    const fallbackResponse = errorType 
      ? getErrorFallback(errorType)
      : getSmartFallback(userId, undefined, message);
    
    return finish({
      success: false,
      response: fallbackResponse,
      intent: 'ERROR',
      metadata: { processingTimeMs, hasKnowledge: false, traceId },
      error: error.message,
    });
  } finally {
    if (!isEvaluation && finalResult && finalResult.intent !== 'SPAM') {
      await aiAnalyticsService.recordInteractionEvent({
        waUserId: userId,
        villageId,
        channel,
        intent: deriveAnalyticsIntent(finalResult),
        success: finalResult.success,
        hasKnowledge: finalResult.metadata.hasKnowledge,
        isFallback: finalResult.intent === 'ERROR',
        agentMode: finalResult.metadata.agentMode,
        responseSource: deriveAnalyticsSource(finalResult),
        toolsUsed: finalResult.metadata.toolsUsed,
        model: finalResult.metadata.model,
        processingTimeMs: finalResult.metadata.processingTimeMs,
      });
    }
    decrementActiveProcessing();
  }
}

export default {
  processUnifiedMessage,
  handleComplaintCreation,
  handleComplaintUpdate,
  handleServiceInfo,
  handleServiceRequestCreation,
  handleStatusCheck,
  handleCancellationRequest,
  handleHistory,
  validateResponse,
};
