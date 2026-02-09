/**
 * AI Orchestrator Service
 * 
 * WhatsApp-specific message processing orchestrator.
 * Uses unified-message-processor.service.ts for core AI logic.
 * 
 * This file handles WhatsApp-specific concerns:
 * - Typing indicators
 * - Message status (read receipts)
 * - Takeover mode
 * - RabbitMQ publishing
 * - Batched messages
 * 
 * Core AI logic (NLU, intent detection, RAG, handlers) is in unified-message-processor.service.ts
 */

import logger from '../utils/logger';
import { MessageReceivedEvent } from '../types/event.types';
import { publishAIReply, publishMessageStatus, addToAIRetryQueue } from './rabbitmq.service';
import { isAIChatbotEnabled } from './settings.service';
import { startTyping, stopTyping, isUserInTakeover, markMessagesAsRead } from './channel-client.service';
import { isSpamMessage } from './rag.service';

// Re-export all handlers from unified processor for backward compatibility
export {
  handleComplaintCreation,
  handleComplaintUpdate,
  handleServiceInfo,
  handleServiceRequestCreation,
  handleStatusCheck,
  handleCancellationRequest,
  handleHistory,
  handleKnowledgeQuery,
  validateResponse,
  isVagueAddress,
  detectEmergencyComplaint,
  processUnifiedMessage,
  getPendingAddressConfirmation,
  clearPendingAddressConfirmation,
  setPendingAddressConfirmation,
  getPendingServiceFormOffer,
  clearPendingServiceFormOffer,
  setPendingServiceFormOffer,
} from './unified-message-processor.service';

import { processUnifiedMessage } from './unified-message-processor.service';

/**
 * Main orchestration logic - processes incoming WhatsApp messages
 * 
 * This function handles WhatsApp-specific concerns:
 * - Typing indicators
 * - Message status (read receipts)
 * - Takeover mode
 * - RabbitMQ publishing
 * 
 * Core AI logic is delegated to unified-message-processor.service.ts
 */
export async function processMessage(event: MessageReceivedEvent): Promise<void> {
  const { 
    village_id,
    wa_user_id, 
    message, 
    message_id, 
    has_media, 
    media_url, 
    media_public_url, 
    media_type, 
    is_batched, 
    batched_message_ids 
  } = event;
  
  // Validate required fields
  if (!wa_user_id || !message || !message_id) {
    logger.error('❌ Invalid message event - missing required fields', {
      hasWaUserId: !!wa_user_id,
      hasMessage: !!message,
      hasMessageId: !!message_id,
    });
    return;
  }
  
  logger.info('🎯 Processing WhatsApp message', {
    village_id,
    wa_user_id,
    message_id,
    messageLength: message.length,
    hasMedia: has_media,
    mediaType: media_type,
    isBatched: is_batched,
    batchCount: batched_message_ids?.length,
  });
  
  // Mark messages as read in WhatsApp
  const messageIdsToRead = is_batched && batched_message_ids ? batched_message_ids : [message_id];
  markMessagesAsRead(wa_user_id, messageIdsToRead, village_id).catch((err) => {
    logger.warn('Failed to mark messages as read', { error: err.message });
  });
  
  // Notify that we're processing
  if (is_batched && batched_message_ids) {
    await publishMessageStatus({
      village_id,
      wa_user_id,
      message_ids: batched_message_ids,
      status: 'processing',
    });
  }
  
  try {
    // Check if AI chatbot is enabled
    const aiEnabled = await isAIChatbotEnabled();
    if (!aiEnabled) {
      logger.info('⏸️ AI chatbot is disabled', { wa_user_id, message_id });
      if (is_batched && batched_message_ids) {
        await publishMessageStatus({ village_id, wa_user_id, message_ids: batched_message_ids, status: 'completed' });
      }
      return;
    }
    
    // Check if user is in takeover mode
    const takeover = await isUserInTakeover(wa_user_id, village_id);
    if (takeover) {
      logger.info('👤 User is in takeover mode', { wa_user_id, message_id });
      if (is_batched && batched_message_ids) {
        await publishMessageStatus({ village_id, wa_user_id, message_ids: batched_message_ids, status: 'completed' });
      }
      return;
    }
    
    // Spam check
    if (isSpamMessage(message)) {
      logger.warn('🚫 Spam message detected', { wa_user_id, message_id });
      if (is_batched && batched_message_ids) {
        await publishMessageStatus({ village_id, wa_user_id, message_ids: batched_message_ids, status: 'completed' });
      }
      return;
    }
    
    // Start typing indicator
    await startTyping(wa_user_id, village_id);
    
    // ============================================
    // DELEGATE TO UNIFIED MESSAGE PROCESSOR
    // ============================================
    const result = await processUnifiedMessage({
      userId: wa_user_id,
      message: message,
      channel: 'whatsapp',
      mediaUrl: media_public_url || media_url,
      mediaType: media_type,
      villageId: village_id,
    });
    
    // Stop typing indicator
    await stopTyping(wa_user_id, village_id);
    
    if (!result.success && result.error === 'Spam message detected') {
      if (is_batched && batched_message_ids) {
        await publishMessageStatus({ village_id, wa_user_id, message_ids: batched_message_ids, status: 'completed' });
      }
      return;
    }
    
    // Publish AI reply
    await publishAIReply({
      village_id,
      wa_user_id,
      reply_text: result.response,
      guidance_text: result.guidanceText,
      message_id: is_batched ? undefined : message_id,
      batched_message_ids: is_batched ? batched_message_ids : undefined,
    });
    
    // Mark messages as completed
    if (is_batched && batched_message_ids) {
      await publishMessageStatus({
        village_id,
        wa_user_id,
        message_ids: batched_message_ids,
        status: 'completed',
      });
    }
    
    logger.info('✅ WhatsApp message processed successfully', {
      wa_user_id,
      message_id,
      intent: result.intent,
      processingTimeMs: result.metadata.processingTimeMs,
    });
    
  } catch (error: any) {
    // Stop typing indicator on error
    await stopTyping(wa_user_id, village_id);
    
    logger.error('❌ Failed to process WhatsApp message', {
      wa_user_id,
      message_id,
      error: error.message,
      isBatched: is_batched,
    });
    
    // Add to AI retry queue
    addToAIRetryQueue(event, error.message || 'Unknown error');
  }
}


