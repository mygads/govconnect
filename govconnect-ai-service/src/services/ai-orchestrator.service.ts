/**
 * AI Orchestrator Service
 * 
 * WhatsApp-specific message processing orchestrator.
 * Uses unified-message-processor.service.ts for core AI logic.
 * 
 * This file handles WhatsApp-specific concerns:
 * - Typing indicators (smart: triggered at 60-80% processing completion)
 * - Message status (read receipts with 1s human-like delay)
 * - Takeover mode
 * - RabbitMQ publishing
 * - Spam guard (bubble chat + duplicate suppression)
 * - Fast greeting template (bypasses AI for common greetings from new users)
 * 
 * Human-like behavior:
 * - Read receipt: sent 1 second after message received (simulates reading)
 * - Typing indicator: starts when AI is ~60-80% done (simulates thinking → typing)
 * - Typing stops: just before sending the reply message
 * 
 * Core AI logic (NLU, intent detection, RAG, handlers) is in unified-message-processor.service.ts
 */

import logger from '../utils/logger';
import { MessageReceivedEvent } from '../types/event.types';
import { publishAIReply, publishMessageStatus, addToAIRetryQueue } from './rabbitmq.service';
import { isAIChatbotEnabled } from './settings.service';
import { startTyping, stopTyping, isUserInTakeover, markMessagesAsRead } from './channel-client.service';
import { isSpamMessage } from './rag.service';
import {
  registerProcessing,
  shouldSendResponse,
  completeProcessing,
} from './spam-guard.service';

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
  processUnifiedMessage,
  getPendingAddressConfirmation,
  clearPendingAddressConfirmation,
  setPendingAddressConfirmation,
  getPendingServiceFormOffer,
  clearPendingServiceFormOffer,
  setPendingServiceFormOffer,
} from './unified-message-processor.service';

import { processUnifiedMessage } from './unified-message-processor.service';

// ============================================
// CONSTANTS
// ============================================

/** Delay before sending read receipt (simulates human reading) */
const READ_RECEIPT_DELAY_MS = 1000;

/** 
 * Minimum progress (0-100) before starting the typing indicator.
 * 'thinking' = 60, 'preparing' = 80. Start at 'thinking' stage.
 */
const TYPING_START_MIN_PROGRESS = 60;

