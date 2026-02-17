/**
 * Spam Guard Service (Channel Service)
 * 
 * Tiga fitur utama:
 * 
 * 1. BUBBLE CHAT SUPERSEDING (semua pesan, identik maupun berbeda):
 *    - Jika ada pesan masuk saat pesan sebelumnya masih diproses AI (belum di-reply),
 *      maka response DAN proses pesan lama DIBUANG SEMUANYA.
 *      Hanya proses pesan TERAKHIR yang jalan, mengandung gabungan konteks
 *      semua pesan sebelumnya + pesan terakhir, sehingga AI memahami seluruh percakapan.
 *    - Yang dikirim ke user hanya 1 response (dari proses terakhir yang gabungan).
 *    - Berlaku untuk 2, 3, 4, 5, ... N pesan selama belum di-reply.
 * 
 * 2. SPAM IDENTIK (pesan yang SAMA PERSIS, selama belum di-reply):
 *    - Jika user mengirim > SPAM_GUARD_MAX_IDENTICAL pesan identik
 *      selama masih dalam proses (belum di-reply):
 *      - Hanya 5 pesan awal yang diproses (bubble chat, 1 response gabungan)
 *      - Pesan ke-6 dst = SPAM → TIDAK diproses, TIDAK disimpan ke history
 *      - Teks itu di-ban selama 1 menit (pesan berbeda tetap diterima)
 *    - Ban tetap aktif walaupun AI sudah reply bubble sebelumnya.
 *      User harus tunggu ban selesai (1 menit) baru bisa kirim teks itu lagi.
 *    - Selama banned, semua pesan dengan teks itu TIDAK diproses sama sekali.
 * 
 * 3. RATE SPAM (lebih dari N pesan BERBEDA dalam M detik):
 *    - Jika user mengirim > SPAM_RATE_MAX_MESSAGES pesan dalam
 *      SPAM_RATE_WINDOW_MS, itu rate spam.
 *    - 10 pesan yang sudah masuk tetap diproses sebagai 1 bubble
 *      (gabung konteks, 1 response dikirim ke user).
 *    - Pesan ke-11 dst = SPAM → TIDAK diproses, TIDAK disimpan ke history
 *    - User di-ban seluruh pesan selama 1 menit
 * 
 * Pesan spam: tidak disimpan ke messages DB, tidak masuk history AI,
 * tidak diproses sama sekali oleh sistem.
 */

import logger from '../utils/logger';

// ==================== CONFIGURATION ====================

const SPAM_GUARD_ENABLED = process.env.SPAM_GUARD_ENABLED !== 'false';
const SPAM_GUARD_MAX_IDENTICAL = parseInt(process.env.SPAM_GUARD_MAX_IDENTICAL || '5', 10);
const SPAM_GUARD_BAN_DURATION_MS = parseInt(process.env.SPAM_GUARD_BAN_DURATION_MS || '60000', 10);
const SPAM_RATE_MAX_MESSAGES = parseInt(process.env.SPAM_RATE_MAX_MESSAGES || '10', 10);
const SPAM_RATE_WINDOW_MS = parseInt(process.env.SPAM_RATE_WINDOW_MS || '10000', 10); // 10 seconds

// ==================== TYPES ====================

interface InFlightMessage {
  messageId: string;
  text: string;
  receivedAt: number;
  receivedAtISO: string;
}

/** Ban bisa per-teks (identik) atau per-user (rate) */
export interface SpamBan {
  wa_user_id: string;
  reason: string;
  bannedAt: number;
  expiresAt: number;
  /** Teks yang di-ban (kosong = ban semua pesan / rate spam) */
  identicalText: string;
  messageCount: number;
  /** Tipe ban: 'identical' = hanya teks ini, 'rate' = semua pesan */
  banType: 'identical' | 'rate';
}

interface UserBubbleState {
  /** All in-flight messages (not yet replied) in chronological order */
  inFlightMessages: InFlightMessage[];
  /** Track identical text counts selama bubble: Map<normalizedText, count> */
  identicalCounts: Map<string, number>;
}

/** Sliding window untuk rate tracking per user */
interface RateWindow {
  /** Timestamps of all messages in window */
  timestamps: number[];
}

