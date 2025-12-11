/**
 * Two-Layer LLM Orchestrator Service
 * 
 * Coordinates Layer 1 (Intent & Understanding) and Layer 2 (Response Generation)
 * for better accuracy, reliability, and cost efficiency
 * 
 * Flow:
 * 1. Layer 1: Understand intent, extract data, normalize language
 * 2. Validation: Check data completeness and confidence
 * 3. Layer 2: Generate natural, helpful responses
 * 4. Post-processing: Handle actions (create complaint/reservation, etc.)
 */

import logger from '../utils/logger';
import { MessageReceivedEvent } from '../types/event.types';
import { callLayer1LLM, Layer1Output, applyTypoCorrections } from './layer1-llm.service';
import { callLayer2LLM, Layer2Output, generateFallbackResponse } from './layer2-llm.service';
import { publishAIReply, publishAIError, publishMessageStatus } from './rabbitmq.service';
import { isAIChatbotEnabled } from './settings.service';
import { startTyping, stopTyping, isUserInTakeover, markMessagesAsRead } from './channel-client.service';
import { rateLimiterService } from './rate-limiter.service';
import { aiAnalyticsService } from './ai-analytics.service';
import { isSpamMessage } from './rag.service';
import { sanitizeUserInput } from './context-builder.service';
import { detectLanguage, getLanguageContext } from './language-detection.service';
import { analyzeSentiment, getSentimentContext, needsHumanEscalation } from './sentiment-analysis.service';

// Import action handlers from original orchestrator
import { 
  handleComplaintCreation,
  handleReservationCreation,
  handleStatusCheck,
  handleCancellation,
  handleReservationCancellation,
  handleReservationUpdate,
  handleHistory,
  handleKnowledgeQuery,
} from './ai-orchestrator.service';

/**
 * Main 2-Layer processing function
 */
