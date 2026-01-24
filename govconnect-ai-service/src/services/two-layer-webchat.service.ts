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
import { getCachedResponse, setCachedResponse } from './response-cache.service';

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
} from './ai-orchestrator.service';

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

    // Step 3: Check cache first
    const cached = getCachedResponse(sanitizedMessage);
    if (cached) {
      logger.info('📦 Cache HIT for webchat', { userId, intent: cached.intent });
      return {
        success: true,
        response: cached.response,
        guidanceText: cached.guidanceText,
        intent: cached.intent,
        metadata: {
          processingTimeMs: Date.now() - startTime,
          hasKnowledge: false,
        },
      };
    }

    // Step 4: Sentiment analysis
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

    // Step 8: Layer 2 - Response Generation
    logger.info('💬 Layer 2 - Response Generation', { userId });

    let layer2Output = await callLayer2LLM({
      layer1_output: enhancedLayer1,
      wa_user_id: userId,
      conversation_context: historyText,
      user_name: enhancedLayer1.extracted_data.nama_lengkap,
    });

    if (!layer2Output) {
      logger.warn('⚠️ Layer 2 failed, using fallback', { userId });
      layer2Output = generateFallbackResponse(enhancedLayer1);
    }

    // Step 9: Handle actions if needed
    let finalResponse = layer2Output.reply_text;
    let guidanceText = layer2Output.guidance_text || '';

    if (layer2Output.next_action && enhancedLayer1.confidence >= 0.7) {
      finalResponse = await handleWebchatAction(
        layer2Output.next_action,
        enhancedLayer1,
        layer2Output,
        userId,
        sanitizedMessage,
        village_id
      );
    }

    // Step 10: Cache response if cacheable
    setCachedResponse(sanitizedMessage, finalResponse, enhancedLayer1.intent, guidanceText);

    // Step 11: Record analytics
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
      },
      reply_text: layer2Output.reply_text,
      guidance_text: layer2Output.guidance_text,
      needs_knowledge: layer2Output.needs_knowledge,
    };

    switch (action) {
      case 'CREATE_COMPLAINT':
        return await handleComplaintCreation(userId, mockLlmResponse, message);

      case 'SERVICE_INFO':
        return await handleServiceInfo(userId, mockLlmResponse);

      case 'CREATE_SERVICE_REQUEST':
        return await handleServiceRequestCreation(userId, mockLlmResponse);

      case 'UPDATE_COMPLAINT':
        return await handleComplaintUpdate(userId, mockLlmResponse);

      case 'CHECK_STATUS':
        return await handleStatusCheck(userId, mockLlmResponse);

      case 'CANCEL_COMPLAINT':
        return await handleCancellation(userId, mockLlmResponse);

      case 'HISTORY':
        return await handleHistory(userId);

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