export interface SpamCheckResult {
  /** Whether the message should be forwarded to AI */
  shouldProcess: boolean;
  /** Whether this message is SPAM (should NOT be saved to DB / history) */
  isSpam: boolean;
  /** Whether this is a duplicate/identical of an in-flight message */
  isDuplicate: boolean;
  /** Whether this specific text or user is banned */
  isBanned: boolean;
  /** Whether earlier responses should be suppressed (only latest matters) */
  supersedePrevious: boolean;
  /** Message IDs whose AI responses should be suppressed */
  suppressedMessageIds: string[];
  /** All accumulated message texts (for combined context) */
  contextMessages: Array<{ messageId: string; text: string; receivedAt: string }>;
  /** Ban info if ban was triggered */
  banInfo?: SpamBan;
  /** Reason for decision */
  reason: string;
}

// ==================== STORAGE ====================

/** Track bubble state per user: Map<village_id:wa_user_id, UserBubbleState> */
const userBubbleStates = new Map<string, UserBubbleState>();

/** Active spam bans: Map<banKey, SpamBan> */
const spamBans = new Map<string, SpamBan>();

/** Rate tracking per user: Map<village_id:wa_user_id, RateWindow> */
const rateWindows = new Map<string, RateWindow>();

// Cleanup every 10 minutes
setInterval(() => {
  const now = Date.now();
  const maxAge = 5 * 60 * 1000;

  for (const [key, state] of userBubbleStates.entries()) {
    state.inFlightMessages = state.inFlightMessages.filter(m => now - m.receivedAt < maxAge);
    if (state.inFlightMessages.length === 0) {
      userBubbleStates.delete(key);
    }
  }

  for (const [key, ban] of spamBans.entries()) {
    if (now >= ban.expiresAt) {
      spamBans.delete(key);
      logger.info('🔓 Spam ban expired', {
        wa_user_id: ban.wa_user_id,
        banType: ban.banType,
        identicalText: ban.identicalText?.substring(0, 30) || '(rate ban)',
      });
    }
  }

  // Clean old rate windows
  for (const [key, rw] of rateWindows.entries()) {
    rw.timestamps = rw.timestamps.filter(t => now - t < SPAM_RATE_WINDOW_MS);
    if (rw.timestamps.length === 0) {
      rateWindows.delete(key);
    }
  }
}, 10 * 60 * 1000);

// ==================== HELPER FUNCTIONS ====================

function userKey(villageId: string | undefined, waUserId: string): string {
  return `${villageId || 'unknown'}:${waUserId}`;
}

function textBanKey(villageId: string | undefined, waUserId: string, text: string): string {
  return `text:${villageId || 'unknown'}:${waUserId}:${text}`;
}

function rateBanKey(villageId: string | undefined, waUserId: string): string {
  return `rate:${villageId || 'unknown'}:${waUserId}`;
}

// ==================== CORE FUNCTION ====================

/**
 * Check a message and decide whether to process it.
 * 
 * MUST be called BEFORE saving message to DB.
 * If result.isSpam = true → don't save to messages table, don't enter history.
 * 
 * Logic order:
 * 1. Check rate ban (all messages blocked) → reject as spam
 * 2. Check text ban (specific text blocked) → reject as spam
 * 3. Check rate limit (>N messages in M seconds) → ban user, reject as spam
 * 4. Check identical limit (>5 same text in bubble) → ban text, reject as spam
 * 5. Bubble chat handling (supersede previous, combine context)
 * 6. New clean message
 */