export async function processTwoLayerMessage(event: MessageReceivedEvent): Promise<void> {
  const { wa_user_id, message, message_id, has_media, media_url, media_public_url, media_type, media_caption, is_batched, batched_message_ids, original_messages } = event;
  
  // Validate required fields
  if (!wa_user_id || !message || !message_id) {
    logger.error('❌ Invalid message event - missing required fields', {
      hasWaUserId: !!wa_user_id,
      hasMessage: !!message,
      hasMessageId: !!message_id,
    });
    return;
  }
  
  logger.info('🎯 Processing 2-Layer message', {
    wa_user_id,
    message_id,
    messageLength: message.length,
    hasMedia: has_media,
    mediaType: media_type,
    isBatched: is_batched,
    batchCount: batched_message_ids?.length,
  });
  
  // Mark messages as read
  const messageIdsToRead = is_batched && batched_message_ids 
    ? batched_message_ids 
    : [message_id];
  
  markMessagesAsRead(wa_user_id, messageIdsToRead).catch((err) => {
    logger.warn('Failed to mark messages as read', { error: err.message });
  });
  
  // Notify processing status (for both single and batched messages)
  await publishMessageStatus({
    wa_user_id,
    message_ids: is_batched && batched_message_ids ? batched_message_ids : [message_id],
    status: 'processing',
  });
  
  try {
    // Step 0: Pre-checks
    const aiEnabled = await isAIChatbotEnabled();
    if (!aiEnabled) {
      logger.info('⏸️ AI chatbot is disabled, skipping message processing', { wa_user_id, message_id });
      await publishMessageStatus({
        wa_user_id,
        message_ids: is_batched && batched_message_ids ? batched_message_ids : [message_id],
        status: 'completed',
      });
      return;
    }
    
    const takeover = await isUserInTakeover(wa_user_id);
    if (takeover) {
      logger.info('👤 User is in takeover mode, admin will handle this message', { wa_user_id, message_id });
      await publishMessageStatus({
        wa_user_id,
        message_ids: is_batched && batched_message_ids ? batched_message_ids : [message_id],
        status: 'completed',
      });
      return;
    }
    
    // Step 0.1: Spam check
    if (isSpamMessage(message)) {
      logger.warn('🚫 Spam message detected, ignoring', {
        wa_user_id,
        message_id,
        messagePreview: message.substring(0, 50),
      });
      await publishMessageStatus({
        wa_user_id,
        message_ids: is_batched && batched_message_ids ? batched_message_ids : [message_id],
        status: 'completed',
      });
      return;
    }
    
    // Step 0.2: Input sanitization and basic typo correction
    let sanitizedMessage = sanitizeUserInput(message);
    sanitizedMessage = applyTypoCorrections(sanitizedMessage);
    
    logger.info('📝 Message preprocessed', {
      wa_user_id,
      originalLength: message.length,
      sanitizedLength: sanitizedMessage.length,
      typosCorrected: message !== sanitizedMessage,
    });
    
    // Step 0.3: Language and sentiment analysis
    const languageDetection = detectLanguage(sanitizedMessage);
    const sentiment = analyzeSentiment(sanitizedMessage, wa_user_id);
    
    if (needsHumanEscalation(wa_user_id)) {
      logger.warn('🚨 User needs human escalation', {
        wa_user_id,
        sentiment: sentiment.level,
        score: sentiment.score,
      });
    }
    
    // Step 1: Start typing indicator
    await startTyping(wa_user_id);
    
    // Step 2: LAYER 1 - Intent & Understanding
    logger.info('🔍 Starting Layer 1 - Intent & Understanding', { wa_user_id });
    
    const layer1Input = {
      message: sanitizedMessage,
      wa_user_id,
      conversation_history: await getConversationHistory(wa_user_id),
    };
    
    const layer1Output = await callLayer1LLM(layer1Input);
    
    if (!layer1Output) {
      logger.error('❌ Layer 1 failed completely', { wa_user_id });
      await stopTyping(wa_user_id);
      throw new Error('Layer 1 LLM failure - all models exhausted');
    }
    
    logger.info('✅ Layer 1 completed', {
      wa_user_id,
      intent: layer1Output.intent,
      confidence: layer1Output.confidence,
      extractedDataKeys: Object.keys(layer1Output.extracted_data),
      needsClarification: layer1Output.needs_clarification.length,
    });
    
    // Step 3: Data validation and enhancement
    const enhancedLayer1Output = await enhanceLayer1Output(layer1Output, wa_user_id);
    
    // Step 4: LAYER 2 - Response Generation
    logger.info('💬 Starting Layer 2 - Response Generation', { wa_user_id });
    
    const layer2Input = {
      layer1_output: enhancedLayer1Output,
      wa_user_id,
      conversation_context: await getConversationContext(wa_user_id),
      user_name: enhancedLayer1Output.extracted_data.nama_lengkap,
    };
    
    let layer2Output = await callLayer2LLM(layer2Input);
    
    if (!layer2Output) {
      logger.warn('⚠️ Layer 2 failed, using fallback', { wa_user_id });
      layer2Output = generateFallbackResponse(enhancedLayer1Output);
    }
    
    logger.info('✅ Layer 2 completed', {
      wa_user_id,
      replyLength: layer2Output.reply_text.length,
      hasGuidance: !!layer2Output.guidance_text,
      nextAction: layer2Output.next_action,
      confidence: layer2Output.confidence,
    });
    
    // Step 5: Stop typing indicator
    await stopTyping(wa_user_id);
    
    // Step 6: Handle actions based on intent
    let finalReplyText = layer2Output.reply_text;
    let guidanceText = layer2Output.guidance_text || '';
    
    if (layer2Output.next_action && enhancedLayer1Output.confidence >= 0.7) {
      finalReplyText = await handleAction(
        layer2Output.next_action,
        enhancedLayer1Output,
        layer2Output,
        wa_user_id,
        sanitizedMessage,
        media_public_url || media_url
      );
    }
    
    // Step 7: Validate and sanitize final response
    finalReplyText = validateResponse(finalReplyText);
    if (guidanceText) {
      guidanceText = validateResponse(guidanceText);
    }
    
    // Step 8: Record analytics
    aiAnalyticsService.recordIntent(
      wa_user_id,
      enhancedLayer1Output.intent,
      Date.now(), // We'll calculate duration in analytics
      sanitizedMessage.length,
      finalReplyText.length,
      'two-layer-architecture'
    );
    
    // Step 9: Publish AI reply
    await publishAIReply({
      wa_user_id,
      reply_text: finalReplyText,
      guidance_text: guidanceText || undefined,
      message_id: is_batched ? undefined : message_id,
      batched_message_ids: is_batched ? batched_message_ids : undefined,
    });
    
    // Mark as completed (for both single and batched messages)
    await publishMessageStatus({
      wa_user_id,
      message_ids: is_batched && batched_message_ids ? batched_message_ids : [message_id],
      status: 'completed',
    });
    
    logger.info('✅ 2-Layer message processed successfully', {
      wa_user_id,
      message_id,
      intent: enhancedLayer1Output.intent,
      layer1Confidence: enhancedLayer1Output.confidence,
      layer2Confidence: layer2Output.confidence,
      hasGuidance: !!guidanceText,
      isBatched: is_batched,
    });
    
  } catch (error: any) {
    await stopTyping(wa_user_id);
    
    logger.error('❌ Failed to process 2-layer message', {
      wa_user_id,
      message_id,
      error: error.message,
      isBatched: is_batched,
    });
    
    // Add to retry queue
    const { addToAIRetryQueue } = await import('./rabbitmq.service');
    addToAIRetryQueue(event, error.message || 'Unknown error');
    
    // Mark as failed (for both single and batched messages)
    await publishMessageStatus({
      wa_user_id,
      message_ids: is_batched && batched_message_ids ? batched_message_ids : [message_id],
      status: 'failed',
      error_message: error.message,
    });
  }
}

