/**
 * Webchat Message Batcher Service
 * 
 * Batches multiple messages from the same webchat user within a time window
 * to prevent spam and reduce AI API calls.
 * 
 * Similar to Channel Service's message-batcher but for webchat HTTP requests.
 * 
 * How it works:
 * 1. When a message comes in, add to batch for that session
 * 2. Set/reset a timer for BATCH_DELAY_MS (default 3 seconds)
 * 3. When timer expires, combine all messages and process with AI
 * 4. Return response via callback/promise
 */

import logger from '../utils/logger';

// Configuration - unified with Channel Service (BATCH_DELAY_MS)
const BATCH_DELAY_MS = parseInt(process.env.BATCH_DELAY_MS || process.env.WEBCHAT_BATCH_DELAY_MS || '3000', 10); // 3 seconds
const MAX_BATCH_SIZE = parseInt(process.env.MAX_BATCH_SIZE || '10', 10); // Max messages per batch

interface BatchedMessage {
  message: string;
  timestamp: Date;
}

interface PendingResponse {
  resolve: (result: BatchResult) => void;
  reject: (error: Error) => void;
}

interface SessionBatch {
  session_id: string;
  messages: BatchedMessage[];
  pendingResponses: PendingResponse[];
  timer: NodeJS.Timeout | null;
  first_message_at: number;
}

export interface BatchResult {
  combinedMessage: string;
  messageCount: number;
  isBatched: boolean;
  isPrimary: boolean; // Only the primary request should process the message
}

// In-memory batch storage (per session)
const sessionBatches = new Map<string, SessionBatch>();

/**
 * Add message to batch for a session
 * Returns a promise that resolves when the batch is processed
 */
export function addWebchatMessageToBatch(
  session_id: string,
  message: string
): Promise<BatchResult> {
  return new Promise((resolve, reject) => {
    const now = Date.now();
    
    let batch = sessionBatches.get(session_id);
    
    if (!batch) {
      // Create new batch
      batch = {
        session_id,
        messages: [],
        pendingResponses: [],
        timer: null,
        first_message_at: now,
      };
      sessionBatches.set(session_id, batch);
      
      logger.info('📦 [Webchat] New message batch started', {
        session_id,
        batch_delay_ms: BATCH_DELAY_MS,
      });
    }
    
    // Add message to batch
    batch.messages.push({
      message,
      timestamp: new Date(),
    });
    
    // Add pending response
    batch.pendingResponses.push({ resolve, reject });
    
    // Clear existing timer
    if (batch.timer) {
      clearTimeout(batch.timer);
      logger.debug('⏰ [Webchat] Batch timer reset (new message received)', {
        session_id,
        batch_size: batch.messages.length,
      });
    }
    
    // Check if max batch size reached - process immediately
    if (batch.messages.length >= MAX_BATCH_SIZE) {
      logger.info('📦 [Webchat] Max batch size reached, processing immediately', {
        session_id,
        batch_size: batch.messages.length,
      });
      processBatch(session_id);
      return;
    }
    
    // Set new timer
    batch.timer = setTimeout(() => {
      processBatch(session_id);
    }, BATCH_DELAY_MS);
    
    logger.info('📨 [Webchat] Message added to batch', {
      session_id,
      batch_size: batch.messages.length,
      waiting_ms: BATCH_DELAY_MS,
    });
  });
}

/**
 * Process a session's batch - combine messages and resolve promises
 */
function processBatch(session_id: string): void {
  const batch = sessionBatches.get(session_id);
  
  if (!batch || batch.messages.length === 0) {
    logger.warn('[Webchat] Empty batch for session', { session_id });
    sessionBatches.delete(session_id);
    return;
  }
  
  // Clear timer if exists
  if (batch.timer) {
    clearTimeout(batch.timer);
    batch.timer = null;
  }
  
  // Get all messages and pending responses
  const messages = [...batch.messages];
  const pendingResponses = [...batch.pendingResponses];
  
  // Clear the batch
  sessionBatches.delete(session_id);
  
  logger.info('📤 [Webchat] Processing message batch', {
    session_id,
    message_count: messages.length,
    batch_duration_ms: Date.now() - batch.first_message_at,
  });
  
  // Combine messages into one text
  let combinedMessage: string;
  if (messages.length === 1) {
    combinedMessage = messages[0].message;
  } else {
    // Multiple messages - combine with newlines
    combinedMessage = messages
      .map((m) => m.message)
      .join('\n');
  }
  
  // Resolve all pending responses - only the first one is primary
  for (let i = 0; i < pendingResponses.length; i++) {
    const result: BatchResult = {
      combinedMessage,
      messageCount: messages.length,
      isBatched: messages.length > 1,
      isPrimary: i === 0, // Only the first request should process
    };
    pendingResponses[i].resolve(result);
  }
  
  logger.info('✅ [Webchat] Batch processed', {
    session_id,
    message_count: messages.length,
    combined_length: combinedMessage.length,
  });
}

/**
 * Cancel batch for a session (e.g., when takeover starts)
 */
export function cancelWebchatBatch(session_id: string): void {
  const batch = sessionBatches.get(session_id);
  
  if (batch) {
    if (batch.timer) {
      clearTimeout(batch.timer);
    }
    
    // Reject all pending responses
    for (const pending of batch.pendingResponses) {
      pending.reject(new Error('Batch cancelled'));
    }
    
    sessionBatches.delete(session_id);
    
    logger.info('🚫 [Webchat] Batch cancelled', {
      session_id,
      cancelled_messages: batch.messages.length,
    });
  }
}

/**
 * Check if session has pending batch
 */
export function hasWebchatPendingBatch(session_id: string): boolean {
  return sessionBatches.has(session_id);
}

/**
 * Get batch status for a session
 */
export function getWebchatBatchStatus(session_id: string): {
  hasBatch: boolean;
  messageCount: number;
  waitingMs: number;
} {
  const batch = sessionBatches.get(session_id);
  
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
export function getAllWebchatBatches(): {
  session_id: string;
  message_count: number;
  waiting_ms: number;
}[] {
  const result: { session_id: string; message_count: number; waiting_ms: number }[] = [];
  const now = Date.now();
  
  sessionBatches.forEach((batch, session_id) => {
    result.push({
      session_id,
      message_count: batch.messages.length,
      waiting_ms: now - batch.first_message_at,
    });
  });
  
  return result;
}

export default {
  addWebchatMessageToBatch,
  cancelWebchatBatch,
  hasWebchatPendingBatch,
  getWebchatBatchStatus,
  getAllWebchatBatches,
};
