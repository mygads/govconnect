/**
 * Two-Layer Webchat Service
 * 
 * Synchronous 2-Layer processing for webchat channel.
 * Adapts the async 2-Layer architecture for HTTP request/response flow.
 * 
 * This service provides the same 2-Layer benefits (better accuracy, intent understanding)
 * but returns results synchronously instead of publishing to RabbitMQ.
 */

import logger from '../utils/logger';
import { ProcessMessageResult } from './unified-message-processor.service';
import { callLayer1LLM, applyTypoCorrections } from './layer1-llm.service';
import { callLayer2LLM, generateFallbackResponse } from './layer2-llm.service';
import { extractAllEntities, extractCitizenDataFromHistory } from './entity-extractor.service';
import { sanitizeUserInput } from './context-builder.service';
import { analyzeSentiment } from './sentiment-analysis.service';
import { isSpamMessage } from './rag.service';
import { aiAnalyticsService } from './ai-analytics.service';
import { getKelurahanInfoContext, getRAGContext } from './knowledge.service';
import { shouldRetrieveContext } from './rag.service';

// Import action handlers
import {
  handleComplaintCreation,
  handleServiceInfo,
  handleServiceRequestCreation,
  handleStatusCheck,
  handleCancellation,
  handleComplaintUpdate,
  handleHistory,
  handleKnowledgeQuery,
  getPendingServiceFormOffer,
  clearPendingServiceFormOffer,
  isConfirmationResponse,
} from './ai-orchestrator.service';
import { classifyConfirmation } from './confirmation-classifier.service';

interface TwoLayerWebchatParams {
  userId: string;
  message: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  village_id?: string;
}

/**
 * Process webchat message using 2-Layer architecture (synchronous)
 */
