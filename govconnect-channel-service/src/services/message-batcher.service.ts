/**
 * Message Batcher Service (v2 - Immediate Forward)
 * 
 * No longer delays messages. Every message is forwarded to AI immediately.
 * Spam/duplicate handling is done by spam-guard.service.ts.
 * 
 * This service now simply:
 * 1. Receives pre-checked spam guard result from webhook controller
 * 2. Publishes to RabbitMQ immediately with combined context
 * 3. Marks superseded messages as completed
 * 
 * NOTE: Spam check now happens in webhook.controller.ts BEFORE saving to DB.
 * This service only handles the forwarding of already-approved messages.
 */

import logger from '../utils/logger';
import { publishEvent, isConnected as isRabbitConnected } from './rabbitmq.service';
import { rabbitmqConfig } from '../config/rabbitmq';
import { markMessagesAsProcessing, markMessagesAsCompleted } from './pending-message.service';
import { type SpamCheckResult } from './spam-guard.service';

const PUBLISH_RETRY_DELAY_MS = parseInt(process.env.MESSAGE_BATCH_PUBLISH_RETRY_DELAY_MS || '5000', 10);

function requireVillageId(villageId?: string): string {
  const normalizedVillageId = typeof villageId === 'string' ? villageId.trim() : '';
  if (!normalizedVillageId) {
    throw new Error('village_id is required for multi-tenancy isolation');
  }
  return normalizedVillageId;
}

// Track pending publishes for retry
const pendingRetries = new Map<string, NodeJS.Timeout>();

// Per-user delay debounce: holds publishing to AI for `reply_delay_seconds`
// so a burst of messages from the same user arrives as one combined context.
// Keyed by `village_id:wa_user_id`. Only one in-flight delay per user.
const pendingDelayedPublishes = new Map<string, NodeJS.Timeout>();

/**
 * Forward an already-approved message to AI.
 * Spam guard check has already been done in webhook controller.
 *
 * @param spamResult - Pre-computed spam guard result (shouldProcess must be true)
 * @param replyDelaySeconds - Per-village delay (0 = publish immediately, the
 *   legacy behavior). When >0, publishing is debounced per user so a burst of
 *   messages collapses into one AI turn.
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
  },
  spamResult?: SpamCheckResult,
  replyDelaySeconds?: number,
): { spamResult?: SpamCheckResult } {
  const resolvedVillageId = requireVillageId(village_id);

  // If no spamResult provided, create a simple pass-through
  const result: SpamCheckResult = spamResult || {
    shouldProcess: true,
    isSpam: false,
    isDuplicate: false,
    isBanned: false,
    supersedePrevious: false,
    suppressedMessageIds: [],
    contextMessages: [{ messageId: message_id, text: message_text, receivedAt: received_at }],
    reason: 'no_spam_check',
  };

  // If spam guard says to supersede previous messages, mark them as completed
  if (result.supersedePrevious && result.suppressedMessageIds.length > 0) {
    logger.info('🔄 Superseding previous messages (bubble chat)', {
      wa_user_id,
      message_id,
      suppressedCount: result.suppressedMessageIds.length,
      suppressedIds: result.suppressedMessageIds,
    });

    // Mark superseded messages as completed (their AI responses will be suppressed)
    markMessagesAsCompleted(result.suppressedMessageIds).catch(err => {
      logger.warn('Failed to mark superseded messages as completed', { error: err.message });
    });
  }

  const delaySeconds = Math.max(0, Math.min(60, Math.floor(Number(replyDelaySeconds) || 0)));

  if (delaySeconds <= 0) {
    // Forward to AI immediately (legacy behavior)
    publishToAI(resolvedVillageId, wa_user_id, message_id, message_text, received_at, mediaInfo, result);
    logger.info('📨 Message forwarded to AI immediately', {
      wa_user_id,
      message_id,
      isDuplicate: result.isDuplicate,
      supersedePrevious: result.supersedePrevious,
      reason: result.reason,
    });
    return { spamResult: result };
  }

  // Debounce: a new message from the same user within the window resets the
  // timer. Only the latest message is published, but spam-guard's
  // contextMessages already carries the burst so the AI sees the full bubble.
  const delayKey = `${resolvedVillageId}:${wa_user_id}`;
  const existingTimer = pendingDelayedPublishes.get(delayKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    pendingDelayedPublishes.delete(delayKey);
    publishToAI(resolvedVillageId, wa_user_id, message_id, message_text, received_at, mediaInfo, result);
    logger.info('📨 Message forwarded to AI after reply delay', {
      wa_user_id,
      message_id,
      reply_delay_seconds: delaySeconds,
    });
  }, delaySeconds * 1000);

  pendingDelayedPublishes.set(delayKey, timer);

  logger.info('⏳ Message held for reply delay', {
    wa_user_id,
    message_id,
    reply_delay_seconds: delaySeconds,
    isDuplicate: result.isDuplicate,
    supersedePrevious: result.supersedePrevious,
    reason: result.reason,
  });

  return { spamResult: result };
}

/**
 * Publish message to RabbitMQ for AI processing
 */