/**
 * Enhance Layer 1 output with additional data extraction from history
 */
async function enhanceLayer1Output(layer1Output: Layer1Output, wa_user_id: string): Promise<Layer1Output> {
  // ALWAYS try to enhance with history data for better multi-step conversation support
  logger.info('🔍 Enhancing Layer 1 output with history data', { 
    wa_user_id, 
    originalConfidence: layer1Output.confidence,
    needsClarification: layer1Output.needs_clarification.length,
  });
  
  try {
    // Extract citizen data from conversation history
    const historyData = await extractCitizenDataFromHistoryInternal(wa_user_id);
    
    if (historyData) {
      // Merge history data with Layer 1 extracted data (history data fills gaps)
      const enhanced = { ...layer1Output };
      const originalData = enhanced.extracted_data;
      
      // Smart merge: only use history data if Layer 1 didn't extract it or extracted it poorly
      for (const [key, value] of Object.entries(historyData)) {
        const currentValue = originalData[key as keyof typeof originalData];
        
        // Use history data if:
        // 1. Current value is empty/null/undefined
        // 2. Current value is very short (< 3 chars) and history value is longer
        // 3. For specific fields that are commonly missed by Layer 1
        const shouldUseHistoryValue = 
          !currentValue || 
          currentValue === '' ||
          (typeof currentValue === 'string' && currentValue.length < 3 && value && value.toString().length > currentValue.length) ||
          (key === 'alamat' && (!currentValue || currentValue.length < 5) && value && value.toString().length >= 5);
        
        if (shouldUseHistoryValue && value) {
          (enhanced.extracted_data as any)[key] = value;
          logger.info(`✅ Enhanced ${key} from history`, {
            wa_user_id,
            original: currentValue,
            enhanced: value,
          });
        }
      }
      
      // Recalculate confidence based on data completeness and quality
      const originalDataKeys = Object.keys(originalData).filter(key => {
        const value = originalData[key as keyof typeof originalData];
        return value !== undefined && value !== null && value !== '';
      });
      
      const enhancedDataKeys = Object.keys(enhanced.extracted_data).filter(key => {
        const value = enhanced.extracted_data[key as keyof typeof enhanced.extracted_data];
        return value !== undefined && value !== null && value !== '';
      });
      
      // Boost confidence if we added meaningful data
      if (enhancedDataKeys.length > originalDataKeys.length) {
        const confidenceBoost = Math.min(0.3, (enhancedDataKeys.length - originalDataKeys.length) * 0.1);
        enhanced.confidence = Math.min(0.95, enhanced.confidence + confidenceBoost);
        enhanced.processing_notes += ` | Enhanced with ${enhancedDataKeys.length - originalDataKeys.length} fields from history`;
      }
      
      // Update needs_clarification based on enhanced data
      const updatedClarifications = enhanced.needs_clarification.filter(field => {
        const enhancedValue = enhanced.extracted_data[field as keyof typeof enhanced.extracted_data];
        return !enhancedValue || enhancedValue === '';
      });
      enhanced.needs_clarification = updatedClarifications;
      
      logger.info('✅ Layer 1 output enhanced', {
        wa_user_id,
        originalDataKeys: originalDataKeys.length,
        enhancedDataKeys: enhancedDataKeys.length,
        originalConfidence: layer1Output.confidence,
        newConfidence: enhanced.confidence,
        clarificationsReduced: layer1Output.needs_clarification.length - enhanced.needs_clarification.length,
        remainingClarifications: enhanced.needs_clarification,
      });
      
      return enhanced;
    } else {
      logger.info('No history data found for enhancement', { wa_user_id });
    }
  } catch (error: any) {
    logger.warn('Failed to enhance Layer 1 output', { wa_user_id, error: error.message });
  }
  
  return layer1Output;
}