export async function processTwoLayerWebchat(params: TwoLayerWebchatParams): Promise<ProcessMessageResult> {
  const startTime = Date.now();
  const { userId, message, conversationHistory, village_id } = params;

  logger.info('🎯 Processing webchat with 2-Layer architecture', {
    userId,
    messageLength: message.length,
  });

  try {
    // Step 1: Spam check
    if (isSpamMessage(message)) {
      logger.warn('🚫 Spam detected in webchat', { userId });
      return {
        success: true,
        response: 'Maaf, pesan tidak dapat diproses.',
        intent: 'SPAM',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false },
      };
    }

    // Step 2: Sanitize and preprocess
    let sanitizedMessage = sanitizeUserInput(message);
    sanitizedMessage = applyTypoCorrections(sanitizedMessage);

    // Full LLM mode: always use 2-Layer architecture for webchat

    // Step 2.1: Pending online service form offer (2-step flow)
    const pendingOffer = getPendingServiceFormOffer(userId);
    if (pendingOffer) {
      const trimmed = sanitizedMessage.trim();
      const wantsFormLink = /\b(link|tautan|formulir|form|online)(nya)?\b/i.test(trimmed);
      const isNegative = /^(tidak|ga|gak|nggak|belum|nanti|skip|batal)\b/i.test(trimmed);
      const confirmationResult = await classifyConfirmation(trimmed);
      const isLikelyConfirm = confirmationResult && confirmationResult.decision === 'CONFIRM' && confirmationResult.confidence >= 0.7;
      const isLikelyReject = confirmationResult && confirmationResult.decision === 'REJECT' && confirmationResult.confidence >= 0.7;

      if (isLikelyConfirm || isConfirmationResponse(trimmed) || wantsFormLink) {
        clearPendingServiceFormOffer(userId);
        const llmLike = {
          intent: 'CREATE_SERVICE_REQUEST',
          fields: {
            service_slug: pendingOffer.service_slug,
            ...(pendingOffer.village_id ? { village_id: pendingOffer.village_id } : {}),
          },
          reply_text: '',
        };

        const reply = await handleServiceRequestCreation(userId, 'webchat', llmLike);
        return {
          success: true,
          response: reply,
          intent: 'CREATE_SERVICE_REQUEST',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false },
        };
      }

      if (isLikelyReject || isNegative) {
        clearPendingServiceFormOffer(userId);
        return {
          success: true,
          response: 'Baik Kak, siap. Kalau Kakak mau proses nanti, kabari saya ya. 😊',
          intent: 'QUESTION',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false },
        };
      }

      return {
        success: true,
        response: 'Mau saya kirim link formulirnya sekarang? Balas *iya* atau *tidak* ya Kak.',
        intent: 'QUESTION',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false },
      };
    }

    // Step 2.2: Deterministic office/contact info (avoid L2 hallucination)
    const officeInfoPattern = /(alamat|lokasi|maps|google\s*maps|jam|operasional|buka|tutup|hari\s*kerja|kontak|hubungi|telepon|telp|call\s*center|hotline|\bnomor\b)/i;
    const trackingPattern = /(\b(LAP|LAY)-\d{8}-\d{3}\b)/i;
    if (officeInfoPattern.test(sanitizedMessage) && !trackingPattern.test(sanitizedMessage)) {
      const llmLike = {
        intent: 'KNOWLEDGE_QUERY',
        fields: {
          ...(village_id ? { village_id } : {}),
        },
        reply_text: '',
        guidance_text: '',
        needs_knowledge: true,
      };

      const deterministic = await handleKnowledgeQuery(userId, sanitizedMessage, llmLike);
      return {
        success: true,
        response: deterministic,
        intent: 'KNOWLEDGE_QUERY',
        metadata: {
          processingTimeMs: Date.now() - startTime,
          hasKnowledge: true,
        },
      };
    }

    // Step 3: Sentiment analysis
    const sentiment = analyzeSentiment(sanitizedMessage, userId);

    // Step 5: Pre-extract entities
    const historyText = conversationHistory?.map(m => m.content).join(' | ') || '';
    const preExtractedEntities = extractAllEntities(sanitizedMessage, historyText);

    // Step 6: Layer 1 - Intent & Understanding
    logger.info('🔍 Layer 1 - Intent & Understanding', { userId });

    const layer1Output = await callLayer1LLM({
      message: sanitizedMessage,
      wa_user_id: userId,
      conversation_history: historyText,
      pre_extracted_data: preExtractedEntities.entities,
    });

    if (!layer1Output) {
      logger.error('❌ Layer 1 failed', { userId });
      return {
        success: false,
        response: 'Maaf, terjadi kesalahan. Silakan coba lagi.',
        intent: 'ERROR',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false },
      };
    }

    // Step 7: Enhance with history data
    const enhancedLayer1 = await enhanceWithHistory(layer1Output, userId);

    logger.info('✅ Layer 1 completed', {
      userId,
      intent: enhancedLayer1.intent,
      confidence: enhancedLayer1.confidence,
    });

    const infoInquiryPattern = /(\?|\b(syarat|persyaratan|berkas|dokumen|info|informasi|biaya|lama|alur|panduan|cara|prosedur|gimana|bagaimana)\b)/i;
    const serviceKeywordPattern = /\b(kk|kartu\s+keluarga|ktp|akta|surat|izin|domisili|usaha|nikah|beda\s+nama|pindah|kia)\b/i;
    const wantsInquiry = infoInquiryPattern.test(sanitizedMessage) || serviceKeywordPattern.test(sanitizedMessage);

    if (wantsInquiry && enhancedLayer1.intent === 'CREATE_SERVICE_REQUEST') {
      const mockLlmResponse = {
        intent: 'SERVICE_INFO',
        fields: {
          ...enhancedLayer1.extracted_data,
          ...(village_id ? { village_id } : {}),
          _original_message: sanitizedMessage,
        },
        reply_text: '',
        guidance_text: '',
        needs_knowledge: false,
      };

      const serviceInfoResult = normalizeServiceHandlerOutput(await handleServiceInfo(userId, mockLlmResponse));
      return {
        success: true,
        response: serviceInfoResult.replyText,
        guidanceText: serviceInfoResult.guidanceText || undefined,
        intent: 'SERVICE_INFO',
        metadata: {
          processingTimeMs: Date.now() - startTime,
          model: 'two-layer',
          hasKnowledge: false,
        },
      };
    }

    // Step 8: Layer 2 - Response Generation
    logger.info('💬 Layer 2 - Response Generation', { userId });

    let knowledgeContext = '';
    try {
      const isGreeting = /^(halo|hai|hi|hello|selamat\s+(pagi|siang|sore|malam)|assalamualaikum|permisi)/i.test(sanitizedMessage.trim());
      const looksLikeQuestion = shouldRetrieveContext(sanitizedMessage);

      if (isGreeting) {
        const info = await getKelurahanInfoContext(village_id || process.env.DEFAULT_VILLAGE_ID);
        if (info && info.trim()) {
          knowledgeContext = `KNOWLEDGE BASE YANG TERSEDIA:\n${info}`;
        }
      } else if (looksLikeQuestion) {
        const rag = await getRAGContext(sanitizedMessage, undefined, village_id || process.env.DEFAULT_VILLAGE_ID);
        if (rag?.totalResults > 0 && rag.contextString) {
          knowledgeContext = `KNOWLEDGE BASE YANG TERSEDIA:\n${rag.contextString}`;
        }
      }
    } catch (error: any) {
      logger.warn('⚠️ Webchat knowledge prefetch failed', { userId, error: error.message });
    }

    let layer2Output = await callLayer2LLM({
      layer1_output: enhancedLayer1,
      wa_user_id: userId,
      conversation_context: [historyText, knowledgeContext].filter(Boolean).join('\n\n'),
      user_name: enhancedLayer1.extracted_data.nama_lengkap,
    });

    if (!layer2Output) {
      logger.warn('⚠️ Layer 2 failed, using fallback', { userId });
      layer2Output = generateFallbackResponse(enhancedLayer1);
    }

    // Step 9: Handle actions if needed
    let finalResponse = layer2Output.reply_text;
    let guidanceText = layer2Output.guidance_text || '';

    const applyVerbPattern = /\b(ajukan|daftar|buat|bikin|mohon|minta|proses|kirim|ajukan|submit)\b/i;
    const serviceNounPattern = /\b(layanan|surat|izin|permohonan|pelayanan)\b/i;
    const wantsFormPattern = /\b(link|tautan|formulir|form|online)\b/i;

    const looksLikeInquiry = infoInquiryPattern.test(sanitizedMessage);
    const explicitApplyRequest = (applyVerbPattern.test(sanitizedMessage) || wantsFormPattern.test(sanitizedMessage)) && serviceNounPattern.test(sanitizedMessage);

    if (looksLikeInquiry && !explicitApplyRequest) {
      if (layer2Output.next_action === 'CREATE_SERVICE_REQUEST') {
        layer2Output.next_action = 'SERVICE_INFO';
      } else if (enhancedLayer1.intent === 'CREATE_SERVICE_REQUEST') {
        layer2Output.next_action = 'SERVICE_INFO';
      }
    }

    const shouldHandleAction = !!layer2Output.next_action
      && (enhancedLayer1.confidence >= 0.7 || layer2Output.next_action === 'SERVICE_INFO');

    if (shouldHandleAction) {
      const nextAction = layer2Output.next_action as string;

      finalResponse = await handleWebchatAction(
        nextAction,
        enhancedLayer1,
        layer2Output,
        userId,
        sanitizedMessage,
        village_id
      );

      if (nextAction === 'CREATE_SERVICE_REQUEST') {
        guidanceText = '';
      }
    } else if (enhancedLayer1.intent === 'SERVICE_INFO') {
      const mockLlmResponse = {
        intent: enhancedLayer1.intent,
        fields: {
          ...enhancedLayer1.extracted_data,
          ...(village_id ? { village_id } : {}),
          _original_message: sanitizedMessage,
        },
        reply_text: layer2Output.reply_text,
        guidance_text: layer2Output.guidance_text,
        needs_knowledge: layer2Output.needs_knowledge,
      };

      const serviceInfoResult = normalizeServiceHandlerOutput(await handleServiceInfo(userId, mockLlmResponse));
      finalResponse = serviceInfoResult.replyText;
      guidanceText = serviceInfoResult.guidanceText || '';
    }

    // Step 10: Record analytics
    const processingTimeMs = Date.now() - startTime;
    aiAnalyticsService.recordIntent(
      userId,
      enhancedLayer1.intent,
      processingTimeMs,
      sanitizedMessage.length,
      finalResponse.length,
      'two-layer-webchat'
    );

    logger.info('✅ 2-Layer webchat completed', {
      userId,
      intent: enhancedLayer1.intent,
      processingTimeMs,
    });

    return {
      success: true,
      response: finalResponse,
      guidanceText: guidanceText || undefined,
      intent: enhancedLayer1.intent,
      metadata: {
        processingTimeMs,
        model: 'two-layer',
        hasKnowledge: layer2Output.needs_knowledge || false,
        knowledgeConfidence: String(enhancedLayer1.confidence),
        sentiment: sentiment.level,
      },
    };

  } catch (error: any) {
    logger.error('❌ 2-Layer webchat error', { userId, error: error.message });

    return {
      success: false,
      response: 'Maaf, terjadi kesalahan saat memproses pesan. Silakan coba lagi.',
      intent: 'ERROR',
      metadata: {
        processingTimeMs: Date.now() - startTime,
        hasKnowledge: false,
      },
    };
  }
}


