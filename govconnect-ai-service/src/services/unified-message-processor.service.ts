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
import { callGemini } from './llm.service';
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
import { getGraphContextAsync, findNodeByKeywordAsync, getAllServiceCodes, getAllServiceKeywords } from './knowledge-graph.service';
import { getSmartFallback, getErrorFallback } from './fallback-response.service';
import { getCachedResponse, setCachedResponse, isCacheable } from './response-cache.service';
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
  pendingAddressConfirmation,
  pendingAddressRequest,
  pendingCancelConfirmation,
  pendingNameConfirmation,
  pendingServiceFormOffer,
  pendingEmergencyComplaintOffer,
  pendingComplaintData,
  pendingPhotos,
  addPendingPhoto,
  consumePendingPhotos,
  getPendingPhotoCount,
  MAX_PHOTOS_PER_COMPLAINT,
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
  extractNameFromAssistantPrompt,
  wasNamePrompted,
  fetchConversationHistoryFromChannel,
  appendToHistoryCache,
  extractAddressFromMessage,
  buildContextWithHistory,
} from './ump-utils';
import { buildComplaintCategoriesText, handleComplaintCreation, handleComplaintUpdate, handleCancellationRequest, handleHistory, handlePendingAddressConfirmation } from './complaint-handler';
import { resolveServiceSlugFromSearch, handleServiceInfo, handleServiceRequestCreation, handleServiceRequestEditLink, buildServiceCatalogText } from './service-handler';
import { handleStatusCheck } from './status-handler';
import { handleKnowledgeQuery } from './knowledge-handler';

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
export async function processUnifiedMessage(input: ProcessMessageInput): Promise<ProcessMessageResult> {
  incrementActiveProcessing();
  const startTime = Date.now();
  const { userId, message, channel, conversationHistory, mediaUrl, villageId, isEvaluation } = input;
  let resolvedHistory = conversationHistory;
  
  // Generate trace ID for correlating all logs in this request
  const traceId = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  
  const tracker = createProcessingTracker(userId);
  
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

    const pendingName = pendingNameConfirmation.get(userId);
    if (pendingName) {
      // Use micro LLM for name confirmation (full NLU, no regex fallback)
      let nameDecision: string;
      try {
        const nameResult = await withMicroNluBudget(
          () => classifyConfirmation(message.trim(), { village_id: resolvedVillageId, wa_user_id: userId, session_id: userId, channel }),
          null
        );
        nameDecision = nameResult?.decision === 'CONFIRM' ? 'yes' : nameResult?.decision === 'REJECT' ? 'no' : 'uncertain';
      } catch {
        nameDecision = 'uncertain';
      }

      if (nameDecision === 'yes') {
        pendingNameConfirmation.delete(userId);
        updateProfile(userId, { nama_lengkap: pendingName.name });
        syncNameToChannelService(userId, pendingName.name, resolvedVillageId, channel);
        return {
          success: true,
          response: `Baik, terima kasih Pak/Bu ${pendingName.name}. Ada yang bisa kami bantu?`,
          intent: 'QUESTION',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }

      if (nameDecision === 'no') {
        pendingNameConfirmation.delete(userId);
        return {
          success: true,
          response: 'Mohon maaf, boleh kami tahu nama yang benar?',
          intent: 'QUESTION',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }

      // uncertain → re-ask
      return {
        success: true,
        response: `Baik, apakah benar ini dengan Bapak/Ibu ${pendingName.name}? Balas YA atau BUKAN ya.`,
        intent: 'QUESTION',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
      };
    }

    const lastPromptedName = extractNameFromAssistantPrompt(getLastAssistantMessage(resolvedHistory));
    if (lastPromptedName) {
      // Use micro LLM for name confirmation via history (full NLU, no regex fallback)
      let histNameDecision: string;
      try {
        const histNameResult = await withMicroNluBudget(
          () => classifyConfirmation(message.trim(), { village_id: resolvedVillageId, wa_user_id: userId, session_id: userId, channel }),
          null
        );
        histNameDecision = histNameResult?.decision === 'CONFIRM' ? 'yes' : histNameResult?.decision === 'REJECT' ? 'no' : 'uncertain';
      } catch {
        histNameDecision = 'uncertain';
      }

      if (histNameDecision === 'yes') {
        logger.info('🧭 [UnifiedProcessor] Name confirmation via history', {
          userId,
          name: lastPromptedName,
          source: 'history_prompt',
        });
        updateProfile(userId, { nama_lengkap: lastPromptedName });
        syncNameToChannelService(userId, lastPromptedName, resolvedVillageId, channel);
        return {
          success: true,
          response: `Baik, terima kasih Pak/Bu ${lastPromptedName}. Ada yang bisa kami bantu?`,
          intent: 'QUESTION',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }

      if (histNameDecision === 'no') {
        return {
          success: true,
          response: 'Mohon maaf, boleh kami tahu nama yang benar?',
          intent: 'QUESTION',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }
      // uncertain → fall through to normal processing
    }

    // Step 2.2: Check pending online service form offer
    const pendingOffer = pendingServiceFormOffer.get(userId);
    if (pendingOffer) {
      // If the message contains a LAP/LAY code, clear the pending offer and let it fall through
      // to Step 2.45 where the code will be detected and handled as a status check.
      const hasLapLayCode = /\b(LAP|LAY)-\d{8}-\d{3}\b/i.test(message);
      if (hasLapLayCode) {
        logger.info('[UnifiedProcessor] LAP/LAY code detected while pendingServiceFormOffer active, clearing offer', { userId });
        clearPendingServiceFormOffer(userId);
        // fall through to Step 2.45
      } else {
        const confirmationResult = await withMicroNluBudget(
          () => classifyConfirmation(message, { village_id: resolvedVillageId, wa_user_id: userId, session_id: userId, channel }),
          null
        );
        const isLikelyConfirm = confirmationResult && confirmationResult.decision === 'CONFIRM' && confirmationResult.confidence >= 0.7;
        const isLikelyReject = confirmationResult && confirmationResult.decision === 'REJECT' && confirmationResult.confidence >= 0.7;

        if (isLikelyConfirm) {
          clearPendingServiceFormOffer(userId);
          const llmLike = {
            intent: 'CREATE_SERVICE_REQUEST',
            fields: {
              service_slug: pendingOffer.service_slug,
              ...(pendingOffer.village_id ? { village_id: pendingOffer.village_id } : {}),
            },
            reply_text: '',
          };

          const linkReply = await handleServiceRequestCreation(userId, channel, llmLike);
          return {
            success: true,
            response: linkReply,
            intent: 'CREATE_SERVICE_REQUEST',
            metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
          };
        }

        if (isLikelyReject) {
          clearPendingServiceFormOffer(userId);
          return {
            success: true,
            response: 'Baik Pak/Bu, siap. Kalau Bapak/Ibu mau proses nanti, kabari kami ya.',
            intent: 'QUESTION',
            metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
          };
        }

        // UNCERTAIN: The user's message is neither a clear YES nor NO.
        // This means the user is likely talking about something else entirely.
        // Clear the pending offer and let normal processing handle the message,
        // regardless of length — the micro NLU already determined it's not a confirmation.
        logger.info('[UnifiedProcessor] Clearing pendingServiceFormOffer — confirmation is UNCERTAIN, treating as new intent', { userId, messageLength: message.length });
        clearPendingServiceFormOffer(userId);
        // fall through to normal processing
      }
    }

    // Step 2.3: Check pending emergency complaint offer
    const pendingEmergency = pendingEmergencyComplaintOffer.get(userId);
    if (pendingEmergency) {
      const confirmationResult = await withMicroNluBudget(
        () => classifyConfirmation(message, { village_id: resolvedVillageId, wa_user_id: userId, session_id: userId, channel }),
        null
      );
      const isLikelyConfirm = confirmationResult && confirmationResult.decision === 'CONFIRM' && confirmationResult.confidence >= 0.7;
      const isLikelyReject = confirmationResult && confirmationResult.decision === 'REJECT' && confirmationResult.confidence >= 0.7;

      if (isLikelyConfirm) {
        clearPendingEmergencyComplaintOffer(userId);
        // Route to complaint creation with the emergency context
        const llmLike = {
          intent: 'CREATE_COMPLAINT',
          fields: {
            kategori: pendingEmergency.contact_entity || 'darurat',
            ...(pendingEmergency.village_id ? { village_id: pendingEmergency.village_id } : {}),
          },
          reply_text: '',
        };
        const complaintResult = await handleComplaintCreation(userId, channel, llmLike, message);
        const unwrapped = unwrapHandler(complaintResult);
        return {
          success: true,
          response: unwrapped.response,
          contacts: unwrapped.contacts,
          intent: 'CREATE_COMPLAINT',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }

      if (isLikelyReject) {
        clearPendingEmergencyComplaintOffer(userId);
        return {
          success: true,
          response: 'Baik Pak/Bu. Semoga situasinya segera tertangani. Jangan ragu hubungi kami jika butuh bantuan lagi.',
          intent: 'KNOWLEDGE_QUERY',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }

      // Ambiguous → re-prompt
      return {
        success: true,
        response: 'Apakah Bapak/Ibu ingin kami *buatkan laporan pengaduan* terkait situasi darurat ini? Balas *iya* atau *tidak*.',
        intent: 'KNOWLEDGE_QUERY',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
      };
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

    // Step 2: Check pending address confirmation (for vague addresses)
    const pendingConfirm = pendingAddressConfirmation.get(userId);
    if (pendingConfirm) {
      const confirmResult = await handlePendingAddressConfirmation(userId, message, pendingConfirm, channel === 'webchat' ? 'webchat' : 'whatsapp', mediaUrl);
      if (confirmResult) {
        return {
          success: true,
          response: confirmResult,
          intent: 'CREATE_COMPLAINT',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }
    }
    
    // Step 2.05: Check pending address request (for missing required addresses)
    const pendingAddr = pendingAddressRequest.get(userId);
    if (pendingAddr) {
      // Escape detection: if user's message looks like a new intent (service, knowledge, status),
      // clear the pending state and let the message flow to the LLM for fresh classification.
      const unified205 = await getUnifiedClassification();
      const isNewIntent205 = unified205?.message_type === 'QUESTION' && unified205.confidence >= 0.7;
      const isComplaint205 = unified205?.message_type === 'COMPLAINT' && unified205.confidence >= 0.7;
      const isGreeting205 = unified205?.message_type === 'GREETING';
      const isFarewell205 = unified205?.message_type === 'FAREWELL';
      // Fully NLU-driven topic change detection — no hardcoded keyword regex.
      // classifyMessage() already distinguishes DATA_INPUT (user providing address)
      // from QUESTION (user changing topic) and COMPLAINT (new report).
      // rag_needed=true means user is asking a knowledge question, not giving an address.
      const needsRAG205 = unified205?.rag_needed === true && isNewIntent205;
      if (isNewIntent205 || isComplaint205 || isGreeting205 || isFarewell205 || needsRAG205) {
        logger.info('[UnifiedProcessor] User changed topic during pending address, clearing state', {
          userId, nluType: unified205?.message_type, confidence: unified205?.confidence,
        });
        pendingAddressRequest.delete(userId);
        // Fall through to normal processing
      } else {
      // Try to extract address from user's message via NLU
      const extractedAddr = await extractAddressFromMessage(message, userId, { village_id: pendingAddr.village_id });
      if (extractedAddr && extractedAddr.length >= 5) {
        pendingAddressRequest.delete(userId);
        
        // Continue with complaint creation using the new address
        const llmLike = {
          fields: {
            village_id: pendingAddr.village_id,
            kategori: pendingAddr.kategori,
            deskripsi: pendingAddr.deskripsi,
            alamat: extractedAddr,
          },
        };
        
        logger.info('Continuing complaint with provided address', { 
          userId, 
          kategori: pendingAddr.kategori,
          alamat: extractedAddr,
        });
        
        // If current message also has a photo, accumulate it
        if (mediaUrl) addPendingPhoto(userId, mediaUrl);
        
        const complaintResult = await handleComplaintCreation(
          userId, 
          channel === 'webchat' ? 'webchat' : 'whatsapp', 
          llmLike, 
          message, 
          undefined // Photos tracked in pendingPhotos cache
        );
        const unwrapped = unwrapHandler(complaintResult);
        
        return {
          success: true,
          response: unwrapped.response,
          contacts: unwrapped.contacts,
          intent: 'CREATE_COMPLAINT',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      } else if (message.trim().length > 10) {
        // User might have provided address in free text — validate with NLU first
        const addrAnalysis = await analyzeAddress(message.trim(), { village_id: pendingAddr.village_id, is_complaint_context: true, kategori: pendingAddr.kategori });
        if (addrAnalysis?.quality === 'not_address') {
          // Message is NOT an address — ask again with guidance
          logger.info('[UnifiedProcessor] Message not recognized as address, asking again', { userId, quality: addrAnalysis.quality });
          return {
            success: true,
            response: 'Mohon maaf Pak/Bu, saya belum bisa mengenali lokasi dari pesan tersebut. Bisa disebutkan alamat lengkapnya? Misalnya nama jalan, RT/RW, atau patokan terdekat.',
            intent: 'CREATE_COMPLAINT',
            metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
          };
        }
        // Address detected (specific or vague) — proceed
        pendingAddressRequest.delete(userId);
        
        const llmLike = {
          fields: {
            village_id: pendingAddr.village_id,
            kategori: pendingAddr.kategori,
            deskripsi: pendingAddr.deskripsi,
            alamat: message.trim(),
          },
        };
        
        logger.info('Using user message as address for complaint', { 
          userId, 
          kategori: pendingAddr.kategori,
          alamat: message.trim(),
        });
        
        // If current message also has a photo, accumulate it
        if (mediaUrl) addPendingPhoto(userId, mediaUrl);
        
        const complaintResult = await handleComplaintCreation(
          userId, 
          channel === 'webchat' ? 'webchat' : 'whatsapp', 
          llmLike, 
          message, 
          undefined // Photos tracked in pendingPhotos cache
        );
        const unwrapped = unwrapHandler(complaintResult);
        
        return {
          success: true,
          response: unwrapped.response,
          contacts: unwrapped.contacts,
          intent: 'CREATE_COMPLAINT',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }
      } // end else (not new intent — continue complaint address flow)
    }

    // Step 2.07: Check pending complaint data (waiting for name/phone)
    const pendingComplaint = pendingComplaintData.get(userId);
    if (pendingComplaint) {
      // Escape detection: if user's message looks like a new intent (service, knowledge, status),
      // clear the pending state and let the message flow to the LLM for fresh classification.
      const unified207 = await getUnifiedClassification();
      const isNewIntent207 = unified207?.message_type === 'QUESTION' && unified207.confidence >= 0.7;
      const isComplaint207 = unified207?.message_type === 'COMPLAINT' && unified207.confidence >= 0.7;
      const isGreeting207 = unified207?.message_type === 'GREETING';
      const isFarewell207 = unified207?.message_type === 'FAREWELL';
      // Fully NLU-driven — same logic as Step 2.05
      const needsRAG207 = unified207?.rag_needed === true && isNewIntent207;
      if (isNewIntent207 || isComplaint207 || isGreeting207 || isFarewell207 || needsRAG207) {
        logger.info('[UnifiedProcessor] User changed topic during pending complaint data, clearing state', {
          userId, nluType: unified207?.message_type, confidence: unified207?.confidence,
        });
        pendingComplaintData.delete(userId);
        // Fall through to normal processing
      } else {
      const userProfile = getProfile(userId);
      
      if (pendingComplaint.waitingFor === 'nama') {
        // Try to extract name from message
        const extractedName = await extractNameFromTextNLU(message, { village_id: resolvedVillageId, wa_user_id: userId, session_id: userId, channel });
        if (extractedName) {
          // Save name to profile + sync to Channel Service sidebar
          updateProfile(userId, { nama_lengkap: extractedName });
          syncNameToChannelService(userId, extractedName, resolvedVillageId, channel);
          
          // Check if webchat still needs phone
          if (pendingComplaint.channel === 'webchat' && !userProfile.no_hp) {
            // Update pending to wait for phone
            pendingComplaintData.set(userId, {
              ...pendingComplaint,
              waitingFor: 'no_hp',
              timestamp: Date.now(),
            });
            
            return {
              success: true,
              response: `Terima kasih Pak/Bu ${extractedName}. Mohon informasikan juga nomor telepon yang dapat dihubungi.`,
              intent: 'CREATE_COMPLAINT',
              metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
            };
          }
          
          // All data complete, proceed with complaint creation
          pendingComplaintData.delete(userId);
          
          const llmLike = {
            fields: {
              village_id: pendingComplaint.village_id,
              kategori: pendingComplaint.kategori,
              deskripsi: pendingComplaint.deskripsi,
              alamat: pendingComplaint.alamat,
              rt_rw: pendingComplaint.rt_rw,
            },
          };
          
          logger.info('Continuing complaint after name received', { 
            userId, 
            nama: extractedName,
            kategori: pendingComplaint.kategori,
          });
          
          const complaintResult = await handleComplaintCreation(
            userId, 
            pendingComplaint.channel, 
            llmLike, 
            message, 
            undefined // Photos tracked in pendingPhotos cache
          );
          const unwrapped = unwrapHandler(complaintResult);
          
          return {
            success: true,
            response: unwrapped.response,
            contacts: unwrapped.contacts,
            intent: 'CREATE_COMPLAINT',
            metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
          };
        }
        
        // Could not extract name, ask again
        return {
          success: true,
          response: 'Mohon maaf Pak/Bu, boleh tuliskan nama lengkap Anda untuk melanjutkan laporan?',
          intent: 'CREATE_COMPLAINT',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }
      
      if (pendingComplaint.waitingFor === 'no_hp') {
        // Try to extract phone from message
        const phoneMatch = message.match(/\b(0[87]\d{8,11}|62[87]\d{8,11}|\+62[87]\d{8,11})\b/);
        if (phoneMatch) {
          const phone = phoneMatch[1].replace(/^\+/, '');
          
          // Save phone to profile + sync to Channel Service
          updateProfile(userId, { no_hp: phone });
          const channelUpper = (pendingComplaint.channel || 'webchat').toUpperCase() as 'WHATSAPP' | 'WEBCHAT';
          updateConversationUserProfile(userId, { user_phone: phone }, pendingComplaint.village_id, channelUpper)
            .catch(() => { /* non-critical */ });
          
          // All data complete, proceed with complaint creation
          pendingComplaintData.delete(userId);
          
          const llmLike = {
            fields: {
              village_id: pendingComplaint.village_id,
              kategori: pendingComplaint.kategori,
              deskripsi: pendingComplaint.deskripsi,
              alamat: pendingComplaint.alamat,
              rt_rw: pendingComplaint.rt_rw,
            },
          };
          
          logger.info('Continuing complaint after phone received', { 
            userId, 
            phone,
            kategori: pendingComplaint.kategori,
          });
          
          const complaintResult = await handleComplaintCreation(
            userId, 
            pendingComplaint.channel, 
            llmLike, 
            message, 
            undefined // Photos tracked in pendingPhotos cache
          );
          const unwrapped = unwrapHandler(complaintResult);
          
          return {
            success: true,
            response: unwrapped.response,
            contacts: unwrapped.contacts,
            intent: 'CREATE_COMPLAINT',
            metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
          };
        }
        
        // Could not extract phone, ask again
        return {
          success: true,
          response: 'Mohon maaf Pak/Bu, format nomor telepon sepertinya kurang tepat. Silakan masukkan nomor HP yang valid (contoh: 081234567890).',
          intent: 'CREATE_COMPLAINT',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }
      } // end else (not new intent — continue complaint data flow)
    }

    // Step 2.08: Photo-only message during active complaint flow
    // If user sends a photo with no meaningful text while we're collecting complaint data,
    // accumulate the photo and acknowledge it without disrupting the flow.
    if (mediaUrl && message.trim().length < 5) {
      const hasActiveComplaintFlow = pendingAddressRequest.get(userId) || pendingAddressConfirmation.get(userId) || pendingComplaintData.get(userId);
      if (hasActiveComplaintFlow) {
        const photoCount = getPendingPhotoCount(userId);
        if (photoCount >= MAX_PHOTOS_PER_COMPLAINT) {
          return {
            success: true,
            response: `Maaf Pak/Bu, maksimal ${MAX_PHOTOS_PER_COMPLAINT} foto per laporan. Foto sebelumnya sudah kami simpan. Silakan lanjutkan menjawab pertanyaan kami.`,
            intent: 'CREATE_COMPLAINT',
            metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
          };
        }
        addPendingPhoto(userId, mediaUrl);
        const newCount = getPendingPhotoCount(userId);
        const remaining = MAX_PHOTOS_PER_COMPLAINT - newCount;
        return {
          success: true,
          response: `✅ Foto ke-${newCount} sudah kami terima.${remaining > 0 ? ` Anda masih bisa mengirim ${remaining} foto lagi.` : ' Batas foto sudah tercapai.'} Silakan lanjutkan menjawab pertanyaan sebelumnya ya Pak/Bu.`,
          intent: 'CREATE_COMPLAINT',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }

      // Photo-only message outside any active flow — store and acknowledge
      addPendingPhoto(userId, mediaUrl);
      const userName = knownName || getProfile(userId).nama_lengkap;
      const nameGreeting = userName ? ` ${userName}` : '';
      tracker.complete();
      return {
        success: true,
        response: `Terima kasih Pak/Bu${nameGreeting}, foto sudah kami terima. ` +
          `Jika ingin melaporkan pengaduan, silakan jelaskan masalahnya dan foto akan kami lampirkan otomatis.`,
        intent: 'QUESTION',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
      };
    }

    // Step 2.1: Check pending cancel confirmation
    const pendingCancel = pendingCancelConfirmation.get(userId);
    if (pendingCancel) {
      // Use micro LLM for confirmation classification (full NLU, no regex fallback)
      let cancelDecision: string;
      try {
        const cancelResult = await withMicroNluBudget(
          () => classifyConfirmation(message.trim(), { village_id: resolvedVillageId, wa_user_id: userId, session_id: userId, channel }),
          null
        );
        cancelDecision = cancelResult?.decision === 'CONFIRM' ? 'yes' : cancelResult?.decision === 'REJECT' ? 'no' : 'uncertain';
      } catch {
        cancelDecision = 'uncertain';
      }

      if (cancelDecision === 'yes') {
        clearPendingCancelConfirmation(userId);
        if (pendingCancel.type === 'laporan') {
          const result = await cancelComplaint(pendingCancel.id, buildChannelParams(channel, userId), pendingCancel.reason);
          return {
            success: true,
            response: result.success
              ? buildCancelSuccessResponse('laporan', pendingCancel.id, result.message)
              : buildCancelErrorResponse('laporan', pendingCancel.id, result.error, result.message),
            intent: 'CANCEL_COMPLAINT',
            metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
          };
        }

        const serviceResult = await cancelServiceRequest(pendingCancel.id, buildChannelParams(channel, userId), pendingCancel.reason);
        return {
          success: true,
          response: serviceResult.success
            ? buildCancelSuccessResponse('layanan', pendingCancel.id, serviceResult.message)
            : buildCancelErrorResponse('layanan', pendingCancel.id, serviceResult.error, serviceResult.message),
          intent: 'CANCEL_SERVICE_REQUEST',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }

      if (cancelDecision === 'no') {
        clearPendingCancelConfirmation(userId);
        return {
          success: true,
          response: 'Baik Pak/Bu, laporan/layanan Anda tidak jadi dibatalkan. Ada yang bisa kami bantu lagi?',
          intent: 'QUESTION',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }

      // uncertain — ask again
      return {
        success: true,
        response: 'Mohon konfirmasi ya Pak/Bu. Balas "YA" untuk melanjutkan pembatalan, atau "TIDAK" untuk membatalkan.',
        intent: pendingCancel.type === 'laporan' ? 'CANCEL_COMPLAINT' : 'CANCEL_SERVICE_REQUEST',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
      };
    }

    // Step 2.5: AI Optimization - Pre-process message
    // Step 2.45: Direct LAP/LAY code detection — bypass LLM for direct status check
    // Flexible regex: handles LAP-20260226-001, LAP-20260226001, LAP20260226001, etc.
    const lapMatch = message.match(/\b(LAP[-\s]?\d{8}[-\s]?\d{3})\b/i);
    const layMatch = message.match(/\b(LAY[-\s]?\d{8}[-\s]?\d{3})\b/i);
    if (lapMatch || layMatch) {
      // Normalize to standard format: LAP-YYYYMMDD-NNN or LAY-YYYYMMDD-NNN
      const rawCode = (lapMatch?.[1] || layMatch?.[1])!.toUpperCase().replace(/\s/g, '');
      const prefix = rawCode.startsWith('LAP') ? 'LAP' : 'LAY';
      const digitsOnly = rawCode.replace(/^(LAP|LAY)-?/, '').replace(/-/g, '');
      const code = `${prefix}-${digitsOnly.slice(0, 8)}-${digitsOnly.slice(8)}`;
      const isLap = prefix === 'LAP';
      const directCheckLlm = {
        intent: 'CHECK_STATUS',
        fields: isLap ? { complaint_id: code } : { request_number: code },
        reply_text: '',
      };
      logger.info('[UnifiedProcessor] Direct LAP/LAY code detected, bypassing LLM', { userId, rawCode, normalizedCode: code });
      tracker.preparing();
      const statusReply = await handleStatusCheck(userId, channel, directCheckLlm, message);
      tracker.complete();
      if (channel === 'whatsapp') {
        appendToHistoryCache(userId, 'assistant', statusReply);
      }
      return {
        success: true,
        response: statusReply,
        intent: 'CHECK_STATUS',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
      };
    }

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
    
    // Step 4: Language detection
    const languageDetection = detectLanguage(sanitizedMessage);
    const languageContext = getLanguageContext(languageDetection);
    
    // Step 5: Sentiment analysis (regex pre-filter + micro-LLM for urgent/angry)
    const sentiment = await analyzeSentimentWithLLM(sanitizedMessage, userId, {
      village_id: resolvedVillageId,
      wa_user_id: userId,
      session_id: userId,
      channel,
    });
    const sentimentContext = getSentimentContext(sentiment);
    
    // Step 5.5: User Profile & Context Enhancement
    // Learn from message (extract NIK, phone, detect style)
    if (!isEvaluation) {
      learnFromMessage(userId, message);
      recordInteraction(userId, sentiment.score, undefined);
    }
    
    // Get profile context for LLM
    const profileContext = getProfileContext(userId);
    
    // Get enhanced conversation context
    const conversationCtx = getEnhancedContext(userId);
    const conversationContextStr = getContextForLLM(userId);
    
    // Build adaptation context (sentiment + profile + conversation)
    const adaptationContext = buildAdaptationContext(userId, sentiment);
    
    // Check if user needs human escalation
    if (needsHumanEscalation(userId) || conversationCtx.needsHumanHelp) {
      logger.warn('🚨 User needs human escalation', { 
        userId, 
        sentiment: sentiment.level,
        clarificationCount: conversationCtx.clarificationCount,
        isStuck: conversationCtx.isStuck,
      });
    }
    
    // Step 5.8: Response cache check — skip expensive RAG + LLM for repeated questions
    // Only for stateless queries (FAQ, knowledge, greetings) — never for user-specific flows
    const fsmState = conversationCtx.fsmState;
    if (fsmState === 'IDLE' && isCacheable(sanitizedMessage)) {
      const cachedResp = getCachedResponse(sanitizedMessage);
      if (cachedResp) {
        const processingTimeMs = Date.now() - startTime;
        tracker.complete();
        if (channel === 'whatsapp') {
          appendToHistoryCache(userId, 'assistant', cachedResp.response);
        }
        logger.info('⚡ [UnifiedProcessor] Response served from cache', {
          userId, channel, intent: cachedResp.intent, processingTimeMs,
        });
        return {
          success: true,
          response: cachedResp.response,
          guidanceText: cachedResp.guidanceText,
          intent: cachedResp.intent,
          metadata: {
            processingTimeMs,
            hasKnowledge: cachedResp.intent === 'KNOWLEDGE_QUERY',
          },
        };
      }
    }
    
    // Step 6: Pre-fetch RAG context if needed
    // Uses unified NLU classifier result for intelligent RAG skip/fetch decision
    // This avoids a separate shouldRetrieveContext() call that would invoke classifyRAGIntent again
    tracker.searching();
    
    let preloadedRAGContext: RAGContext | string | undefined;
    let graphContext = '';
    const isGreeting = await checkGreeting();
    const unified = await getUnifiedClassification();
    const looksLikeQuestion = unified?.rag_needed ?? await shouldRetrieveContext(sanitizedMessage);
    const nluCategories = unified?.categories || [];
    const prefetchVillageId = resolvedVillageId;
    
    if (isGreeting) {
      try {
        const kelurahanInfo = await getKelurahanInfoContext(prefetchVillageId);
        if (kelurahanInfo) preloadedRAGContext = kelurahanInfo;
      } catch (error: any) {
        logger.warn('[UnifiedProcessor] Failed to fetch kelurahan info', { error: error.message });
      }
    } else if (looksLikeQuestion) {
      try {
        // Pass NLU-inferred categories to RAG for more targeted search
        const ragContext = await getRAGContext(sanitizedMessage, nluCategories.length > 0 ? nluCategories : undefined, prefetchVillageId);
        if (ragContext.totalResults > 0) preloadedRAGContext = ragContext;
      } catch (error: any) {
        logger.warn('[UnifiedProcessor] RAG fetch failed', { error: error.message });
      }
    }
    
    // Step 6.5: Get knowledge graph context for service-related queries
    // Dynamically uses DB-backed knowledge graph (no hardcoded service codes/keywords)
    try {
      
      // Build dynamic service code regex from DB-backed knowledge graph
      const serviceCodes = getAllServiceCodes();
      if (serviceCodes.length > 0) {
        // Escape regex special chars in service codes (some may contain parentheses like "SKKT(")
        const escapedCodes = serviceCodes.map(code => code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const codesPattern = new RegExp(`\\b(${escapedCodes.join('|')})\\b`, 'i');
        const serviceCodeMatch = sanitizedMessage.match(codesPattern);
        if (serviceCodeMatch) {
          graphContext = await getGraphContextAsync(serviceCodeMatch[1].toUpperCase());
        }
      }
      
      // If no direct code match, try keyword matching from DB-backed nodes
      if (!graphContext) {
        const serviceKeywords = getAllServiceKeywords();
        const lowerMsg = sanitizedMessage.toLowerCase();
        for (const { keyword } of serviceKeywords) {
          if (lowerMsg.includes(keyword)) {
            const node = await findNodeByKeywordAsync(keyword);
            if (node) {
              graphContext = await getGraphContextAsync(node.code);
              break;
            }
          }
        }
      }
    } catch (error: any) {
      logger.warn('[UnifiedProcessor] Knowledge graph lookup failed', { error: error.message });
    }

    // Step 7: Build context
    // Determine prompt focus based on conversation state to reduce token usage
    // Priority: FSM state > previous intent > NLU message_type > emergency > graph > 'full'
    //
    // ADAPTIVE PROMPT SAVINGS (vs full ~5000 tokens):
    //   complaint → ~1400 tokens (core + complaint rules/intents/cases + edge)
    //   service   → ~1800 tokens (core + service rules/intents/cases + edge)
    //   knowledge → ~1600 tokens (core + knowledge rules + PART5 + edge)
    //   status    → ~1200 tokens (core + status rules/cases + edge)
    //   cancel    → ~2000 tokens (core + cancel + complaint/service)
    let promptFocus: PromptFocus = 'full';
    const currentIntent = conversationCtx.currentIntent;
    
    if (fsmState === 'COLLECTING_COMPLAINT_DATA' || fsmState === 'CONFIRMING_COMPLAINT' || fsmState === 'AWAITING_ADDRESS_DETAIL') {
      promptFocus = 'complaint';
    } else if (fsmState === 'COLLECTING_SERVICE_REQUEST_DATA' || fsmState === 'CONFIRMING_SERVICE_REQUEST') {
      promptFocus = 'service';
    } else if (fsmState === 'CANCELLATION_FLOW') {
      promptFocus = 'cancel';
    } else if (fsmState === 'CHECK_STATUS_FLOW') {
      promptFocus = 'status';
    } else if (currentIntent === 'KNOWLEDGE_QUERY') {
      promptFocus = 'knowledge';
    } else if (currentIntent === 'CREATE_COMPLAINT' || currentIntent === 'UPDATE_COMPLAINT') {
      promptFocus = 'complaint';
    } else if (currentIntent === 'SERVICE_INFO' || currentIntent === 'CREATE_SERVICE_REQUEST' || currentIntent === 'UPDATE_SERVICE_REQUEST') {
      promptFocus = 'service';
    } else if (unified?.message_type && unified.confidence >= 0.7) {
      // NLU→PromptFocus bridge: use micro NLU classification for first message / IDLE state
      // This saves ~3000-3500 tokens by loading only relevant rules, intents, and case examples
      switch (unified.message_type) {
        case 'COMPLAINT':
          promptFocus = 'complaint';
          break;
        case 'QUESTION':
          // Questions could be service or knowledge — use RAG categories to decide
          if (nluCategories.some(c => ['layanan_administrasi', 'panduan-sop'].includes(c))) {
            promptFocus = 'service';
          } else if (nluCategories.length > 0) {
            promptFocus = 'knowledge';
          }
          // else remains 'full' — ambiguous question
          break;
        // GREETING, FAREWELL, DATA_INPUT, CONFIRMATION, SOCIAL → keep 'full'
      }
    }
    // else 'full' — IDLE state with no prior context or low NLU confidence

    // (Emergency hint removed — no pre-LLM keyword detection, LLM handles intent)

    // Knowledge graph → prompt focus override:
    // If knowledge graph matched a service code, ensure we use 'service' focus
    if (promptFocus === 'full' && graphContext) {
      promptFocus = 'service';
    }
    
    logger.debug('[UnifiedProcessor] Adaptive prompt focus', {
      userId, fsmState, currentIntent, promptFocus,
      nluMessageType: unified?.message_type, nluConfidence: unified?.confidence,
    });

    let systemPrompt: string;
    let messageCount: number;
    
    if (channel === 'webchat' && resolvedHistory) {
      const villageName = templateContext?.villageName || (await getVillageProfileSummary(resolvedVillageId))?.name || undefined;
      const contextResult = await buildContextWithHistory(userId, sanitizedMessage, resolvedHistory, preloadedRAGContext, resolvedVillageId, promptFocus, villageName);
      systemPrompt = contextResult.systemPrompt;
      messageCount = contextResult.messageCount;
    } else {
      // Build complaint categories and service catalog text for WhatsApp channel too
      const complaintCategoriesText = await buildComplaintCategoriesText(resolvedVillageId);
      const serviceCatalogText = await buildServiceCatalogText(resolvedVillageId);
      const villageName = templateContext?.villageName || (await getVillageProfileSummary(resolvedVillageId))?.name || undefined;
      const contextResult = await buildContext(userId, sanitizedMessage, preloadedRAGContext, complaintCategoriesText, promptFocus, villageName, serviceCatalogText);
      systemPrompt = contextResult.systemPrompt;
      messageCount = contextResult.messageCount;
    }
    
    // Inject language, sentiment, profile, conversation, graph context
    const allContexts = [
      languageContext,
      sentimentContext,
      profileContext,
      conversationContextStr,
      adaptationContext,
      graphContext,
    ].filter(Boolean).join('\n');
    
    if (allContexts) {
      systemPrompt = systemPrompt.replace(
        'PESAN TERAKHIR USER:',
        `${allContexts}\n\nPESAN TERAKHIR USER:`
      );
    }
    
    // Step 8: Call LLM
    // Update status: thinking
    tracker.thinking();
    const llmResult = await callGemini(systemPrompt);
    
    if (!llmResult) {
      throw new Error('LLM call failed - all models exhausted');
    }
    
    const { response: llmResponse, metrics } = llmResult;

    // Record actual token usage for main chat call
    recordTokenUsage({
      model: metrics.model,
      input_tokens: metrics.inputTokens,
      output_tokens: metrics.outputTokens,
      total_tokens: metrics.totalTokens,
      layer_type: 'full_nlu',
      call_type: 'main_chat',
      village_id: input.villageId,
      wa_user_id: userId,
      session_id: userId,
      channel,
      intent: llmResponse.intent,
      success: true,
      duration_ms: metrics.durationMs,
      key_source: metrics.keySource,
      key_id: metrics.keyId,
      key_tier: metrics.keyTier,
    });

    // Anti-hallucination gate — multi-layer approach:
    // 1. Regex detection (fast, free) to identify potential hallucination signals
    // 2. Micro-LLM validation (cheap, ~10x less tokens than full retry) to confirm
    // 3. Full LLM retry only for confirmed fake links (always hallucination)
    const hasKnowledge = hasKnowledgeInPrompt(systemPrompt);
    // Extract knowledge text early for cross-referencing in anti-hallucination
    const knowledgeMatch = systemPrompt.match(/KNOWLEDGE BASE YANG TERSEDIA:\n([\s\S]*?)(?:\n\[CONFIDENCE:|$)/);
    const knowledgeText = knowledgeMatch?.[1] || '';
    const gate = needsAntiHallucinationRetry({
      replyText: llmResponse.reply_text,
      guidanceText: llmResponse.guidance_text,
      hasKnowledge,
      knowledgeText,
    });

    if (gate.shouldRetry) {
      logAntiHallucinationEvent({
        userId,
        channel,
        reason: gate.reason,
        model: metrics.model,
      });

      // For fake links → always sanitize (no LLM needed, regex is sufficient)
      if (gate.reason?.includes('link palsu')) {
        if (llmResult.response.reply_text) {
          llmResult.response.reply_text = sanitizeFakeLinks(llmResult.response.reply_text);
        }
        if (llmResult.response.guidance_text) {
          llmResult.response.guidance_text = sanitizeFakeLinks(llmResult.response.guidance_text);
        }
      } else if (hasKnowledge) {
        // Has knowledge → use micro-LLM to validate against knowledge (cheap check)
        const responseText = [llmResult.response.reply_text, llmResult.response.guidance_text].filter(Boolean).join(' ');
        
        if (knowledgeText) {
          const validation = await validateResponseAgainstKnowledge(responseText, knowledgeText, {
            village_id: input.villageId,
            wa_user_id: userId,
            session_id: userId,
            channel,
          });
          
          if (validation?.has_hallucination) {
            logger.warn('[UnifiedProcessor] Micro-LLM confirmed hallucination', {
              userId, issues: validation.issues,
            });
            // Only do full retry if micro-LLM confirms hallucination
            const retryPrompt = appendAntiHallucinationInstruction(systemPrompt);
            const retryResult = await callGemini(retryPrompt);
            if (retryResult?.response?.reply_text) {
              recordTokenUsage({
                model: retryResult.metrics.model,
                input_tokens: retryResult.metrics.inputTokens,
                output_tokens: retryResult.metrics.outputTokens,
                total_tokens: retryResult.metrics.totalTokens,
                layer_type: 'full_nlu',
                call_type: 'anti_hallucination_retry',
                village_id: input.villageId,
                wa_user_id: userId,
                session_id: userId,
                channel,
                intent: retryResult.response.intent,
                success: true,
                duration_ms: retryResult.metrics.durationMs,
                key_source: retryResult.metrics.keySource,
                key_id: retryResult.metrics.keyId,
                key_tier: retryResult.metrics.keyTier,
              });
              llmResult.response = retryResult.response;
            }
          }
          // else: micro-LLM says no hallucination → skip expensive full retry (saves ~5000 tokens)
        }
      } else {
        // No knowledge context + hallucination signals → full retry with anti-hallucination instruction
        const retryPrompt = appendAntiHallucinationInstruction(systemPrompt);
        const retryResult = await callGemini(retryPrompt);
        if (retryResult?.response?.reply_text) {
          recordTokenUsage({
            model: retryResult.metrics.model,
            input_tokens: retryResult.metrics.inputTokens,
            output_tokens: retryResult.metrics.outputTokens,
            total_tokens: retryResult.metrics.totalTokens,
            layer_type: 'full_nlu',
            call_type: 'anti_hallucination_retry',
            village_id: input.villageId,
            wa_user_id: userId,
            session_id: userId,
            channel,
            intent: retryResult.response.intent,
            success: true,
            duration_ms: retryResult.metrics.durationMs,
            key_source: retryResult.metrics.keySource,
            key_id: retryResult.metrics.keyId,
            key_tier: retryResult.metrics.keyTier,
          });
          llmResult.response = retryResult.response;
        }
      }
    }

    // ── Post-processing sanitization pipeline ──
    // Runs on EVERY final response to catch hallucinations that slipped through.
    if (llmResult.response.reply_text) {
      llmResult.response.reply_text = sanitizeFakeLinks(llmResult.response.reply_text);
    }
    if (llmResult.response.guidance_text) {
      llmResult.response.guidance_text = sanitizeFakeLinks(llmResult.response.guidance_text);
    }
    // Remove fabricated phone numbers when no knowledge context is present
    if (!hasKnowledge) {
      const FAKE_PHONE_PATTERN = /\b0\d{2,3}[-.\s]?\d{4,8}\b/g;
      if (llmResult.response.reply_text && FAKE_PHONE_PATTERN.test(llmResult.response.reply_text)) {
        llmResult.response.reply_text = llmResult.response.reply_text.replace(FAKE_PHONE_PATTERN, '[nomor telepon tersedia di kantor]');
        logger.warn('[UnifiedProcessor] Sanitized fabricated phone number from reply');
      }
    }
    
    // Track analytics (skip during evaluation)
    if (!isEvaluation) {
      aiAnalyticsService.recordIntent(
        userId,
        llmResult.response.intent,
        metrics.durationMs,
        systemPrompt.length,
        llmResult.response.reply_text.length,
        metrics.model
      );
    }
    
    logger.info('[UnifiedProcessor] LLM response received', {
      userId,
      channel,
      intent: llmResult.response.intent,
      durationMs: metrics.durationMs,
    });
    
    // Update status: preparing response
    tracker.preparing();
    
    // Step 9: Handle intent
    const effectiveLlmResponse = llmResult.response;

    // If webhook already resolved tenant, enforce it deterministically.
    if (input.villageId) {
      effectiveLlmResponse.fields = {
        ...(effectiveLlmResponse.fields || {}),
        village_id: input.villageId,
      } as any;
    }

    effectiveLlmResponse.fields = {
      ...(effectiveLlmResponse.fields || {}),
      _original_message: message,
    } as any;

    let finalReplyText = effectiveLlmResponse.reply_text;
    let guidanceText = effectiveLlmResponse.guidance_text || '';
    let resultContacts: ProcessMessageResult['contacts'] | undefined;

    // Emergency auto-category removed — LLM handles intent and category classification.
    // is_urgent flag comes from DB complaintTypeConfig after LLM determines kategori.

    // ── Confidence-based intent validation (3-tier) ──
    // Tier 1: confidence < 0.4 → demote to QUESTION (ask clarification)
    // Tier 2: confidence 0.4-0.6 → proceed but add clarification prompt to guidance_text
    // Tier 3: confidence > 0.6 → proceed normally
    const llmConfidence = typeof effectiveLlmResponse.confidence === 'number' ? effectiveLlmResponse.confidence : 0.8;
    const isActionIntent = !['QUESTION', 'UNKNOWN', 'KNOWLEDGE_QUERY'].includes(effectiveLlmResponse.intent);
    
    if (llmConfidence < 0.4 && isActionIntent) {
      logger.info('[UnifiedProcessor] Very low LLM confidence, demoting to QUESTION', {
        userId, originalIntent: effectiveLlmResponse.intent, confidence: llmConfidence,
      });
      // Override intent, but keep LLM's reply_text if it looks like a clarification question
      effectiveLlmResponse.intent = 'QUESTION' as any;
      // Ensure reply_text asks for clarification
      if (!effectiveLlmResponse.reply_text || effectiveLlmResponse.reply_text.length < 10) {
        effectiveLlmResponse.reply_text = 'Mohon maaf, bisa dijelaskan lebih detail apa yang Bapak/Ibu butuhkan? Kami ingin memastikan bisa membantu dengan tepat.';
      }
    } else if (llmConfidence < 0.6 && isActionIntent) {
      // Medium confidence: proceed but add a soft confirmation in guidance_text
      logger.info('[UnifiedProcessor] Medium LLM confidence, adding clarification prompt', {
        userId, intent: effectiveLlmResponse.intent, confidence: llmConfidence,
      });
      const existingGuidance = effectiveLlmResponse.guidance_text || '';
      effectiveLlmResponse.guidance_text = existingGuidance 
        ? `${existingGuidance}\n\nJika ini bukan yang Bapak/Ibu maksud, mohon jelaskan kembali ya.`
        : 'Jika ini bukan yang Bapak/Ibu maksud, mohon jelaskan kembali ya.';
    }

    // Service slug resolution: when LLM detected SERVICE_INFO/CREATE_SERVICE_REQUEST
    // but didn't extract the specific service_slug, try to resolve it from the message
    // using micro-LLM semantic search (NOT pattern matching)
    if (['SERVICE_INFO', 'CREATE_SERVICE_REQUEST'].includes(effectiveLlmResponse.intent)) {
      const hasServiceRef = !!(effectiveLlmResponse.fields?.service_slug || effectiveLlmResponse.fields?.service_id);
      if (!hasServiceRef) {
        const resolved = await resolveServiceSlugFromSearch(message, resolvedVillageId);
        if (resolved?.slug) {
          const existingServiceName = (effectiveLlmResponse.fields as any)?.service_name;
          effectiveLlmResponse.fields = {
            ...(effectiveLlmResponse.fields || {}),
            service_slug: resolved.slug,
            service_name: resolved.name || existingServiceName,
          } as any;
        }
      }
    }
    
    switch (effectiveLlmResponse.intent) {
      case 'CREATE_COMPLAINT':
        const rateLimitCheck = rateLimiterService.checkRateLimit(userId);
        if (!rateLimitCheck.allowed) {
          finalReplyText = rateLimitCheck.message || 'Anda telah mencapai batas laporan hari ini.';
        } else {
          const complaintHandlerResult = normalizeHandlerResult(await handleComplaintCreation(userId, channel, effectiveLlmResponse, message, mediaUrl));
          finalReplyText = complaintHandlerResult.replyText;
          if (complaintHandlerResult.contacts?.length) {
            resultContacts = complaintHandlerResult.contacts;
          }
        }
        break;
      
      case 'SERVICE_INFO':
        {
          const serviceInfoResult = normalizeHandlerResult(await handleServiceInfo(userId, effectiveLlmResponse, channel));
          finalReplyText = serviceInfoResult.replyText;
          if (serviceInfoResult.guidanceText && !guidanceText) {
            guidanceText = serviceInfoResult.guidanceText;
          }
        }
        break;
      
      case 'CREATE_SERVICE_REQUEST':
        finalReplyText = await handleServiceRequestCreation(userId, channel, effectiveLlmResponse);
        break;

      case 'UPDATE_COMPLAINT':
        finalReplyText = await handleComplaintUpdate(userId, channel, effectiveLlmResponse, message);
        break;

      case 'UPDATE_SERVICE_REQUEST':
        finalReplyText = await handleServiceRequestEditLink(userId, channel, effectiveLlmResponse);
        break;
      
      case 'CHECK_STATUS':
        finalReplyText = await handleStatusCheck(userId, channel, effectiveLlmResponse, message);
        break;
      
      case 'CANCEL_COMPLAINT':
        finalReplyText = await handleCancellationRequest(userId, 'laporan', effectiveLlmResponse);
        break;

      case 'CANCEL_SERVICE_REQUEST':
        finalReplyText = await handleCancellationRequest(userId, 'layanan', effectiveLlmResponse);
        break;
      
      case 'HISTORY':
        finalReplyText = await handleHistory(userId, channel);
        break;
      
      case 'KNOWLEDGE_QUERY':
        if (preloadedRAGContext && typeof preloadedRAGContext === 'object' && preloadedRAGContext.contextString) {
          effectiveLlmResponse.fields = {
            ...(effectiveLlmResponse.fields || {}),
            _preloaded_knowledge_context: preloadedRAGContext.contextString,
          } as any;
        }
        {
          const kqResult = normalizeHandlerResult(await handleKnowledgeQuery(userId, message, effectiveLlmResponse, finalReplyText, channel));
          finalReplyText = kqResult.replyText;
          if (kqResult.contacts?.length) resultContacts = kqResult.contacts;
        }
        break;
      
      case 'QUESTION':
        // If LLM explicitly says needs_knowledge=true, or if RAG context was preloaded,
        // route through knowledge handler for a more informed answer
        if (effectiveLlmResponse.needs_knowledge && preloadedRAGContext && typeof preloadedRAGContext === 'object' && preloadedRAGContext.contextString) {
          effectiveLlmResponse.fields = {
            ...(effectiveLlmResponse.fields || {}),
            _preloaded_knowledge_context: preloadedRAGContext.contextString,
          } as any;
          const kqResult2 = normalizeHandlerResult(await handleKnowledgeQuery(userId, message, effectiveLlmResponse, finalReplyText, channel));
          finalReplyText = kqResult2.replyText;
          if (kqResult2.contacts?.length) resultContacts = kqResult2.contacts;
        } else if (unified?.categories?.includes('kontak')) {
          // NLU detected contact category — force route to knowledge handler for contact lookup
          // This catches cases where LLM classified as QUESTION but user is asking for contacts
          logger.info('[UnifiedProcessor] QUESTION with contact category, routing to knowledge handler', { userId });
          effectiveLlmResponse.fields = {
            ...(effectiveLlmResponse.fields || {}),
            village_id: resolvedVillageId,
            knowledge_category: 'kontak',
          } as any;
          const kqResult3 = normalizeHandlerResult(await handleKnowledgeQuery(userId, message, effectiveLlmResponse, finalReplyText, channel));
          finalReplyText = kqResult3.replyText;
          if (kqResult3.contacts?.length) resultContacts = kqResult3.contacts;
        }
        // else: use LLM reply as-is (greeting, chitchat, etc.)
        break;

      case 'UNKNOWN':
      default:
        // If UNKNOWN and reply is empty/generic, provide smart clarification
        if (!finalReplyText || finalReplyText.length < 10) {
          finalReplyText = 'Mohon maaf Pak/Bu, saya kurang mengerti maksudnya. Bisa dijelaskan lebih detail?\n\nSaya bisa membantu:\n1. Layanan surat/dokumen\n2. Pengaduan/laporan masalah\n3. Cek status layanan/pengaduan\n4. Informasi desa (jadwal, kontak, prosedur)';
        }
        break;
    }
    
    // Step 9.4: Track category usage analytics
    if (!isEvaluation) {
      const intent = effectiveLlmResponse.intent;
      if (intent === 'CREATE_COMPLAINT' || intent === 'UPDATE_COMPLAINT') {
        const kategori = (effectiveLlmResponse.fields as any)?.kategori || (effectiveLlmResponse.fields as any)?.category;
        if (kategori) aiAnalyticsService.recordCategoryUsage('complaint', String(kategori));
      } else if (intent === 'SERVICE_INFO' || intent === 'CREATE_SERVICE_REQUEST' || intent === 'UPDATE_SERVICE_REQUEST') {
        const serviceSlug = (effectiveLlmResponse.fields as any)?.service_slug || (effectiveLlmResponse.fields as any)?.service_name;
        if (serviceSlug) aiAnalyticsService.recordCategoryUsage('service', String(serviceSlug));
      } else if (intent === 'KNOWLEDGE_QUERY') {
        const knowledgeCat = (effectiveLlmResponse.fields as any)?.knowledge_category || 'general';
        aiAnalyticsService.recordCategoryUsage('knowledge', String(knowledgeCat));
      }
    }

    // Step 9.5: Track knowledge hit/miss for analytics
    // Records whether the knowledge base had relevant content for this query.
    // QUESTION intent is excluded — it covers greetings, names, acknowledgments,
    // and generic replies that are NOT real knowledge-seeking queries.
    // Only KNOWLEDGE_QUERY and SERVICE_INFO represent actual knowledge needs.
    if (!isEvaluation) {
      const knowledgeIntent = effectiveLlmResponse.intent;
      const isKnowledgeSeeking = ['KNOWLEDGE_QUERY', 'SERVICE_INFO'].includes(knowledgeIntent)
        || effectiveLlmResponse.needs_knowledge === true;
      if (isKnowledgeSeeking) {
        const ragConf = typeof preloadedRAGContext === 'object' ? preloadedRAGContext.confidence?.level : undefined;
        const confLevel = (ragConf as any) || 'none';
        aiAnalyticsService.recordKnowledge({
          query: message.substring(0, 200),
          intent: knowledgeIntent,
          confidence: confLevel,
          channel,
          villageId: resolvedVillageId,
          hasKnowledge: !!(preloadedRAGContext && typeof preloadedRAGContext === 'object' && preloadedRAGContext.contextString),
        });

        // Persist knowledge gaps to Dashboard DB (fire-and-forget) for admin visibility
        if (confLevel === 'none' || confLevel === 'low') {
          reportKnowledgeGap({
            query: message.substring(0, 500),
            intent: knowledgeIntent,
            confidence: confLevel,
            channel,
            villageId: resolvedVillageId,
          });
        }
      }
    }

    // Step 10: Validate response
    const validatedReply = validateResponse(finalReplyText);
    const validatedGuidance = guidanceText ? validateResponse(guidanceText) : undefined;
    
    // Step 10.5: Adapt response based on sentiment, profile, and context
    const adaptedResult = adaptResponse(validatedReply, userId, sentiment, validatedGuidance);
    const finalResponse = adaptedResult.response;
    const finalGuidance = adaptedResult.guidanceText;
    
    // Step 10.6: Update conversation context
    updateContext(userId, {
      currentIntent: effectiveLlmResponse.intent,
      intentConfidence: 0.8, // Default confidence since Micro NLU handles intent now
      collectedData: effectiveLlmResponse.fields,
      missingFields: effectiveLlmResponse.fields?.missing_info || [],
    });
    
    const processingTimeMs = Date.now() - startTime;
    
    // Update status: complete
    tracker.complete();
    
    // Append AI response to conversation history cache (keeps cache fresh for next message)
    if (channel === 'whatsapp') {
      appendToHistoryCache(userId, 'assistant', finalResponse);
    }
    
    logger.info('✅ [UnifiedProcessor] Message processed', {
      userId,
      channel,
      intent: effectiveLlmResponse.intent,
      processingTimeMs,
    });
    
    // Save cacheable responses for future use (FAQ, knowledge, greetings) — skip during eval
    if (!isEvaluation) {
      setCachedResponse(message, finalResponse, effectiveLlmResponse.intent, finalGuidance);
    }
    
    return {
      success: true,
      response: finalResponse,
      guidanceText: finalGuidance,
      contacts: resultContacts,
      intent: llmResponse.intent,
      fields: llmResponse.fields,
      metadata: {
        processingTimeMs,
        model: metrics.model,
        hasKnowledge: !!preloadedRAGContext,
        knowledgeConfidence: typeof preloadedRAGContext === 'object' ? preloadedRAGContext.confidence?.level : undefined,
        sentiment: sentiment.level !== 'neutral' ? sentiment.level : undefined,
        language: languageDetection.primary !== 'indonesian' ? languageDetection.primary : undefined,
        traceId,
      },
    };
    
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