/**
 * Extract citizen data from conversation history (internal implementation)
 */
async function extractCitizenDataFromHistoryInternal(wa_user_id: string): Promise<{
  nama_lengkap?: string;
  nik?: string;
  alamat?: string;
  no_hp?: string;
  keperluan?: string;
} | null> {
  const axios = (await import('axios')).default;
  const { config } = await import('../config/env');
  
  try {
    const url = `${config.channelServiceUrl}/internal/messages`;
    const response = await axios.get(url, {
      params: { wa_user_id, limit: 20 },
      headers: { 'x-internal-api-key': config.internalApiKey },
      timeout: 5000,
    });
    
    const messages = response.data?.messages || [];
    const result: { nama_lengkap?: string; nik?: string; alamat?: string; no_hp?: string; keperluan?: string } = {};
    
    const userMessages = messages
      .filter((m: any) => m.direction === 'IN')
      .map((m: any) => m.message_text)
      .join(' ');
    
    // Extract NIK
    const nikMatch = userMessages.match(/(?:nik|NIK)[\s:]+(\d{16})/);
    if (nikMatch) result.nik = nikMatch[1];
    else {
      const standaloneNik = userMessages.match(/\b(\d{16})\b/);
      if (standaloneNik) result.nik = standaloneNik[1];
    }
    
    // Extract phone
    const phoneMatch = userMessages.match(/\b(08\d{8,11})\b/);
    if (phoneMatch) result.no_hp = phoneMatch[1];
    
    // Extract name
    const nameMatch = userMessages.match(/nama\s+saya\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/i);
    if (nameMatch && nameMatch[1]) {
      const name = nameMatch[1].trim();
      if (name.length >= 2 && name.length <= 50 && !/\d/.test(name)) {
        result.nama_lengkap = name;
      }
    }
    
    // Extract address
    const addressMatch = userMessages.match(/tinggal\s+di\s+(.+?)(?:\s*,?\s*(?:untuk|mau|nik|hp)|\s*$)/i);
    if (addressMatch && addressMatch[1].length >= 5) {
      result.alamat = addressMatch[1].trim().replace(/,\s*$/, '');
    }
    
    return Object.keys(result).length > 0 ? result : null;
  } catch (error: any) {
    logger.warn('Failed to extract citizen data from history', { wa_user_id, error: error.message });
    return null;
  }
}

/**
 * Handle actions based on intent
 */