/**
 * Enhance Layer 1 output with conversation history data
 */
async function enhanceWithHistory(layer1Output: any, userId: string): Promise<any> {
  try {
    const historyData = await extractCitizenDataFromHistory(userId, { limit: 10 });

    if (!historyData) return layer1Output;

    const enhanced = { ...layer1Output };

    for (const [key, value] of Object.entries(historyData)) {
      const currentValue = enhanced.extracted_data[key];

      if ((!currentValue || currentValue === '') && value) {
        enhanced.extracted_data[key] = value;
      }
    }

    // Recalculate confidence
    const filledFields = Object.values(enhanced.extracted_data).filter(v => v && v !== '').length;
    if (filledFields > Object.values(layer1Output.extracted_data).filter((v: any) => v && v !== '').length) {
      enhanced.confidence = Math.min(0.95, enhanced.confidence + 0.1);
    }

    return enhanced;
  } catch (error) {
    return layer1Output;
  }
}

function normalizeServiceHandlerOutput(result: string | { replyText: string; guidanceText?: string }): { replyText: string; guidanceText?: string } {
  if (typeof result === 'string') {
    return { replyText: result };
  }
  return {
    replyText: result.replyText,
    guidanceText: result.guidanceText,
  };
}

/**
 * Handle webchat-specific actions
 */
