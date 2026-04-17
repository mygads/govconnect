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
 *   knowledge-handler.ts — knowledge / FAQ / village-info queries
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
import { matchServiceSlug, matchComplaintType, classifyFarewell, classifyGreeting, classifyNameUpdate, classifyMessage, extractNameViaNLU, classifyKnowledgeSubtype, analyzeAddress, matchContactQuery, classifyUpdateIntent, validateResponseAgainstKnowledge } from './micro-llm-matcher.service';
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
  pendingNameConfirmation,
  syncNameToChannelService,
  incrementActiveProcessing,
  decrementActiveProcessing,
  clearPendingServiceFormOffer,
  clearPendingCancelConfirmation,
  clearPendingEmergencyComplaintOffer,
} from './ump-state';
import {
  extractNameFromTextNLU,
  extractNameFromHistoryNLU,
  getLastAssistantMessage,
  wasNamePrompted,
  fetchConversationHistoryFromChannel,
  appendToHistoryCache,
} from './ump-utils';
import { buildComplaintCategoriesText, handleComplaintCreation, handleComplaintUpdate, handleCancellationRequest, handleHistory } from './complaint-handler';
import { resolveServiceSlugFromSearch, handleServiceInfo, handleServiceRequestCreation, handleServiceRequestEditLink, buildServiceCatalogText } from './service-handler';
import { runAgent } from './agent';
import { handleStatusCheck } from './status-handler';
import { handleKnowledgeQuery } from './knowledge-handler';
import {
  tryHandleHistoryNameConfirmation,
  tryHandleLatePreAgentState,
  tryHandlePendingNameConfirmation,
  tryHandlePendingOffers,
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
export { handleKnowledgeQuery } from './knowledge-handler';

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

    let greetingClassified = false;
    let isGreetingMessage = false;
    const checkGreeting = async (): Promise<boolean> => {
      if (!greetingClassified) {
        greetingClassified = true;
        const unified = await getUnifiedClassification();
        isGreetingMessage = unified?.message_type === 'GREETING' && unified.confidence >= 0.7;
      }
      return isGreetingMessage;
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

    const pendingNameResult = await tryHandlePendingNameConfirmation({
      userId,
      message,
      channel: agentChannel,
      villageId: resolvedVillageId,
      traceId,
      startTime,
      runWithMicroBudget: withMicroNluBudget,
    });
    if (pendingNameResult) {
      return pendingNameResult;
    }

    const historyNameResult = await tryHandleHistoryNameConfirmation({
      userId,
      message,
      channel: agentChannel,
      villageId: resolvedVillageId,
      traceId,
      startTime,
      conversationHistory: resolvedHistory,
      runWithMicroBudget: withMicroNluBudget,
    });
    if (historyNameResult) {
      return historyNameResult;
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

    // ============================================
    // FAST GREETING TEMPLATE — regex-based, zero LLM cost
    // For obvious greetings from users without a known name and no pending state,
    // respond immediately with a template. This avoids NLU/LLM entirely.
    // Patterns: halo, hai, hi, hello, selamat pagi/siang/sore/malam, assalamualaikum, p, permisi, min
    // Only triggers for SHORT messages (≤30 chars) to avoid false positives on
    // messages like "halo mau tanya..." which should go to full processing.
    // ============================================
    const GREETING_REGEX = /^(h(alo+|ai|i|elo+)|hello|selamat\s+(pagi|siang|sore|malam)|ass?alam(u'?alaikum)?|w[a']?alaikumuss?alam|p|permisi|min|kak|bang|bu|pak|mba[k]?|om)[\s.,!?]*$/i;
    if (!isEvaluation && message.trim().length <= 30 && GREETING_REGEX.test(message.trim())) {
      const profileName = getProfile(userId).nama_lengkap || null;
      if (!profileName) {
        // New user sending a greeting → fast template, no LLM
        const profile = await getVillageProfileSummary(resolvedVillageId);
        const villageLabel = profile?.name ? profile.name : 'Desa/Kelurahan';
        logger.info('⚡ [UnifiedProcessor] Fast greeting template (no LLM)', {
          traceId, userId, channel, message: message.trim(), processingTimeMs: Date.now() - startTime,
        });
        notifyStage('preparing', 80);
        decrementActiveProcessing();
        return {
          success: true,
          response: `Selamat datang di layanan GovConnect ${villageLabel}.\nBoleh kami tahu nama Bapak/Ibu terlebih dahulu?`,
          intent: 'QUESTION',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }
      // If user already has a name, let the greeting fall through to normal processing
      // so AI can give a personalized, context-aware greeting response
    }

    // Hard gate: wajib tahu nama sebelum proses apa pun
    // SKIP for isEvaluation (testing-knowledge) — fokus jawab pertanyaan, tidak perlu tanya nama
    let knownName: string | null = null;
    let currentName: string | null = null;

    if (!isEvaluation) {
    const profileName = getProfile(userId).nama_lengkap || null;
    const nluContext = { village_id: resolvedVillageId, wa_user_id: userId, session_id: userId, channel };
    const lastAssistantMsg = getLastAssistantMessage(resolvedHistory);
    const historyName = await extractNameFromHistoryNLU(resolvedHistory, nluContext);
    knownName = historyName || profileName;
    currentName = await extractNameFromTextNLU(message, { ...nluContext, last_assistant_message: lastAssistantMsg });

    // If we found a name from chat history but it's not persisted in profile yet,
    // persist it now and sync to Channel Service (fixes livechat showing phone only)
    if (historyName && !profileName) {
      updateProfile(userId, { nama_lengkap: historyName });
      syncNameToChannelService(userId, historyName, resolvedVillageId, channel);
    }
    if (!knownName && !currentName) {
      const askedNameBefore = wasNamePrompted(resolvedHistory);
      if (askedNameBefore) {
        // Escape detection: if user's message is clearly a new question/intent (not providing their name),
        // skip name insistence and let the message flow to normal LLM processing.
        // Example: AI asked for name, but user asks "siapa nama pak camatnya" (knowledge query).
        const unifiedNameEscape = await getUnifiedClassification();
        const isNewQuestion = unifiedNameEscape?.message_type === 'QUESTION' && unifiedNameEscape.confidence >= 0.7;
        const isComplaint = unifiedNameEscape?.message_type === 'COMPLAINT' && unifiedNameEscape.confidence >= 0.7;
        if (isNewQuestion || isComplaint) {
          logger.info('[UnifiedProcessor] User asked question/complaint while name pending, skipping name insistence', {
            userId, nluType: unifiedNameEscape?.message_type, confidence: unifiedNameEscape?.confidence,
          });
          // Fall through to normal processing without name
        } else {
          return {
            success: true,
            response: 'Maaf Pak/Bu, saya belum menangkap nama Anda. Mohon tuliskan nama Anda, misalnya: "Nama saya Andi".',
            intent: 'QUESTION',
            metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
          };
        }
      }

      if (await checkGreeting()) {
        const profile = await getVillageProfileSummary(resolvedVillageId);
        const villageLabel = profile?.name ? profile.name : 'Desa/Kelurahan';
        return {
          success: true,
          response: `Selamat datang di layanan GovConnect ${villageLabel}.\nBoleh kami tahu nama Bapak/Ibu terlebih dahulu?`,
          intent: 'QUESTION',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }

      return {
        success: true,
        response: 'Baik Pak/Bu, sebelum melanjutkan boleh kami tahu nama Anda terlebih dahulu?',
        intent: 'QUESTION',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
      };
    }

    if (!knownName && currentName) {
      const explicitName = /(nama\s+(saya|aku|gue|gw)|panggil\s+saya)/i.test(message);
      if (explicitName) {
        updateProfile(userId, { nama_lengkap: currentName });
        syncNameToChannelService(userId, currentName, resolvedVillageId, channel);
        return {
          success: true,
          response: `Baik, terima kasih Pak/Bu ${currentName}. Ada yang bisa kami bantu?`,
          intent: 'QUESTION',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }

      pendingNameConfirmation.set(userId, { name: currentName, timestamp: Date.now() });
      return {
        success: true,
        response: `Baik, apakah benar ini dengan Bapak/Ibu ${currentName}?`,
        intent: 'QUESTION',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
      };
    }

    // Step 1.8b: Name update/correction — user already known but mentions a different name
    // Uses micro NLU to distinguish "nama saya X" (klarifikasi) vs mentioning someone else
    if (knownName && currentName && knownName.toLowerCase() !== currentName.toLowerCase()) {
      try {
        const nameUpdateResult = await withMicroNluBudget(
          () => classifyNameUpdate(message, knownName!, {
            village_id: resolvedVillageId,
            wa_user_id: userId,
            session_id: userId,
            channel,
          }),
          null
        );
        if (nameUpdateResult?.decision === 'UPDATE_NAME' && nameUpdateResult.confidence >= 0.7) {
          const resolvedNewName = nameUpdateResult.new_name?.trim() || currentName;
          updateProfile(userId, { nama_lengkap: resolvedNewName });
          syncNameToChannelService(userId, resolvedNewName, resolvedVillageId, channel);
          return {
            success: true,
            response: `Baik, nama Anda sudah kami perbarui dari "${knownName}" menjadi "${resolvedNewName}". Ada yang bisa kami bantu lagi?`,
            intent: 'QUESTION',
            metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
          };
        }
        // NO_UPDATE → name mentioned in other context, continue normal processing
      } catch (error: any) {
        logger.warn('[UnifiedProcessor] Name update NLU failed, continuing normal flow', { error: error.message });
      }
    }
    } // end if (!isEvaluation) — skip name gate for testing-knowledge
    
    // Step 1.9: Farewell detection — uses unified classifier (shares same LLM call as greeting/RAG check)
    if (message.trim().length < 80) {
      try {
        const unified = await getUnifiedClassification();
        if (unified?.message_type === 'FAREWELL' && unified.confidence >= 0.8) {
          const userName = knownName || getProfile(userId).nama_lengkap;
          const nameGreeting = userName ? ` ${userName}` : '';
          tracker.complete();
          return {
            success: true,
            response: `Baik Pak/Bu${nameGreeting}, terima kasih sudah menghubungi layanan GovConnect. Semoga informasinya bermanfaat. Jangan ragu hubungi kami kembali jika ada keperluan lain ya!`,
            intent: 'QUESTION',
            metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
          };
        }
      } catch (error: any) {
        logger.warn('[UnifiedProcessor] Farewell NLU failed, continuing normal flow', { error: error.message });
      }
    }
    
    // Step 1.95: Help/Menu command — quick feature listing
    const helpPattern = /^\s*(bantuan|help|menu|fitur|layanan apa saja|bisa apa|apa saja|panduan)\s*[?.!]*\s*$/i;
    if (helpPattern.test(message.trim())) {
      const userName = knownName || getProfile(userId).nama_lengkap;
      const nameGreeting = userName ? ` ${userName}` : '';
      tracker.complete();
      return {
        success: true,
        response: `Halo Pak/Bu${nameGreeting}! Berikut layanan yang tersedia di GovConnect:\n\n` +
          `📋 *Pengaduan* — Laporkan keluhan di lingkungan Anda\n` +
          `📄 *Layanan Surat* — Ajukan pembuatan surat/dokumen\n` +
          `🔍 *Cek Status* — Cek status pengaduan atau permohonan\n` +
          `❌ *Batalkan* — Batalkan pengaduan atau permohonan\n` +
          `ℹ️ *Informasi* — Tanya syarat, prosedur, jam layanan, dll\n\n` +
          `Silakan sampaikan keperluan Bapak/Ibu.`,
        intent: 'QUESTION',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
      };
    }

    // Step 1.96: Voice/Sticker/GIF fallback — unsupported media types
    if (input.mediaType && ['voice', 'audio', 'sticker', 'gif', 'video_note'].includes(input.mediaType.toLowerCase())) {
      const mediaLabels: Record<string, string> = {
        voice: 'pesan suara', audio: 'audio', sticker: 'sticker',
        gif: 'GIF', video_note: 'video',
      };
      const label = mediaLabels[input.mediaType.toLowerCase()] || input.mediaType;
      tracker.complete();
      return {
        success: true,
        response: `Mohon maaf, saat ini kami belum bisa memproses ${label}. ` +
          `Silakan ketik pesan dalam bentuk teks ya, Pak/Bu.\n\n` +
          `Ketik *bantuan* untuk melihat daftar layanan yang tersedia.`,
        intent: 'QUESTION',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
      };
    }

    // Step 1.97: Emergency detection is now fully DB-driven.
    // No pre-LLM keyword matching — the LLM handles intent classification,
    // and is_urgent comes from complaintTypeConfig in the DB.

    // Step 1.98: Pre-LLM contact/emergency interceptor — uses micro-NLU to detect
    // contact requests (damkar, ambulan, polisi, kecamatan) and emergency situations
    // that need immediate contact numbers. Bypasses LLM for faster response.
    {
      const unified = await getUnifiedClassification();
      const isContactRequest = unified?.categories?.includes('kontak');
      const isEmergencyLike = unified?.message_type === 'QUESTION' && isContactRequest;

      if (isEmergencyLike || isContactRequest) {
        try {
          const contactSubtype = await withMicroNluBudget(
            () => classifyKnowledgeSubtype(message.trim(), {
              village_id: resolvedVillageId,
              wa_user_id: userId,
              session_id: userId,
              channel,
            }),
            null
          );

          if (contactSubtype?.subtype === 'contact' && contactSubtype.confidence >= 0.7) {
            logger.info('🚨 [UnifiedProcessor] Pre-LLM contact interceptor triggered', {
              traceId, userId, channel,
              contactEntity: contactSubtype.contact_entity,
              confidence: contactSubtype.confidence,
            });

            // Build a synthetic KNOWLEDGE_QUERY response to route through knowledge handler
            const syntheticLlm = {
              intent: 'KNOWLEDGE_QUERY',
              fields: {
                village_id: resolvedVillageId,
                knowledge_category: 'kontak',
              },
              reply_text: '',
            };

            tracker.preparing();
            notifyStage('preparing', 80);
            const contactReply = await handleKnowledgeQuery(
              userId, message, syntheticLlm, undefined, channel
            );
            const contactUnwrapped = unwrapHandler(contactReply);

            tracker.complete();
            if (channel === 'whatsapp') {
              appendToHistoryCache(userId, 'assistant', contactUnwrapped.response);
            }
            return {
              success: true,
              response: contactUnwrapped.response,
              contacts: contactUnwrapped.contacts,
              intent: 'KNOWLEDGE_QUERY',
              metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: true, traceId },
            };
          }
        } catch (error: any) {
          logger.warn('[UnifiedProcessor] Contact interceptor NLU failed, continuing to LLM', { error: error.message });
        }
      }
    }

    const latePreAgentResult = await tryHandleLatePreAgentState({
      userId,
      message,
      channel: agentChannel,
      villageId: resolvedVillageId,
      traceId,
      startTime,
      mediaUrl,
      knownName,
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

    if (await checkGreeting()) {
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
  handleKnowledgeQuery,
  validateResponse,
};