/**
 * Main orchestration logic - processes incoming WhatsApp messages
 * 
 * Human-like timing flow:
 * 1. Message received → AI processing starts IMMEDIATELY (no waiting)
 * 2. After 1 second delay → read receipt (blue ticks) sent
 * 3. When AI is ~60-80% done → typing indicator ("composing") starts
 * 4. AI finishes → typing stops → reply sent
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
  } = event;

  // Extract spam_guard info from event (sent by channel service)
  const spamGuardInfo = (event as any).spam_guard as {
    isDuplicate?: boolean;
    supersedePrevious?: boolean;
    suppressedMessageIds?: string[];
    contextMessages?: Array<{ messageId: string; text: string; receivedAt: string }>;
  } | undefined;
  
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
    spamGuard: spamGuardInfo,
  });

  // Register with spam guard (tracks in-flight processing for dedup)
  // With prefetch > 1, multiple messages are consumed concurrently.
  // registerProcessing() marks all previous in-flight messages as superseded.
  const spamRegistration = registerProcessing(village_id, wa_user_id, message_id, message, spamGuardInfo);
  
  // ============================================
  // DELAYED READ RECEIPT (human-like: 1 second delay)
  // Fire-and-forget — don't block AI processing
  // ============================================
  setTimeout(() => {
    markMessagesAsRead(wa_user_id, [message_id], village_id).catch((err) => {
      logger.warn('Failed to mark messages as read', { error: err.message });
    });
  }, READ_RECEIPT_DELAY_MS);
  
  try {
    // Check if AI chatbot is enabled
    const aiEnabled = await isAIChatbotEnabled();
    if (!aiEnabled) {
      logger.info('⏸️ AI chatbot is disabled', { wa_user_id, message_id });
      completeProcessing(village_id, wa_user_id, message_id);
      return;
    }
    
    // Check if user is in takeover mode
    const takeover = await isUserInTakeover(wa_user_id, village_id);
    if (takeover) {
      logger.info('👤 User is in takeover mode', { wa_user_id, message_id });
      completeProcessing(village_id, wa_user_id, message_id);
      return;
    }
    
    // Spam check (content-based: gambling, urls, etc.)
    if (isSpamMessage(message)) {
      logger.warn('🚫 Spam message detected', { wa_user_id, message_id });
      completeProcessing(village_id, wa_user_id, message_id);
      return;
    }
    
    // ============================================
    // PRE-CHECK: Skip AI processing if already superseded
    // With prefetch > 1, a newer message may have already registered
    // and superseded this one before we even start AI processing.
    // This saves LLM tokens by not processing messages that will be suppressed.
    // ============================================
    const preCheck = shouldSendResponse(village_id, wa_user_id, message_id);
    if (!preCheck.send) {
      logger.info('⏭️ Skipping AI processing (already superseded)', {
        wa_user_id,
        message_id,
        reason: preCheck.reason,
      });
      completeProcessing(village_id, wa_user_id, message_id);
      return;
    }

    // ============================================
    // SMART TYPING: Start typing when AI is ~60-80% done
    // Instead of starting typing immediately (feels robotic),
    // we use the onStageChange callback from UMP to start typing
    // when AI processing reaches the 'thinking' or 'preparing' stage.
    // This simulates: receive → read → think → start typing → send
    // ============================================
    let typingStarted = false;
    const onStageChange = (stage: string, progress: number) => {
      // Start typing when processing reaches 60%+ (thinking/preparing stage)
      if (!typingStarted && progress >= TYPING_START_MIN_PROGRESS) {
        typingStarted = true;
        startTyping(wa_user_id, village_id).catch((err) => {
          logger.warn('Failed to start typing indicator', { error: err.message });
        });
        logger.debug('⌨️ Smart typing started', {
          wa_user_id,
          message_id,
          stage,
          progress,
        });
      }
    };
    
    // ============================================
    // BUBBLE CHAT: Combine context from all bubble messages
    // If multiple messages arrived while AI was processing,
    // combine them into one message for AI to understand full context.
    // ============================================
    let aiMessage = message;
    
    if (spamGuardInfo?.contextMessages && spamGuardInfo.contextMessages.length > 1) {
      // Multiple messages in bubble - combine for AI context
      // Filter out identical duplicates (keep unique texts), but preserve order
      const seen = new Set<string>();
      const uniqueContexts: Array<{ text: string; receivedAt: string }> = [];
      
      for (const ctx of spamGuardInfo.contextMessages) {
        const normalized = ctx.text.trim();
        if (!seen.has(normalized)) {
          seen.add(normalized);
          uniqueContexts.push(ctx);
        }
      }
      
      if (uniqueContexts.length > 1) {
        // Build combined message with timestamps so AI understands the sequence
        const parts = uniqueContexts.map((ctx, i) => {
          const time = new Date(ctx.receivedAt).toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          });
          return `[${time}] ${ctx.text}`;
        });
        
        aiMessage = parts.join('\n');
        
        logger.info('💬 Bubble chat combined context', {
          wa_user_id,
          message_id,
          originalMessages: spamGuardInfo.contextMessages.length,
          uniqueMessages: uniqueContexts.length,
          combinedLength: aiMessage.length,
        });
      }
      // If only 1 unique text (all identical), just use the original message
    }
    
    // ============================================
    // DELEGATE TO UNIFIED MESSAGE PROCESSOR
    // Pass onStageChange callback for smart typing triggers
    // ============================================
    const result = await processUnifiedMessage({
      userId: wa_user_id,
      message: aiMessage,
      channel: 'whatsapp',
      mediaUrl: media_public_url || media_url,
      mediaType: media_type,
      villageId: village_id,
      onStageChange,
    });
    
    if (!result.success && result.error === 'Spam message detected') {
      if (typingStarted) await stopTyping(wa_user_id, village_id);
      completeProcessing(village_id, wa_user_id, message_id);
      return;
    }
    
    // ============================================
    // SPAM GUARD: Check if response should be sent
    // Re-check after AI processing — a newer message may have arrived
    // during the AI LLM call and superseded this one.
    // ============================================
    const sendCheck = shouldSendResponse(village_id, wa_user_id, message_id);
    
    if (!sendCheck.send) {
      // This message was superseded - don't send response to user
      // DON'T stop typing — the latest message is still being processed
      // and its handler will manage the typing indicator
      logger.info('🔄 Response suppressed by spam guard (bubble superseded)', {
        wa_user_id,
        message_id,
        reason: sendCheck.reason,
        allMessageIds: sendCheck.allMessageIds,
      });
      
      completeProcessing(village_id, wa_user_id, message_id);
      return;
    }
    
    // This is the latest message - send the response
    // Stop typing just before sending the actual reply (human-like gap)
    if (typingStarted) {
      await stopTyping(wa_user_id, village_id);
    }

    // Use allMessageIds to mark ALL identical messages as replied
    const allBatchedIds = sendCheck.allMessageIds.length > 0
      ? sendCheck.allMessageIds
      : [message_id];

    await publishAIReply({
      village_id,
      wa_user_id,
      reply_text: result.response,
      guidance_text: result.guidanceText,
      contacts: result.contacts,
      message_id: message_id,
      batched_message_ids: allBatchedIds,
    });
    
    // Mark all messages (including bubble/spam duplicates) as completed
    if (allBatchedIds && allBatchedIds.length > 0) {
      await publishMessageStatus({
        village_id,
        wa_user_id,
        message_ids: allBatchedIds,
        status: 'completed',
      });
    }
    
    completeProcessing(village_id, wa_user_id, message_id);
    
    logger.info('✅ WhatsApp message processed successfully', {
      wa_user_id,
      message_id,
      intent: result.intent,
      processingTimeMs: result.metadata.processingTimeMs,
      spamGuardSendCheck: sendCheck.reason,
      totalMarkedComplete: allBatchedIds?.length,
    });
    
  } catch (error: any) {
    // Stop typing indicator on error
    await stopTyping(wa_user_id, village_id);
    
    logger.error('❌ Failed to process WhatsApp message', {
      wa_user_id,
      message_id,
      error: error.message,
    });
    
    // Clean up spam guard state
    completeProcessing(village_id, wa_user_id, message_id);
    
    // Add to AI retry queue
    addToAIRetryQueue(event, error.message || 'Unknown error');
  }
}


