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
import { markMessagesAsProcessing } from './pending-message.service';
import { 
  calculateAdaptiveDelay, 
  recordMessage as recordAdaptiveMessage,
  isLikelyStillTyping,
} from './adaptive-batcher.service';

// Configuration
// BATCH_DELAY_MS: Unified delay for both WhatsApp and Webchat batching
const DEFAULT_BATCH_DELAY_MS = parseInt(process.env.BATCH_DELAY_MS || process.env.MESSAGE_BATCH_DELAY_MS || '3000', 10); // 3 seconds default
const MAX_BATCH_SIZE = parseInt(process.env.MAX_BATCH_SIZE || '10', 10); // Max messages per batch
const USE_ADAPTIVE_BATCHING = process.env.USE_ADAPTIVE_BATCHING !== 'false'; // Enable by default
const PUBLISH_RETRY_DELAY_MS = parseInt(process.env.MESSAGE_BATCH_PUBLISH_RETRY_DELAY_MS || '5000', 10);

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
  village_id: string;
  wa_user_id: string;
  messages: BatchedMessage[];
  timer: NodeJS.Timeout | null;
  first_message_at: number;
}

// In-memory batch storage (per user)
const userBatches = new Map<string, UserBatch>();

function resolveVillageId(villageId?: string): string {
  return villageId || process.env.DEFAULT_VILLAGE_ID || 'default';
}

function batchKey(villageId: string, waUserId: string): string {
  return `${villageId}:${waUserId}`;
}

/**
 * Add message to batch for a user
 * Returns true if this is a new batch, false if added to existing batch
 */
export function addMessageToBatch(
  village_id: string | undefined,
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
): { isNewBatch: boolean; batchSize: number; adaptiveDelayMs?: number } {
  const now = Date.now();

  const resolvedVillageId = resolveVillageId(village_id);
  const key = batchKey(resolvedVillageId, wa_user_id);
  
  let batch = userBatches.get(key);
  let isNewBatch = false;
  
  // Calculate adaptive delay based on user typing patterns
  let batchDelayMs = DEFAULT_BATCH_DELAY_MS;
  
  if (USE_ADAPTIVE_BATCHING) {
    batchDelayMs = calculateAdaptiveDelay(wa_user_id, message_text.length);
    
    // Record message for future adaptive calculations
    recordAdaptiveMessage(wa_user_id, message_text.length);
    
    // Check if user is likely still typing
    if (batch && isLikelyStillTyping(wa_user_id, message_text.length, now - batch.first_message_at)) {
      // Extend delay slightly if user seems to be typing more
      batchDelayMs = Math.min(batchDelayMs + 500, 5000);
      logger.debug('⌨️ User likely still typing, extending delay', {
        wa_user_id,
        extendedDelayMs: batchDelayMs,
      });
    }
  }
  
  if (!batch) {
    // Create new batch
    batch = {
      village_id: resolvedVillageId,
      wa_user_id,
      messages: [],
      timer: null,
      first_message_at: now,
    };
    userBatches.set(key, batch);
    isNewBatch = true;
    
    logger.info('📦 New message batch started', {
      wa_user_id,
      message_id,
      batch_delay_ms: batchDelayMs,
      adaptive: USE_ADAPTIVE_BATCHING,
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
    processBatch(resolvedVillageId, wa_user_id);
    return { isNewBatch, batchSize: 0, adaptiveDelayMs: batchDelayMs }; // Batch was processed
  }
  
  // Set new timer with adaptive delay
  batch.timer = setTimeout(() => {
    processBatch(resolvedVillageId, wa_user_id);
  }, batchDelayMs);
  
  logger.info('📨 Message added to batch', {
    wa_user_id,
    message_id,
    batch_size: batch.messages.length,
    waiting_ms: batchDelayMs,
    adaptive: USE_ADAPTIVE_BATCHING,
  });
  
  return { isNewBatch, batchSize: batch.messages.length, adaptiveDelayMs: batchDelayMs };
}

/**
 * Process a user's batch - combine messages and send to AI
 */
async function processBatch(village_id: string, wa_user_id: string): Promise<void> {
  const resolvedVillageId = resolveVillageId(village_id);
  const key = batchKey(resolvedVillageId, wa_user_id);
  const batch = userBatches.get(key);
  
  if (!batch || batch.messages.length === 0) {
    logger.warn('Empty batch for user', { wa_user_id });
    userBatches.delete(key);
    return;
  }
  
  // Clear timer if exists
  if (batch.timer) {
    clearTimeout(batch.timer);
    batch.timer = null;
  }
  
  // Get all messages (do not clear the batch yet; we may need to retry publishing)
  const messages = [...batch.messages];
  const messageIds = messages.map(m => m.message_id);
  
  logger.info('📤 Processing message batch', {
    village_id: batch.village_id,
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
      .map((m) => m.message_text)
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
        village_id: batch.village_id,
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

      // Clear the batch only after publish succeeds
      userBatches.delete(key);
    } catch (error: any) {
      logger.error('Failed to publish batched message', {
        error: error.message,
        wa_user_id,
        message_ids: messageIds,
      });

      // Keep the batch and retry later
      batch.timer = setTimeout(() => {
        processBatch(resolvedVillageId, wa_user_id);
      }, PUBLISH_RETRY_DELAY_MS);
      logger.warn('🔁 Retrying batched publish later', {
        wa_user_id,
        message_ids: messageIds,
        retry_delay_ms: PUBLISH_RETRY_DELAY_MS,
      });
    }
  } else {
    // Keep the batch and retry later; do not drop messages during transient RabbitMQ outages.
    logger.warn('RabbitMQ not connected, deferring batched publish', {
      wa_user_id,
      message_ids: messageIds,
    });

    batch.timer = setTimeout(() => {
      processBatch(resolvedVillageId, wa_user_id);
    }, PUBLISH_RETRY_DELAY_MS);

    logger.warn('🔁 Will retry batched publish when RabbitMQ is back', {
      wa_user_id,
      message_ids: messageIds,
      retry_delay_ms: PUBLISH_RETRY_DELAY_MS,
    });
  }
}

/**
 * Cancel batch for a user (e.g., when takeover starts)
 */
export function cancelBatch(wa_user_id: string, village_id?: string): void {
  const resolvedVillageId = resolveVillageId(village_id);
  const key = batchKey(resolvedVillageId, wa_user_id);
  const batch = userBatches.get(key);
  
  if (batch) {
    if (batch.timer) {
      clearTimeout(batch.timer);
    }
    userBatches.delete(key);
    
    logger.info('🚫 Batch cancelled', {
      wa_user_id,
      cancelled_messages: batch.messages.length,
    });
  }
}

/**
 * Get current batch status for a user
 */
export function getBatchStatus(wa_user_id: string, village_id?: string): {
  hasBatch: boolean;
  messageCount: number;
  waitingMs: number;
} {
  const resolvedVillageId = resolveVillageId(village_id);
  const key = batchKey(resolvedVillageId, wa_user_id);
  const batch = userBatches.get(key);
  
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
  village_id: string;
  wa_user_id: string;
  message_count: number;
  waiting_ms: number;
}[] {
  const result: { village_id: string; wa_user_id: string; message_count: number; waiting_ms: number }[] = [];
  const now = Date.now();
  
  userBatches.forEach((batch) => {
    result.push({
      village_id: batch.village_id,
      wa_user_id: batch.wa_user_id,
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

  const batches = Array.from(userBatches.values());

  for (const batch of batches) {
    await processBatch(batch.village_id, batch.wa_user_id);
  }
  
  logger.info('✅ All batches flushed');
}