async function handleWebchatAction(
  action: string,
  layer1Output: any,
  layer2Output: any,
  userId: string,
  message: string,
  village_id?: string
): Promise<string> {
  logger.info('🎬 Handling webchat action', { userId, action });

  try {
    const mockLlmResponse = {
      intent: layer1Output.intent,
      fields: {
        ...layer1Output.extracted_data,
        ...(village_id ? { village_id } : {}),
        _original_message: message,
      },
      reply_text: layer2Output.reply_text,
      guidance_text: layer2Output.guidance_text,
      needs_knowledge: layer2Output.needs_knowledge,
    };

    switch (action) {
      case 'CREATE_COMPLAINT':
        return await handleComplaintCreation(userId, 'webchat', mockLlmResponse, message);

      case 'SERVICE_INFO':
        return normalizeServiceHandlerOutput(await handleServiceInfo(userId, mockLlmResponse)).replyText;

      case 'CREATE_SERVICE_REQUEST':
        return await handleServiceRequestCreation(userId, 'webchat', mockLlmResponse);

      case 'UPDATE_COMPLAINT':
        return await handleComplaintUpdate(userId, 'webchat', mockLlmResponse);

      case 'CHECK_STATUS':
        return await handleStatusCheck(userId, 'webchat', mockLlmResponse);

      case 'CANCEL_COMPLAINT':
        return await handleCancellation(userId, 'webchat', mockLlmResponse);

      case 'HISTORY':
        return await handleHistory(userId, 'webchat');

      case 'KNOWLEDGE_QUERY':
        return await handleKnowledgeQuery(userId, message, mockLlmResponse);

      default:
        return layer2Output.reply_text;
    }
  } catch (error: any) {
    logger.error('Webchat action failed', { userId, action, error: error.message });
    return layer2Output.reply_text;
  }
}

export default { processTwoLayerWebchat };