export function checkSpamGuard(
  villageId: string | undefined,
  waUserId: string,
  messageId: string,
  messageText: string,
  receivedAt: string,
): SpamCheckResult {
  if (!SPAM_GUARD_ENABLED) {
    return {
      shouldProcess: true,
      isSpam: false,
      isDuplicate: false,
      isBanned: false,
      supersedePrevious: false,
      suppressedMessageIds: [],
      contextMessages: [{ messageId, text: messageText, receivedAt }],
      reason: 'spam_guard_disabled',
    };
  }

  const uKey = userKey(villageId, waUserId);
  const normalizedText = messageText.trim();

  // ─── 1. CHECK RATE BAN (all messages blocked for this user) ───
  const rBanKey = rateBanKey(villageId, waUserId);
  const rateBan = spamBans.get(rBanKey);
  if (rateBan && Date.now() < rateBan.expiresAt) {
    const remainingMs = rateBan.expiresAt - Date.now();
    logger.warn('🚫 Rate ban active, rejecting ALL messages', {
      wa_user_id: waUserId,
      message_id: messageId,
      remainingMs,
    });
    return {
      shouldProcess: false,
      isSpam: true,
      isDuplicate: false,
      isBanned: true,
      supersedePrevious: false,
      suppressedMessageIds: [messageId],
      contextMessages: [],
      reason: `rate_banned (${Math.ceil(remainingMs / 1000)}s remaining)`,
    };
  }

  // ─── 2. CHECK TEXT BAN (specific text blocked) ───
  const tBanKey = textBanKey(villageId, waUserId, normalizedText);
  const textBan = spamBans.get(tBanKey);
  if (textBan && Date.now() < textBan.expiresAt) {
    const remainingMs = textBan.expiresAt - Date.now();
    logger.warn('🚫 Text ban active, rejecting identical text', {
      wa_user_id: waUserId,
      message_id: messageId,
      text: normalizedText.substring(0, 30),
      remainingMs,
    });
    return {
      shouldProcess: false,
      isSpam: true,
      isDuplicate: true,
      isBanned: true,
      supersedePrevious: false,
      suppressedMessageIds: [messageId],
      contextMessages: [],
      reason: `text_banned (${Math.ceil(remainingMs / 1000)}s remaining)`,
    };
  }

  // ─── 3. CHECK RATE LIMIT (>N messages in M seconds) ───
  let rateWin = rateWindows.get(uKey);
  if (!rateWin) {
    rateWin = { timestamps: [] };
    rateWindows.set(uKey, rateWin);
  }
  const now = Date.now();
  // Clean old entries outside window
  rateWin.timestamps = rateWin.timestamps.filter(t => now - t < SPAM_RATE_WINDOW_MS);
  rateWin.timestamps.push(now);

  if (rateWin.timestamps.length > SPAM_RATE_MAX_MESSAGES) {
    // Rate spam! Ban ALL messages for this user for 1 minute
    const banInfo: SpamBan = {
      wa_user_id: waUserId,
      reason: `Rate spam: ${rateWin.timestamps.length} pesan dalam ${SPAM_RATE_WINDOW_MS / 1000} detik`,
      bannedAt: now,
      expiresAt: now + SPAM_GUARD_BAN_DURATION_MS,
      identicalText: '',
      messageCount: rateWin.timestamps.length,
      banType: 'rate',
    };
    spamBans.set(rBanKey, banInfo);

    logger.warn('🚫 Rate spam detected → user banned', {
      wa_user_id: waUserId,
      messageCount: rateWin.timestamps.length,
      windowMs: SPAM_RATE_WINDOW_MS,
      banDurationMs: SPAM_GUARD_BAN_DURATION_MS,
    });

    return {
      shouldProcess: false,
      isSpam: true,
      isDuplicate: false,
      isBanned: false,
      supersedePrevious: false,
      suppressedMessageIds: [messageId],
      contextMessages: [],
      banInfo,
      reason: `rate_spam (${rateWin.timestamps.length} msgs in ${SPAM_RATE_WINDOW_MS / 1000}s, banned ${SPAM_GUARD_BAN_DURATION_MS / 1000}s)`,
    };
  }

  // ─── 4. GET/CREATE BUBBLE STATE ───
  let state = userBubbleStates.get(uKey);
  if (!state) {
    state = {
      inFlightMessages: [],
      identicalCounts: new Map(),
    };
    userBubbleStates.set(uKey, state);
  }

  // Track identical count for this text within current bubble
  const prevIdenticalCount = state.identicalCounts.get(normalizedText) || 0;
  const newIdenticalCount = prevIdenticalCount + 1;
  state.identicalCounts.set(normalizedText, newIdenticalCount);

  // ─── 5. CHECK IDENTICAL LIMIT (>5 same text in bubble) ───
  if (newIdenticalCount > SPAM_GUARD_MAX_IDENTICAL) {
    // Ban this specific text for 1 minute
    const banInfo: SpamBan = {
      wa_user_id: waUserId,
      reason: `Spam teks identik "${normalizedText.substring(0, 50)}" (${newIdenticalCount}x)`,
      bannedAt: now,
      expiresAt: now + SPAM_GUARD_BAN_DURATION_MS,
      identicalText: normalizedText,
      messageCount: newIdenticalCount,
      banType: 'identical',
    };
    spamBans.set(tBanKey, banInfo);

    logger.warn('🚫 Identical text spam → text banned', {
      wa_user_id: waUserId,
      text: normalizedText.substring(0, 50),
      count: newIdenticalCount,
      banDurationMs: SPAM_GUARD_BAN_DURATION_MS,
    });

    return {
      shouldProcess: false,
      isSpam: true,
      isDuplicate: true,
      isBanned: false,
      supersedePrevious: false,
      suppressedMessageIds: [messageId],
      contextMessages: [],
      banInfo,
      reason: `identical_spam (${newIdenticalCount}x > ${SPAM_GUARD_MAX_IDENTICAL}, text banned ${SPAM_GUARD_BAN_DURATION_MS / 1000}s)`,
    };
  }

  // ─── 6. BUBBLE CHAT HANDLING ───
  const previousMessages = [...state.inFlightMessages];
  const isIdentical = previousMessages.some(m => m.text === normalizedText);

  // Add this message to in-flight
  state.inFlightMessages.push({
    messageId,
    text: normalizedText,
    receivedAt: now,
    receivedAtISO: receivedAt,
  });

  if (previousMessages.length === 0) {
    // First message → no bubble, process normally
    return {
      shouldProcess: true,
      isSpam: false,
      isDuplicate: false,
      isBanned: false,
      supersedePrevious: false,
      suppressedMessageIds: [],
      contextMessages: [{ messageId, text: normalizedText, receivedAt }],
      reason: 'new_message',
    };
  }

  // There are previous in-flight messages → bubble chat!
  // All previous messages' AI responses should be superseded
  const suppressedIds = previousMessages.map(m => m.messageId);

  // Build combined context: all in-flight texts (including current)
  const contextMessages = [
    ...previousMessages.map(m => ({
      messageId: m.messageId,
      text: m.text,
      receivedAt: m.receivedAtISO,
    })),
    { messageId, text: normalizedText, receivedAt },
  ];

  logger.info('💬 Bubble chat → superseding previous', {
    wa_user_id: waUserId,
    message_id: messageId,
    previousCount: previousMessages.length,
    isIdentical,
    identicalCount: isIdentical ? newIdenticalCount : undefined,
    totalBubble: state.inFlightMessages.length,
  });

  return {
    shouldProcess: true,
    isSpam: false,
    isDuplicate: isIdentical,
    isBanned: false,
    supersedePrevious: true,
    suppressedMessageIds: suppressedIds,
    contextMessages,
    reason: isIdentical
      ? `identical_bubble (${newIdenticalCount}/${SPAM_GUARD_MAX_IDENTICAL}, superseding ${suppressedIds.length})`
      : `bubble_chat (${state.inFlightMessages.length} total, superseding ${suppressedIds.length})`,
  };
}