async function handleAction(
  action: string,
  layer1Output: Layer1Output,
  layer2Output: Layer2Output,
  wa_user_id: string,
  message: string,
  mediaUrl?: string
): Promise<string> {
  
  logger.info('🎬 Handling action', { wa_user_id, action, intent: layer1Output.intent });
  
  try {
    // Create mock LLM response format for compatibility with existing handlers
    const mockLlmResponse = {
      intent: layer1Output.intent,
      fields: layer1Output.extracted_data,
      reply_text: layer2Output.reply_text,
      guidance_text: layer2Output.guidance_text,
      needs_knowledge: layer2Output.needs_knowledge,
    };
    
    switch (action) {
      case 'CREATE_COMPLAINT':
        return await handleComplaintCreation(wa_user_id, mockLlmResponse, message, mediaUrl);
      
      case 'CREATE_RESERVATION':
        return await handleReservationCreation(wa_user_id, mockLlmResponse);
      
      case 'CHECK_STATUS':
        return await handleStatusCheck(wa_user_id, mockLlmResponse);
      
      case 'CANCEL_COMPLAINT':
        return await handleCancellation(wa_user_id, mockLlmResponse);
      
      case 'CANCEL_RESERVATION':
        return await handleReservationCancellation(wa_user_id, mockLlmResponse);
      
      case 'UPDATE_RESERVATION':
        return await handleReservationUpdate(wa_user_id, mockLlmResponse);
      
      case 'HISTORY':
        return await handleHistory(wa_user_id);
      
      case 'KNOWLEDGE_QUERY':
        return await handleKnowledgeQuery(wa_user_id, message, mockLlmResponse);
      
      default:
        logger.info('No specific action handler, using Layer 2 response', { wa_user_id, action });
        return layer2Output.reply_text;
    }
  } catch (error: any) {
    logger.error('Action handler failed', { wa_user_id, action, error: error.message });
    return layer2Output.reply_text; // Fallback to Layer 2 response
  }
}

/**
 * Get conversation history for Layer 1 context
 */
async function getConversationHistory(wa_user_id: string): Promise<string> {
  try {
    const axios = (await import('axios')).default;
    const { config } = await import('../config/env');
    
    const url = `${config.channelServiceUrl}/internal/messages`;
    const response = await axios.get(url, {
      params: { wa_user_id, limit: 5 },
      headers: { 'x-internal-api-key': config.internalApiKey },
      timeout: 3000,
    });
    
    const messages = response.data?.messages || [];
    return messages
      .filter((m: any) => m.direction === 'IN')
      .map((m: any) => m.message_text)
      .join(' | ');
  } catch (error) {
    return '';
  }
}

/**
 * Get conversation context for Layer 2
 */
async function getConversationContext(wa_user_id: string): Promise<string> {
  try {
    const axios = (await import('axios')).default;
    const { config } = await import('../config/env');
    
    const url = `${config.channelServiceUrl}/internal/messages`;
    const response = await axios.get(url, {
      params: { wa_user_id, limit: 3 },
      headers: { 'x-internal-api-key': config.internalApiKey },
      timeout: 3000,
    });
    
    const messages = response.data?.messages || [];
    return messages
      .map((m: any) => `${m.direction === 'IN' ? 'User' : 'Gana'}: ${m.message_text}`)
      .join('\n');
  } catch (error) {
    return 'Percakapan baru';
  }
}

/**
 * Validate response (imported from original orchestrator)
 */
function validateResponse(response: string): string {
  if (!response || response.trim().length === 0) {
    return 'Ada yang bisa saya bantu lagi?';
  }
  
  let cleaned = response;
  
  // Ensure response isn't too long
  if (cleaned.length > 4000) {
    cleaned = cleaned.substring(0, 3950) + '...\n\nPesan terpotong karena terlalu panjang.';
  }
  
  // Remove code artifacts
  if (cleaned.includes('```') || cleaned.includes('{\"')) {
    logger.warn('Response contains code artifacts, cleaning...');
    cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
    cleaned = cleaned.replace(/\{\"[\s\S]*?\}/g, '');
    cleaned = cleaned.trim();
    
    if (cleaned.length < 10) {
      return 'Maaf, terjadi kesalahan. Silakan ulangi pertanyaan Anda.';
    }
  }
  
  return cleaned;
}