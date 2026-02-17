/**
 * Spam Guard Service (AI Service Side)
 * 
 * Tracks in-flight AI processing per user to support:
 * 
 * 1. BUBBLE CHAT: Jika ada pesan baru masuk saat pesan lama masih diproses AI,
 *    response pesan lama dibuang, hanya response pesan terakhir yang dikirim.
 *    Konteks semua pesan digabung agar AI paham semua percakapan.
 * 
 * 2. SPAM IDENTIK: Jika pesan identik > MAX, ban teks itu saja.
 *    Hanya berlaku saat masih dalam proses (belum di-reply).
 *    Ban per-teks, bukan per-user (pesan lain tetap diterima).
 * 
 * Flow:
 * 1. Channel Service sends spam_guard metadata (contextMessages, supersedePrevious)
 * 2. registerProcessing() → marks previous in-flight as superseded
 * 3. After AI completes → shouldSendResponse() checks if this is still the latest
 * 4. Only latest message's response is sent; all others are suppressed
 */

import logger from '../utils/logger';

// ==================== CONFIGURATION ====================

const SPAM_GUARD_MAX_IDENTICAL = parseInt(process.env.SPAM_GUARD_MAX_IDENTICAL || '5', 10);
const SPAM_GUARD_BAN_DURATION_MS = parseInt(process.env.SPAM_GUARD_BAN_DURATION_MS || '60000', 10);
const SPAM_RATE_MAX_MESSAGES = parseInt(process.env.SPAM_RATE_MAX_MESSAGES || '10', 10);
const SPAM_RATE_WINDOW_MS = parseInt(process.env.SPAM_RATE_WINDOW_MS || '10000', 10);

// ==================== TYPES ====================

interface InFlightProcessing {
  /** The message ID currently being processed */
  messageId: string;
  /** The message text */
  messageText: string;
  /** Timestamp when processing started */
  startedAt: number;
  /** Whether this message has been superseded by a newer one */
  superseded: boolean;
  /** The message ID that superseded this one */
  supersededBy?: string;
}

interface UserProcessingState {
  /** Currently in-flight processing tasks keyed by message_id */
  inFlight: Map<string, InFlightProcessing>;
  /** The latest message ID (this is the one that should get a response) */
  latestMessageId: string | null;
  /** All message IDs in current bubble session (for marking as replied) */
  bubbleMessageIds: string[];
}

// ==================== STORAGE ====================

/** Track processing state per user */
const userStates = new Map<string, UserProcessingState>();

// Cleanup old states every 5 minutes
setInterval(() => {
  const now = Date.now();
  const maxAge = 5 * 60 * 1000;

  for (const [key, state] of userStates.entries()) {
    for (const [msgId, flight] of state.inFlight.entries()) {
      if (now - flight.startedAt > maxAge) {
        state.inFlight.delete(msgId);
      }
    }
    if (state.inFlight.size === 0 && !state.latestMessageId) {
      userStates.delete(key);
    }
  }
}, 5 * 60 * 1000);

// ==================== CORE FUNCTIONS ====================

function stateKey(villageId: string | undefined, waUserId: string): string {
  return `${villageId || 'unknown'}:${waUserId}`;
}

/**
 * Register a message as being processed by AI.
 * Marks all previous in-flight messages as superseded (bubble chat).
 */
