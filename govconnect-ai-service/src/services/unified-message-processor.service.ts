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
import { recordGuardrailEvent } from './runtime-observability.service';
import { recordToolPolicyEvent } from './agent/tool-policy.service';
import {
  analyzeSentimentWithLLM,
  getSentimentContext,
  needsHumanEscalation,
} from './sentiment-analysis.service';
import { startTakeoverForUser } from './channel-client.service';
import { getEnhancedContext } from './conversation-context.service';

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
  isEvaluation?: boolean;
  villageId?: string;
  conversationSummary?: string;
  recentConversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  memorySummary?: string;
  villageName?: string;
  userName?: string | null;
  sentimentContext?: string;
  traceId: string;
  startTime: number;
  tracker: ReturnType<typeof createProcessingTracker>;
  notifyStage: (stage: string, progress: number) => void;
}

const CACHEABLE_AGENT_TOOLS = new Set([
  'get_village_profile',
  'get_complaint_categories',
  'get_emergency_contacts',
  'search_knowledge',
  'search_documents',
]);

function isCacheableAgentResult(result: ProcessMessageResult): boolean {
  if (result.intent === 'TAKEOVER' || result.metadata.handoff?.started) {
    return false;
  }

  const toolsUsed = Array.isArray(result.metadata?.toolsUsed) ? result.metadata.toolsUsed : [];
  if (toolsUsed.length === 0) {
    return false;
  }

  return toolsUsed.every((tool) => CACHEABLE_AGENT_TOOLS.has(tool));
}

function normalizeAssistantText(text?: string): string | undefined {
  if (!text) return text;

  return text
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, '-')
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replace(/^\s*berdasarkan\s+(informasi|data)(\s+yang\s+(tersedia|kami miliki))?(\s+dari\s+(sumber\s+resmi\s+desa|sistem|data\s+resmi))?,?\s*/i, '')
    .replace(/^\s*menurut\s+(informasi|data)(\s+yang\s+tersedia)?,?\s*/i, '')
    .replace(/^\s*secara\s+singkat:\s*/i, '')
    .trim();
}

function splitFollowUpGuidance(response: string, guidanceText?: string): { response: string; guidanceText?: string } {
  if (!response || guidanceText) {
    return { response, guidanceText };
  }

  const shouldSplitLine = (value: string): boolean => [
    /^ada yang (bisa|ingin) saya bantu lagi\??$/i,
    /^kalau (mau|ingin|perlu)\b/i,
    /^apakah .*bantu/i,
  ].some((pattern) => pattern.test(value));

  const parts = response
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    const candidate = parts[parts.length - 1];
    if (shouldSplitLine(candidate)) {
      const mainResponse = parts.slice(0, -1).join('\n\n').trim();
      if (mainResponse) {
        return {
          response: mainResponse,
          guidanceText: candidate,
        };
      }
    }
  }

  const lines = response
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return { response, guidanceText };
  }

  const candidateLine = lines[lines.length - 1];
  if (!shouldSplitLine(candidateLine)) {
    return { response, guidanceText };
  }

  const splitMarker = response.lastIndexOf(candidateLine);
  if (splitMarker <= 0) {
    return { response, guidanceText };
  }

  const mainResponse = response.slice(0, splitMarker).trim();
  if (!mainResponse) {
    return { response, guidanceText };
  }

  return {
    response: mainResponse,
    guidanceText: candidateLine,
  };
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
  if (result.intent === 'TAKEOVER') return 'human_handoff';
  if (result.metadata.agentMode === 'response_cache') return 'response_cache';
  if (result.metadata.agentMode === 'single_orchestrator') return 'agent';
  if (result.metadata.agentMode === 'pre_agent_guard') return 'pre_agent_guard';
  return 'orchestrator';
}

function isExplicitHumanHandoffRequest(message: string): boolean {
  const text = (message || '').toLowerCase();
  if (!text) return false;

  return [
    /cs\s+manusia/,
    /petugas\s+(asli|manusia|desa)/,
    /admin\s+(asli|manusia)/,
    /operator/,
    /minta\s+(dibantu|disambungkan|dialihkan).*(petugas|admin|manusia)/,
    /hubungkan?\s+saya.*(petugas|admin|manusia)/,
    /saya\s+mau\s+orang/,
    /tidak\s+membantu/,
    /ga?k\s+membantu/,
    /jelek/,
    /komplain\s+cs/,
  ].some((pattern) => pattern.test(text));
}

function buildHumanHandoffReply(reason: string): string {
  if (reason === 'user_requested_human_agent') {
    return 'Baik, percakapan ini kami teruskan ke petugas agar dibantu lebih lanjut. Mohon tunggu sebentar ya.';
  }

  return 'Baik, supaya penanganannya lebih pas, percakapan ini kami teruskan ke petugas dulu ya. Mohon tunggu sebentar.';
}

