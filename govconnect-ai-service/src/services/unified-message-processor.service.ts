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
import axios from 'axios';
import { config } from '../config/env';
import { buildContext, buildKnowledgeQueryContext, sanitizeUserInput } from './context-builder.service';
import type { PromptFocus } from '../prompts/system-prompt';
import * as systemPromptModule from '../prompts/system-prompt';
import { callLLM } from './llm.service';
import {
  createComplaint,
  cancelComplaint,
  cancelServiceRequest,
  getComplaintTypes,
  getUserHistory,
  updateComplaintByUser,
  getServiceRequestStatusWithOwnership,
  requestServiceRequestEditToken,
  getServiceRequirements,
  getComplaintStatusWithOwnership,
  ServiceRequirementDefinition,
  HistoryItem,
} from './case-client.service';
import { getImportantContacts } from './important-contacts.service';
import { searchKnowledge, searchKnowledgeKeywordsOnly, getRAGContext, getKelurahanInfoContext, getVillageProfileSummary, reportKnowledgeGap } from './knowledge.service';
import { shouldRetrieveContext, isSpamMessage } from './rag.service';
import { detectLanguage, getLanguageContext } from './language-detection.service';
import { analyzeSentiment, analyzeSentimentWithLLM, getSentimentContext, needsHumanEscalation } from './sentiment-analysis.service';
import { rateLimiterService } from './rate-limiter.service';
import { aiAnalyticsService } from './ai-analytics.service';
import { recordTokenUsage } from './token-usage.service';
import { RAGContext } from '../types/embedding.types';
import { learnFromMessage, recordInteraction, saveDefaultAddress, getProfileContext, recordServiceUsage, updateProfile, getProfile, clearProfile, deleteProfile } from './user-profile.service';
import { updateConversationUserProfile } from './channel-client.service';
import { getEnhancedContext, updateContext, recordDataCollected, recordCompletedAction, getContextForLLM } from './conversation-context.service';
import { adaptResponse, buildAdaptationContext } from './response-adapter.service';
import { normalizeText } from './text-normalizer.service';
import { classifyConfirmation } from './confirmation-classifier.service';
import {
  appendAntiHallucinationInstruction,
  hasKnowledgeInPrompt,
  logAntiHallucinationEvent,
  needsAntiHallucinationRetry,
  sanitizeFakeLinks,
} from './anti-hallucination.service';
import { matchServiceSlug, matchComplaintType, classifyMessage, extractNameViaNLU, classifyUpdateIntent, validateResponseAgainstKnowledge } from './micro-llm-matcher.service';
import type { UnifiedClassifyResult } from './micro-llm-matcher.service';
import { createProcessingTracker } from './processing-status.service';
import { getSmartFallback, getErrorFallback } from './fallback-response.service';
import { getCachedResponse, setCachedResponse, isCacheable } from './response-cache.service';
import { resolveDeterministicFactReply } from './deterministic-fact-router.service';
import {
  ChannelType,
  normalizeHandlerResult,
  COMPLAINT_STATUS_MAP,
  SERVICE_STATUS_MAP,
  validateResponse,
  formatClickableLink,
  formatClickablePhone,
  buildImportantContactsMessage,
  maskSensitiveId,
  toSafeDate,
  formatDateTimeId,
  formatRelativeTime,
  formatKategori,
  getStatusInfo,
  buildAdminNoteSection,
  buildNaturalStatusResponse,
  buildNaturalServiceStatusResponse,
  buildComplaintDetailResponse,
  buildServiceRequestDetailResponse,
  buildCancelSuccessResponse,
  buildCancelErrorResponse,
  buildHistoryResponse,
  getStatusLabel,
  extractDateFromText,
  extractTimeFromText,
  normalizeTo628,
  isValidCitizenWaNumber,
  getPublicFormBaseUrl,
  buildPublicServiceFormUrl,
  buildEditServiceFormUrl,
  buildChannelParams,
} from './ump-formatters';
import type { HandlerResult } from './ump-formatters';