export function registerProcessing(
  villageId: string | undefined,
  waUserId: string,
  messageId: string,
  messageText: string,
  spamGuardInfo?: {
    isDuplicate?: boolean;
    supersedePrevious?: boolean;
    suppressedMessageIds?: string[];
    contextMessages?: Array<{ messageId: string; text: string; receivedAt: string }>;
  },
): { shouldRespond: boolean; allMessageIds: string[] } {
  const key = stateKey(villageId, waUserId);
  const normalizedText = messageText.trim();

  let state = userStates.get(key);
  if (!state) {
    state = {
      inFlight: new Map(),
      latestMessageId: null,
      bubbleMessageIds: [],
    };
    userStates.set(key, state);
  }

  // Mark ALL previous in-flight messages as superseded (bubble chat: only latest wins)
  for (const [, flight] of state.inFlight) {
    if (!flight.superseded) {
      flight.superseded = true;
      flight.supersededBy = messageId;
      logger.info('🔄 Previous message superseded (bubble)', {
        wa_user_id: waUserId,
        superseded_id: flight.messageId,
        superseded_by: messageId,
      });
    }
  }

  // Also mark suppressedMessageIds from channel service
  if (spamGuardInfo?.supersedePrevious && spamGuardInfo.suppressedMessageIds) {
    for (const suppId of spamGuardInfo.suppressedMessageIds) {
      const flight = state.inFlight.get(suppId);
      if (flight) {
        flight.superseded = true;
        flight.supersededBy = messageId;
      }
    }
  }

  // Register this message as in-flight
  state.inFlight.set(messageId, {
    messageId,
    messageText: normalizedText,
    startedAt: Date.now(),
    superseded: false,
  });
  state.latestMessageId = messageId;

  // Track all bubble message IDs (for marking as replied)
  if (!state.bubbleMessageIds.includes(messageId)) {
    state.bubbleMessageIds.push(messageId);
  }
  // Also add any context message IDs from channel
  if (spamGuardInfo?.contextMessages) {
    for (const ctx of spamGuardInfo.contextMessages) {
      if (!state.bubbleMessageIds.includes(ctx.messageId)) {
        state.bubbleMessageIds.push(ctx.messageId);
      }
    }
  }

  return {
    shouldRespond: true, // Always process; check shouldSendResponse() after AI completes
    allMessageIds: [...state.bubbleMessageIds],
  };
}

/**
 * Check if a response for this message should actually be sent to the user.
 * Called BEFORE and AFTER AI processing, before publishing the reply.
 * 
 * This is a READ-ONLY check — it does NOT modify state.
 * Use completeProcessing() to clean up after sending or suppressing.
 * 
 * Returns false if:
 * - This message has been superseded by a newer message (bubble chat)
 * - A newer message is being processed (this is not the latest)
 */
export function shouldSendResponse(
  villageId: string | undefined,
  waUserId: string,
  messageId: string,
): { send: boolean; reason: string; allMessageIds: string[] } {
  const key = stateKey(villageId, waUserId);
  const state = userStates.get(key);

  if (!state) {
    return { send: true, reason: 'no_state', allMessageIds: [messageId] };
  }

  const flight = state.inFlight.get(messageId);
  if (!flight) {
    return { send: true, reason: 'not_tracked', allMessageIds: [messageId] };
  }

  // Check if this message has been superseded
  if (flight.superseded) {
    logger.info('🚫 Response suppressed (superseded by bubble)', {
      wa_user_id: waUserId,
      message_id: messageId,
      superseded_by: flight.supersededBy,
    });

    return {
      send: false,
      reason: `superseded_by_${flight.supersededBy}`,
      allMessageIds: state.bubbleMessageIds,
    };
  }

  // Check if this is the latest message
  if (state.latestMessageId !== messageId) {
    logger.info('🚫 Response suppressed (not latest in bubble)', {
      wa_user_id: waUserId,
      message_id: messageId,
      latest_id: state.latestMessageId,
    });

    return {
      send: false,
      reason: `not_latest (latest: ${state.latestMessageId})`,
      allMessageIds: state.bubbleMessageIds,
    };
  }

  // This IS the latest message → send response, mark ALL bubble messages as replied
  const allIds = [...state.bubbleMessageIds];

  return {
    send: true,
    reason: 'latest_message',
    allMessageIds: allIds,
  };
}

/**
 * Clean up processing state after response is sent (or suppressed).
 */
export function completeProcessing(
  villageId: string | undefined,
  waUserId: string,
  messageId: string,
): void {
  const key = stateKey(villageId, waUserId);
  const state = userStates.get(key);
  if (!state) return;

  state.inFlight.delete(messageId);

  // If no more in-flight, reset state entirely (next messages start fresh)
  if (state.inFlight.size === 0) {
    userStates.delete(key);
  }
}

/**
 * Get processing stats for monitoring.
 */
export function getSpamGuardStats(): {
  activeUsers: number;
  totalInFlight: number;
  config: { maxIdentical: number; banDurationMs: number; rateMaxMessages: number; rateWindowMs: number };
} {
  let totalInFlight = 0;
  for (const state of userStates.values()) {
    totalInFlight += state.inFlight.size;
  }

  return {
    activeUsers: userStates.size,
    totalInFlight,
    config: {
      maxIdentical: SPAM_GUARD_MAX_IDENTICAL,
      banDurationMs: SPAM_GUARD_BAN_DURATION_MS,
      rateMaxMessages: SPAM_RATE_MAX_MESSAGES,
      rateWindowMs: SPAM_RATE_WINDOW_MS,
    },
  };
}