async function maybeTriggerHumanHandoff(input: {
  userId: string;
  channel: 'whatsapp' | 'webchat';
  villageId?: string;
  message: string;
  result: ProcessMessageResult;
  sentiment: Awaited<ReturnType<typeof analyzeSentimentWithLLM>>;
  isEvaluation?: boolean;
}): Promise<{ started: boolean; reason?: string; response?: string }> {
  if (input.isEvaluation) {
    return { started: false };
  }

  let handoffReason: string | undefined;

  if (isExplicitHumanHandoffRequest(input.message)) {
    handoffReason = 'user_requested_human_agent';
  } else {
    const ctx = getEnhancedContext(input.userId);
    if (input.result.intent === 'AGENT_ERROR') {
      handoffReason = 'agent_error';
    } else if (input.sentiment.isEscalationCandidate || needsHumanEscalation(input.userId)) {
      handoffReason = 'negative_sentiment_escalation';
    } else if (ctx.needsHumanHelp) {
      handoffReason = 'conversation_stuck';
    }
  }

  if (!handoffReason) {
    return { started: false };
  }

  const started = await startTakeoverForUser(input.userId, {
    village_id: input.villageId,
    channel: input.channel === 'webchat' ? 'WEBCHAT' : 'WHATSAPP',
    admin_id: 'system-auto-handoff',
    admin_name: 'Petugas Desa',
    reason: handoffReason,
  });

  return {
    started,
    reason: handoffReason,
    response: started ? buildHumanHandoffReply(handoffReason) : undefined,
  };
}

