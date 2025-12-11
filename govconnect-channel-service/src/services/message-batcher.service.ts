/**
 * Message Batcher Service
 * 
 * Batches multiple messages from the same user within a time window
 * to prevent spam and reduce AI API calls.
 * 
 * How it works:
 * 1. When a message comes in, add to batch for that user
 * 2. Set/reset a timer for BATCH_DELAY_MS (default 5 seconds)
 * 3. When timer expires, combine all messages and send to AI as one request
 * 4. AI responds once for all batched messages
 */

import logger from '../utils/logger';
import { publishEvent, isConnected as isRabbitConnected } from './rabbitmq.service';
import { rabbitmqConfig } from '../config/rabbitmq';
import { getPendingMessagesForUser, markMessagesAsProcessing } from './pending-message.service';

// Configuration
const BATCH_DELAY_MS = parseInt(process.env.MESSAGE_BATCH_DELAY_MS || '3000', 10); // 3 seconds default
const MAX_BATCH_SIZE = parseInt(process.env.MAX_BATCH_SIZE || '10', 10); // Max messages per batch

interface BatchedMessage {
  message_id: string;
  message_text: string;
  received_at: string;
  has_media?: boolean;
  media_type?: string;
  media_url?: string;
  media_public_url?: string;
}

interface UserBatch {
  wa_user_id: string;
  messages: BatchedMessage[];
  timer: NodeJS.Timeout | null;
  first_message_at: number;
}

// In-memory batch storage (per user)
const userBatches = new Map<string, UserBatch>();

/**
 * Add message to batch for a user
 * Returns true if this is a new batch, false if added to existing batch
 */
export function addMessageToBatch(
  wa_user_id: string,
  message_id: string,
  message_text: string,
  received_at: string,
  mediaInfo?: {
    has_media?: boolean;
    media_type?: string;
    media_url?: string;
    media_public_url?: string;
  }
): { isNewBatch: boolean; batchSize: number } {
  const now = Date.now();
  
  let batch = userBatches.get(wa_user_id);
  let isNewBatch = false;
  
  if (!batch) {
    // Create new batch
    batch = {
      wa_user_id,
      messages: [],
      timer: null,
      first_message_at: now,
    };
    userBatches.set(wa_user_id, batch);
    isNewBatch = true;
    
    logger.info('📦 New message batch started', {
      wa_user_id,
      message_id,
      batch_delay_ms: BATCH_DELAY_MS,
    });
  }
  
  // Add message to batch
  batch.messages.push({
    message_id,
    message_text,
    received_at,
    has_media: mediaInfo?.has_media,
    media_type: mediaInfo?.media_type,
    media_url: mediaInfo?.media_url,
    media_public_url: mediaInfo?.media_public_url,
  });
  
  // Clear existing timer
  if (batch.timer) {
    clearTimeout(batch.timer);
    logger.debug('⏰ Batch timer reset (new message received)', {
      wa_user_id,
      batch_size: batch.messages.length,
    });
  }
  
  // Check if max batch size reached - process immediately
  if (batch.messages.length >= MAX_BATCH_SIZE) {
    logger.info('📦 Max batch size reached, processing immediately', {
      wa_user_id,
      batch_size: batch.messages.length,
    });
    processBatch(wa_user_id);
    return { isNewBatch, batchSize: 0 }; // Batch was processed
  }
  
  // Set new timer
  batch.timer = setTimeout(() => {
    processBatch(wa_user_id);
  }, BATCH_DELAY_MS);
  
  logger.info('📨 Message added to batch', {
    wa_user_id,
    message_id,
    batch_size: batch.messages.length,
    waiting_ms: BATCH_DELAY_MS,
  });
  
  return { isNewBatch, batchSize: batch.messages.length };
}

/**
 * Process a user's batch - combine messages and send to AI
 */