// ==================== STATE MANAGEMENT ====================

/**
 * Called when AI response is completed and sent to user.
 * Clears the entire bubble state so new messages start fresh.
 */
export function clearUserBubble(villageId: string | undefined, waUserId: string): void {
  const uKey = userKey(villageId, waUserId);
  userBubbleStates.delete(uKey);
}

// ==================== ADMIN / DASHBOARD ====================

/**
 * Get all active spam bans (for admin dashboard).
 */
export function getActiveSpamBans(): SpamBan[] {
  const now = Date.now();
  const activeBans: SpamBan[] = [];

  for (const [, ban] of spamBans) {
    if (now < ban.expiresAt) {
      activeBans.push(ban);
    }
  }

  return activeBans;
}

/**
 * Remove all spam bans for a user (admin action).
 */
export function removeSpamBan(villageId: string | undefined, waUserId: string): boolean {
  let removed = false;

  for (const key of [...spamBans.keys()]) {
    const ban = spamBans.get(key);
    if (ban && ban.wa_user_id === waUserId) {
      // Also check village match if provided
      if (villageId) {
        if (key.includes(`${villageId}:${waUserId}`)) {
          spamBans.delete(key);
          removed = true;
        }
      } else {
        spamBans.delete(key);
        removed = true;
      }
    }
  }

  if (removed) {
    logger.info('🔓 Spam ban(s) manually removed by admin', { wa_user_id: waUserId });
  }

  return removed;
}

/**
 * Get spam guard stats for monitoring.
 */
export function getSpamGuardStats(): {
  enabled: boolean;
  maxIdentical: number;
  banDurationMs: number;
  rateMaxMessages: number;
  rateWindowMs: number;
  activeTrackers: number;
  activeBans: number;
  supersededMessages: number;
  bans: SpamBan[];
} {
  let totalInFlight = 0;
  for (const state of userBubbleStates.values()) {
    totalInFlight += state.inFlightMessages.length;
  }

  return {
    enabled: SPAM_GUARD_ENABLED,
    maxIdentical: SPAM_GUARD_MAX_IDENTICAL,
    banDurationMs: SPAM_GUARD_BAN_DURATION_MS,
    rateMaxMessages: SPAM_RATE_MAX_MESSAGES,
    rateWindowMs: SPAM_RATE_WINDOW_MS,
    activeTrackers: userBubbleStates.size,
    activeBans: spamBans.size,
    supersededMessages: totalInFlight,
    bans: getActiveSpamBans(),
  };
}