async function processWithAgent(input: AgentProcessInput): Promise<ProcessMessageResult> {
  const {
    userId,
    message,
    channel,
    isEvaluation,
    villageId,
    conversationSummary,
    recentConversationHistory,
    memorySummary,
    villageName,
    userName,
    sentimentContext,
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
        sentimentContext,
      },
      {
        userId,
        villageId,
        channel,
        isEvaluation: input.isEvaluation,
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

    const derivedIntent = (() => {
      if (result.toolsUsed.includes('create_complaint')) return 'CREATE_COMPLAINT';
      if (result.toolsUsed.includes('update_complaint')) return 'UPDATE_COMPLAINT';
      if (result.toolsUsed.includes('create_service_request')) return 'CREATE_SERVICE_REQUEST';
      if (result.toolsUsed.includes('get_service_request_edit_link')) return 'EDIT_SERVICE_REQUEST';
      if (result.toolsUsed.includes('check_status')) return 'CHECK_STATUS';
      if (result.toolsUsed.includes('cancel_request')) return 'CANCEL_REQUEST';
      if (result.toolsUsed.includes('get_my_history')) return 'HISTORY';
      if (result.toolsUsed.includes('search_documents')) return 'DOCUMENT_SEARCH';
      if (result.toolsUsed.includes('search_knowledge')) return 'KNOWLEDGE_QUERY';
      if (result.toolsUsed.includes('get_service_info')) return 'SERVICE_INFO';
      if (result.toolsUsed.includes('get_village_profile')) return 'KNOWLEDGE_QUERY';
      if (result.toolsUsed.includes('get_emergency_contacts')) return 'EMERGENCY_CONTACTS';
      if (result.toolsUsed.includes('search_user_memory')) return 'MEMORY_LOOKUP';
      return 'AGENT';
    })();

    return {
      success: true,
      response: result.replyText,
      guidanceText: result.guidanceText,
      intent: derivedIntent,
      metadata: {
        processingTimeMs: Date.now() - startTime,
        model: result.model,
        hasKnowledge: result.toolsUsed.includes('search_knowledge') || result.toolsUsed.includes('search_documents'),
        agentMode: 'single_orchestrator',
        toolsUsed: result.toolsUsed,
        allowedTools: result.allowedToolNames,
        heuristicTools: result.heuristicTools,
        learnedTools: result.learnedTools,
        toolPolicy: {
          policyKey: result.matchedPolicyKey,
          policySource: result.matchedPolicySource,
          confidence: result.matchedPolicyConfidence,
        },
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
    const normalizedResponse = normalizeAssistantText(result.response) || result.response;
    result.response = validateResponse(normalizedResponse);

    if (result.guidanceText) {
      const normalizedGuidance = normalizeAssistantText(result.guidanceText) || result.guidanceText;
      result.guidanceText = validateResponse(normalizedGuidance);
    }

    const split = splitFollowUpGuidance(result.response, result.guidanceText);
    result.response = split.response;
    result.guidanceText = split.guidanceText;
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
      await recordGuardrailEvent({
        traceId,
        waUserId: userId,
        villageId,
        channel,
        guardStage: 'unified_processor',
        guardType: 'input_length',
        action: 'blocked',
        reason: 'message_too_long',
        messagePreview: message,
        metadata: {
          length: message.length,
          maxLength: MAX_INPUT_LENGTH,
        },
      });
      return finish({
        success: true,
        response: 'Maaf, pesan Anda terlalu panjang. Mohon kirim pesan yang lebih singkat (maksimal beberapa paragraf).',
        intent: 'UNKNOWN',
        metadata: {
          processingTimeMs: Date.now() - startTime,
          hasKnowledge: false,
          traceId,
          guardrail: {
            stage: 'unified_processor',
            type: 'input_length',
            action: 'blocked',
            reason: 'message_too_long',
          },
        },
      });
    }

    // Step 1: Spam check
    if (isSpamMessage(message)) {
      logger.warn('🚫 [UnifiedProcessor] Spam detected', { userId, channel });
      await recordGuardrailEvent({
        traceId,
        waUserId: userId,
        villageId,
        channel,
        guardStage: 'unified_processor',
        guardType: 'spam_content',
        action: 'blocked',
        reason: 'content_spam_pattern',
        messagePreview: message,
      });
      return finish({
        success: false,
        response: '',
        intent: 'SPAM',
        metadata: {
          processingTimeMs: Date.now() - startTime,
          hasKnowledge: false,
          traceId,
          guardrail: {
            stage: 'unified_processor',
            type: 'spam_content',
            action: 'blocked',
            reason: 'content_spam_pattern',
          },
        },
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
      await recordGuardrailEvent({
        traceId,
        waUserId: userId,
        villageId: resolvedVillageId,
        channel,
        guardStage: 'protocol_guard',
        guardType: 'unsupported_media',
        action: 'handled',
        reason: input.mediaType,
        messagePreview: message,
      });
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
      await recordGuardrailEvent({
        traceId,
        waUserId: userId,
        villageId: resolvedVillageId,
        channel,
        guardStage: 'pre_agent_pending_offer',
        guardType: 'pending_offer',
        action: 'handled',
        reason: pendingOfferResult.intent,
        messagePreview: message,
      });
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
      await recordGuardrailEvent({
        traceId,
        waUserId: userId,
        villageId: resolvedVillageId,
        channel,
        guardStage: 'pre_agent_state',
        guardType: 'pending_state',
        action: 'handled',
        reason: latePreAgentResult.intent,
        messagePreview: message,
      });
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

    const [savedProfile, memorySummary, sentiment] = await Promise.all([
      getAutoFillSuggestionsWithFallback(userId),
      buildHybridMemorySummary({
        wa_user_id: userId,
        query: sanitizedMessage,
        village_id: resolvedVillageId,
        trace_id: traceId,
        channel: agentChannel,
        skip_observability: !!isEvaluation,
      }),
      analyzeSentimentWithLLM(sanitizedMessage, userId, {
        village_id: resolvedVillageId,
        wa_user_id: channel === 'whatsapp' ? userId : undefined,
        session_id: channel === 'webchat' ? userId : undefined,
        channel,
      }),
    ]);
    const sentimentContext = getSentimentContext(sentiment);

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
    let agentResult = await processWithAgent({
      userId,
      message: sanitizedMessage,
      channel: channel as 'whatsapp' | 'webchat',
      isEvaluation,
      villageId: resolvedVillageId,
      conversationSummary: conversationContext.summary,
      recentConversationHistory: conversationContext.recentMessages,
      memorySummary,
      villageName: templateContext?.villageName ?? undefined,
      userName: savedProfile.nama_lengkap ?? null,
      sentimentContext,
      traceId,
      startTime,
      tracker,
      notifyStage,
    });

    agentResult.metadata.sentiment = sentiment.level;

    const handoff = await maybeTriggerHumanHandoff({
      userId,
      channel: agentChannel,
      villageId: resolvedVillageId,
      message: sanitizedMessage,
      result: agentResult,
      sentiment,
      isEvaluation,
    });

    if (handoff.started && handoff.response) {
      agentResult = {
        ...agentResult,
        response: handoff.response,
        guidanceText: undefined,
        intent: 'TAKEOVER',
        metadata: {
          ...agentResult.metadata,
          handoff: {
            started: true,
            reason: handoff.reason,
          },
        },
      };
    }

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
    const analyticsResult = finalResult as ProcessMessageResult | null;
    if (!isEvaluation && analyticsResult && analyticsResult.intent !== 'SPAM') {
      await aiAnalyticsService.recordInteractionEvent({
        waUserId: userId,
        villageId,
        channel,
        intent: deriveAnalyticsIntent(analyticsResult),
        success: analyticsResult.success,
        hasKnowledge: analyticsResult.metadata.hasKnowledge,
        isFallback: analyticsResult.intent === 'ERROR',
        agentMode: analyticsResult.metadata.agentMode,
        responseSource: deriveAnalyticsSource(analyticsResult),
        toolsUsed: analyticsResult.metadata.toolsUsed,
        model: analyticsResult.metadata.model,
        processingTimeMs: analyticsResult.metadata.processingTimeMs,
      });

      if (analyticsResult.metadata.agentMode === 'single_orchestrator') {
        await recordToolPolicyEvent({
          traceId: analyticsResult.metadata.traceId,
          waUserId: userId,
          villageId,
          channel,
          query: message,
          heuristicTools: (analyticsResult.metadata.heuristicTools || []) as any,
          learnedTools: (analyticsResult.metadata.learnedTools || []) as any,
          allowedTools: (analyticsResult.metadata.allowedTools || []) as any,
          actualTools: analyticsResult.metadata.toolsUsed || [],
          success: analyticsResult.success,
          policyKey: analyticsResult.metadata.toolPolicy?.policyKey,
          policySource: analyticsResult.metadata.toolPolicy?.policySource,
        });
      }
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