async function processBatch(wa_user_id: string): Promise<void> {
  const batch = userBatches.get(wa_user_id);
  
  if (!batch || batch.messages.length === 0) {
    logger.warn('Empty batch for user', { wa_user_id });
    userBatches.delete(wa_user_id);
    return;
  }
  
  // Clear timer if exists
  if (batch.timer) {
    clearTimeout(batch.timer);
    batch.timer = null;
  }
  
  // Get all messages
  const messages = [...batch.messages];
  const messageIds = messages.map(m => m.message_id);
  
  // Clear the batch
  userBatches.delete(wa_user_id);
  
  logger.info('📤 Processing message batch', {
    wa_user_id,
    message_count: messages.length,
    message_ids: messageIds,
    batch_duration_ms: Date.now() - batch.first_message_at,
  });
  
  // Combine messages into one text
  let combinedMessage: string;
  if (messages.length === 1) {
    combinedMessage = messages[0].message_text;
  } else {
    // Multiple messages - combine with context
    combinedMessage = messages
      .map((m, i) => m.message_text)
      .join('\n');
  }
  
  // Check if any message has media
  const hasMedia = messages.some(m => m.has_media);
  const mediaMessage = messages.find(m => m.has_media);
  
  // Mark all messages as processing
  try {
    await markMessagesAsProcessing(messageIds);
  } catch (error: any) {
    logger.warn('Failed to mark messages as processing', { error: error.message });
  }
  
  // Publish to RabbitMQ
  if (isRabbitConnected()) {
    try {
      await publishEvent(rabbitmqConfig.ROUTING_KEYS.MESSAGE_RECEIVED, {
        wa_user_id,
        message: combinedMessage,
        message_id: messages[messages.length - 1].message_id, // Use latest message ID as primary
        received_at: messages[messages.length - 1].received_at,
        // Batch info
        is_batched: messages.length > 1,
        batched_message_ids: messageIds,
        batch_count: messages.length,
        // Media from any message
        has_media: hasMedia,
        media_type: mediaMessage?.media_type,
        media_url: mediaMessage?.media_url,
        media_public_url: mediaMessage?.media_public_url,
      });
      
      logger.info('✅ Batched message sent to AI', {
        wa_user_id,
        message_count: messages.length,
        combined_length: combinedMessage.length,
      });
    } catch (error: any) {
      logger.error('Failed to publish batched message', {
        error: error.message,
        wa_user_id,
        message_ids: messageIds,
      });
    }
  } else {
    logger.warn('RabbitMQ not connected, batched messages in pending queue', {
      wa_user_id,
      message_ids: messageIds,
    });
  }
}

/**
 * Cancel batch for a user (e.g., when takeover starts)
 */
export function cancelBatch(wa_user_id: string): void {
  const batch = userBatches.get(wa_user_id);
  
  if (batch) {
    if (batch.timer) {
      clearTimeout(batch.timer);
    }
    userBatches.delete(wa_user_id);
    
    logger.info('🚫 Batch cancelled', {
      wa_user_id,
      cancelled_messages: batch.messages.length,
    });
  }
}

/**
 * Get current batch status for a user
 */
export function getBatchStatus(wa_user_id: string): {
  hasBatch: boolean;
  messageCount: number;
  waitingMs: number;
} {
  const batch = userBatches.get(wa_user_id);
  
  if (!batch) {
    return { hasBatch: false, messageCount: 0, waitingMs: 0 };
  }
  
  return {
    hasBatch: true,
    messageCount: batch.messages.length,
    waitingMs: Date.now() - batch.first_message_at,
  };
}

/**
 * Get all active batches (for monitoring)
 */
export function getAllBatches(): {
  wa_user_id: string;
  message_count: number;
  waiting_ms: number;
}[] {
  const result: { wa_user_id: string; message_count: number; waiting_ms: number }[] = [];
  const now = Date.now();
  
  userBatches.forEach((batch, wa_user_id) => {
    result.push({
      wa_user_id,
      message_count: batch.messages.length,
      waiting_ms: now - batch.first_message_at,
    });
  });
  
  return result;
}

/**
 * Force process all pending batches (for shutdown)
 */
export async function flushAllBatches(): Promise<void> {
  logger.info('🔄 Flushing all pending batches...', { count: userBatches.size });
  
  const userIds = Array.from(userBatches.keys());
  
  for (const wa_user_id of userIds) {
    await processBatch(wa_user_id);
  }
  
  logger.info('✅ All batches flushed');
}