async function publishToAI(
  village_id: string,
  wa_user_id: string,
  message_id: string,
  message_text: string,
  received_at: string,
  mediaInfo?: {
    has_media?: boolean;
    media_type?: string;
    media_url?: string;
    media_public_url?: string;
  },
  spamResult?: SpamCheckResult,
): Promise<void> {
  // Mark as processing
  try {
    await markMessagesAsProcessing([message_id]);
  } catch (error: any) {
    logger.warn('Failed to mark message as processing', { error: error.message });
  }

  const payload = {
    village_id,
    wa_user_id,
    message: message_text,
    message_id,
    received_at,
    // Single message
    batched_message_ids: [message_id],
    // Media
    has_media: mediaInfo?.has_media || false,
    media_type: mediaInfo?.media_type,
    media_url: mediaInfo?.media_url,
    media_public_url: mediaInfo?.media_public_url,
    // Spam guard info (for AI service to know about supersede + context)
    spam_guard: spamResult ? {
      isDuplicate: spamResult.isDuplicate,
      supersedePrevious: spamResult.supersedePrevious,
      suppressedMessageIds: spamResult.suppressedMessageIds,
      contextMessages: spamResult.contextMessages,
    } : undefined,
  };

  if (isRabbitConnected()) {
    try {
      await publishEvent(rabbitmqConfig.ROUTING_KEYS.MESSAGE_RECEIVED, payload);

      logger.info('✅ Message sent to AI', {
        wa_user_id,
        message_id,
      });
    } catch (error: any) {
      logger.error('Failed to publish message', {
        error: error.message,
        wa_user_id,
        message_id,
      });

      // Retry later
      scheduleRetry(village_id, wa_user_id, message_id, message_text, received_at, mediaInfo, spamResult);
    }
  } else {
    logger.warn('RabbitMQ not connected, scheduling retry', {
      wa_user_id,
      message_id,
    });
    scheduleRetry(village_id, wa_user_id, message_id, message_text, received_at, mediaInfo, spamResult);
  }
}

/**
 * Schedule a retry for failed publish
 */
function scheduleRetry(
  village_id: string,
  wa_user_id: string,
  message_id: string,
  message_text: string,
  received_at: string,
  mediaInfo?: any,
  spamResult?: SpamCheckResult,
): void {
  const retryKey = `${village_id}:${wa_user_id}:${message_id}`;

  // Clear existing retry if any
  const existingTimer = pendingRetries.get(retryKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    pendingRetries.delete(retryKey);
    publishToAI(village_id, wa_user_id, message_id, message_text, received_at, mediaInfo, spamResult);
  }, PUBLISH_RETRY_DELAY_MS);

  pendingRetries.set(retryKey, timer);

  logger.warn('🔁 Retrying publish later', {
    wa_user_id,
    message_id,
    retry_delay_ms: PUBLISH_RETRY_DELAY_MS,
  });
}

/**
 * Cancel batch for a user (e.g., when takeover starts)
 */
export function cancelBatch(wa_user_id: string, village_id?: string): void {
  const resolvedVillageId = requireVillageId(village_id);

  // Cancel any pending retries for this user
  for (const [key, timer] of pendingRetries.entries()) {
    if (key.startsWith(`${resolvedVillageId}:${wa_user_id}:`)) {
      clearTimeout(timer);
      pendingRetries.delete(key);
    }
  }

  // Cancel any in-flight reply-delay timer for this user (e.g. admin takeover
  // mid-window must not let the AI fire after the admin has taken over).
  const delayKey = `${resolvedVillageId}:${wa_user_id}`;
  const delayTimer = pendingDelayedPublishes.get(delayKey);
  if (delayTimer) {
    clearTimeout(delayTimer);
    pendingDelayedPublishes.delete(delayKey);
  }

  logger.info('🚫 Pending messages cancelled for user', {
    wa_user_id,
  });
}



/**
 * Force process all pending batches (for shutdown)
 */
export async function flushAllBatches(): Promise<void> {
  // Clear all pending retries
  for (const [, timer] of pendingRetries.entries()) {
    clearTimeout(timer);
  }
  pendingRetries.clear();

  // Clear all in-flight reply-delay timers
  for (const [, timer] of pendingDelayedPublishes.entries()) {
    clearTimeout(timer);
  }
  pendingDelayedPublishes.clear();

  logger.info('✅ All pending retries cleared');
}