// ── Decomposed module imports ──
import type { ProcessMessageInput, ProcessMessageResult } from './ump-types';
import {
  syncNameToChannelService,
  incrementActiveProcessing,
  decrementActiveProcessing,
} from './ump-state';
import {
  fetchConversationHistoryFromChannel,
  appendToHistoryCache,
} from './ump-utils';
import { buildComplaintCategoriesText, handleComplaintCreation, handleComplaintUpdate, handleCancellationRequest, handleHistory } from './complaint-handler';
import { resolveServiceSlugFromSearch, handleServiceInfo, handleServiceRequestCreation, handleServiceRequestEditLink, buildServiceCatalogText } from './service-handler';
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
 * Unwrap a HandlerResult (string or { replyText, guidanceText?, contacts? })
 * into separate fields for ProcessMessageResult.
 */
function unwrapHandler(result: HandlerResult): { response: string; guidanceText?: string; contacts?: ProcessMessageResult['contacts'] } {
  const n = normalizeHandlerResult(result);
  return { response: n.replyText, guidanceText: n.guidanceText, contacts: n.contacts };
}

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
  conversationHistory: string;
  villageName?: string;
  traceId: string;
  startTime: number;
  tracker: ReturnType<typeof createProcessingTracker>;
  notifyStage: (stage: string, progress: number) => void;
}

async function processWithAgent(input: AgentProcessInput): Promise<ProcessMessageResult> {
  const { userId, message, channel, villageId, conversationHistory, villageName, traceId, startTime, tracker, notifyStage } = input;

  tracker.thinking();
  notifyStage('thinking', 60);

  try {
    const result = await runAgent(
      message,
      {
        villageName: villageName ?? undefined,
        conversationHistory,
        currentDatetime: String(getWIBDateTime()),
        userMessage: message,
      },
      {
        userId,
        villageId,
        channel,
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
      decrementActiveProcessing();
      return {
        success: true,
        response: 'Maaf, pesan Anda terlalu panjang. Mohon kirim pesan yang lebih singkat (maksimal beberapa paragraf).',
        intent: 'UNKNOWN',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
      };
    }

    // Step 1: Spam check
    if (isSpamMessage(message)) {
      logger.warn('🚫 [UnifiedProcessor] Spam detected', { userId, channel });
      return {
        success: false,
        response: '',
        intent: 'SPAM',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        error: 'Spam message detected',
      };
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
      return protocolGuardResult;
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
      return pendingOfferResult;
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
      return latePreAgentResult;
    }

    // Step 2.5: AI Optimization - Pre-process message
    const historyString = resolvedHistory?.map(m => `${m.role}: ${m.content}`).join('\n') || '';
    let templateContext: { villageName?: string | null; villageShortName?: string | null } | undefined;

    if (resolvedVillageId) {
      const profile = await getVillageProfileSummary(resolvedVillageId);
      if (profile?.name) {
        templateContext = {
          villageName: profile.name,
          villageShortName: profile.short_name || null,
        };
      }
    }
    
    // Step 3: Sanitize and correct typos
    let sanitizedMessage = sanitizeUserInput(message);
    sanitizedMessage = normalizeText(sanitizedMessage);

    const deterministicFactReply = await resolveDeterministicFactReply({
      userId,
      villageId: resolvedVillageId,
      message: sanitizedMessage,
      channel,
    });
    if (deterministicFactReply) {
      logger.info('⚡ [UnifiedProcessor] Deterministic fact fast path hit', {
        traceId,
        userId,
        channel,
        source: deterministicFactReply.source,
      });
      tracker.complete();
      notifyStage('done', 100);
      return {
        success: true,
        response: deterministicFactReply.response,
        intent: deterministicFactReply.intent,
        metadata: {
          processingTimeMs: Date.now() - startTime,
          hasKnowledge: deterministicFactReply.source === 'service_catalog' || deterministicFactReply.source === 'service_requirements',
          agentMode: 'deterministic_fact_router',
          traceId,
        },
      };
    }

    // ── Agent Mode (always active) ──
    // Single function-calling agent loop replaces the old intent pipeline.
    const agentResult = await processWithAgent({
      userId,
      message: sanitizedMessage,
      channel: channel as 'whatsapp' | 'webchat',
      villageId: resolvedVillageId,
      conversationHistory: historyString,
      villageName: templateContext?.villageName ?? undefined,
      traceId,
      startTime,
      tracker,
      notifyStage,
    });
    return agentResult;
    
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
    
    return {
      success: false,
      response: fallbackResponse,
      intent: 'ERROR',
      metadata: { processingTimeMs, hasKnowledge: false, traceId },
      error: error.message,
    };
  } finally {
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
