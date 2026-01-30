/**
 * Cross-Channel Context Service
 * 
 * Enables context sharing between WhatsApp and Webchat channels.
 * 
 * Features:
 * - Link WhatsApp and Webchat users by phone number
 * - Share conversation context across channels
 * - Track channel preferences per user
 * - Unified user identity
 */

import logger from '../utils/logger';

const CROSS_CHANNEL_ENABLED = false;

// ==================== TYPES ====================

export interface ChannelIdentity {
  wa_user_id?: string;      // WhatsApp: 628xxx
  webchat_user_id?: string; // Webchat: web_xxx
  phone_number?: string;    // Normalized phone: 628xxx
  linked_at?: number;
}

export interface CrossChannelContext {
  identities: ChannelIdentity;
  preferredChannel: 'whatsapp' | 'webchat' | null;
  lastActiveChannel: 'whatsapp' | 'webchat';
  lastActiveAt: number;
  sharedData: {
    name?: string;
    nik?: string;
    address?: string;
    pendingComplaint?: any;
    pendingServiceRequest?: any;
  };
}

// ==================== STORAGE ====================

// Map phone number to cross-channel context
const crossChannelContexts = new Map<string, CrossChannelContext>();

// Map user IDs to phone numbers for quick lookup
const userIdToPhone = new Map<string, string>();

// ==================== CORE FUNCTIONS ====================

/**
 * Extract phone number from user ID
 */
export function extractPhoneNumber(userId: string): string | null {
  if (!CROSS_CHANNEL_ENABLED) return null;
  // WhatsApp format: 628xxx
  if (/^628\d{8,12}$/.test(userId)) {
    return userId;
  }
  
  // Webchat with phone: web_628xxx_xxx
  const webchatPhoneMatch = userId.match(/^web_(628\d{8,12})_/);
  if (webchatPhoneMatch) {
    return webchatPhoneMatch[1];
  }
  
  return null;
}

/**
 * Link a user ID to a phone number
 */
export function linkUserToPhone(userId: string, phoneNumber: string): void {
  if (!CROSS_CHANNEL_ENABLED) return;
  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  if (!normalizedPhone) return;
  
  userIdToPhone.set(userId, normalizedPhone);
  
  // Get or create cross-channel context
  let context = crossChannelContexts.get(normalizedPhone);
  if (!context) {
    context = {
      identities: {},
      preferredChannel: null,
      lastActiveChannel: userId.startsWith('web_') ? 'webchat' : 'whatsapp',
      lastActiveAt: Date.now(),
      sharedData: {},
    };
    crossChannelContexts.set(normalizedPhone, context);
  }
  
  // Update identities
  if (userId.startsWith('web_')) {
    context.identities.webchat_user_id = userId;
  } else {
    context.identities.wa_user_id = userId;
  }
  context.identities.phone_number = normalizedPhone;
  context.identities.linked_at = Date.now();
  
  logger.info('[CrossChannel] User linked to phone', {
    userId,
    phoneNumber: normalizedPhone,
    hasWhatsApp: !!context.identities.wa_user_id,
    hasWebchat: !!context.identities.webchat_user_id,
  });
}

/**
 * Normalize phone number to 628xxx format
 */
export function normalizePhoneNumber(phone: string): string | null {
  if (!CROSS_CHANNEL_ENABLED) return null;
  if (!phone) return null;
  
  // Remove non-digits
  let cleaned = phone.replace(/\D/g, '');
  
  // Convert 08xxx to 628xxx
  if (cleaned.startsWith('08')) {
    cleaned = '62' + cleaned.substring(1);
  }
  
  // Convert +628xxx to 628xxx
  if (cleaned.startsWith('628')) {
    return cleaned;
  }
  
  return null;
}

/**
 * Get cross-channel context for a user
 */
export function getCrossChannelContext(userId: string): CrossChannelContext | null {
  if (!CROSS_CHANNEL_ENABLED) return null;
  // Try direct phone extraction
  const phone = extractPhoneNumber(userId);
  if (phone) {
    return crossChannelContexts.get(phone) || null;
  }
  
  // Try lookup from userIdToPhone map
  const mappedPhone = userIdToPhone.get(userId);
  if (mappedPhone) {
    return crossChannelContexts.get(mappedPhone) || null;
  }
  
  return null;
}

/**
 * Get linked user ID for another channel
 */
export function getLinkedUserId(userId: string, targetChannel: 'whatsapp' | 'webchat'): string | null {
  if (!CROSS_CHANNEL_ENABLED) return null;
  const context = getCrossChannelContext(userId);
  if (!context) return null;
  
  if (targetChannel === 'whatsapp') {
    return context.identities.wa_user_id || null;
  } else {
    return context.identities.webchat_user_id || null;
  }
}

/**
 * Update shared data across channels
 */
export function updateSharedData(
  userId: string,
  data: Partial<CrossChannelContext['sharedData']>
): void {
  if (!CROSS_CHANNEL_ENABLED) return;
  const phone = extractPhoneNumber(userId) || userIdToPhone.get(userId);
  if (!phone) return;
  
  let context = crossChannelContexts.get(phone);
  if (!context) {
    context = {
      identities: { phone_number: phone },
      preferredChannel: null,
      lastActiveChannel: userId.startsWith('web_') ? 'webchat' : 'whatsapp',
      lastActiveAt: Date.now(),
      sharedData: {},
    };
    crossChannelContexts.set(phone, context);
  }
  
  // Merge shared data
  context.sharedData = { ...context.sharedData, ...data };
  context.lastActiveAt = Date.now();
  context.lastActiveChannel = userId.startsWith('web_') ? 'webchat' : 'whatsapp';
  
  logger.debug('[CrossChannel] Shared data updated', {
    userId,
    phone,
    dataKeys: Object.keys(data),
  });
}

/**
 * Get shared data for a user
 */
export function getSharedData(userId: string): CrossChannelContext['sharedData'] | null {
  if (!CROSS_CHANNEL_ENABLED) return null;
  const context = getCrossChannelContext(userId);
  return context?.sharedData || null;
}

/**
 * Set preferred channel for a user
 */
export function setPreferredChannel(
  userId: string,
  channel: 'whatsapp' | 'webchat'
): void {
  if (!CROSS_CHANNEL_ENABLED) return;
  const phone = extractPhoneNumber(userId) || userIdToPhone.get(userId);
  if (!phone) return;
  
  const context = crossChannelContexts.get(phone);
  if (context) {
    context.preferredChannel = channel;
    logger.info('[CrossChannel] Preferred channel set', { userId, phone, channel });
  }
}

/**
 * Record activity on a channel
 */
export function recordChannelActivity(userId: string): void {
  if (!CROSS_CHANNEL_ENABLED) return;
  const phone = extractPhoneNumber(userId) || userIdToPhone.get(userId);
  if (!phone) return;
  
  const context = crossChannelContexts.get(phone);
  if (context) {
    context.lastActiveChannel = userId.startsWith('web_') ? 'webchat' : 'whatsapp';
    context.lastActiveAt = Date.now();
  }
}

/**
 * Check if user has activity on another channel
 */
export function hasOtherChannelActivity(userId: string): boolean {
  if (!CROSS_CHANNEL_ENABLED) return false;
  const context = getCrossChannelContext(userId);
  if (!context) return false;
  
  const currentChannel = userId.startsWith('web_') ? 'webchat' : 'whatsapp';
  const otherChannel = currentChannel === 'whatsapp' ? 'webchat' : 'whatsapp';
  
  if (otherChannel === 'whatsapp') {
    return !!context.identities.wa_user_id;
  } else {
    return !!context.identities.webchat_user_id;
  }
}

/**
 * Get context string for LLM prompt
 */
export function getCrossChannelContextForLLM(userId: string): string {
  if (!CROSS_CHANNEL_ENABLED) return '';
  const context = getCrossChannelContext(userId);
  if (!context) return '';
  
  const parts: string[] = [];
  
  // Check if user has activity on both channels
  const hasBothChannels = context.identities.wa_user_id && context.identities.webchat_user_id;
  if (hasBothChannels) {
    parts.push('[MULTI-CHANNEL USER: User aktif di WhatsApp dan Webchat]');
  }
  
  // Add shared data context
  if (context.sharedData.name) {
    parts.push(`[NAMA USER: ${context.sharedData.name}]`);
  }
  if (context.sharedData.nik) {
    parts.push(`[NIK USER: ${context.sharedData.nik}]`);
  }
  if (context.sharedData.address) {
    parts.push(`[ALAMAT USER: ${context.sharedData.address}]`);
  }
  
  // Add pending actions
  if (context.sharedData.pendingComplaint) {
    parts.push('[PENDING: User memiliki laporan yang belum selesai]');
  }
  if (context.sharedData.pendingServiceRequest) {
    parts.push('[PENDING: User memiliki permohonan layanan yang belum selesai]');
  }
  
  if (parts.length === 0) return '';
  
  return '\n[CROSS-CHANNEL CONTEXT]\n' + parts.join('\n');
}

// ==================== CLEANUP ====================

// Cleanup old contexts (older than 7 days)
setInterval(() => {
  const now = Date.now();
  const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
  
  for (const [phone, context] of crossChannelContexts.entries()) {
    if (now - context.lastActiveAt > maxAge) {
      crossChannelContexts.delete(phone);
      
      // Also clean up userIdToPhone mappings
      for (const [userId, mappedPhone] of userIdToPhone.entries()) {
        if (mappedPhone === phone) {
          userIdToPhone.delete(userId);
        }
      }
    }
  }
}, 60 * 60 * 1000); // Clean every hour

// ==================== EXPORTS ====================

export default {
  extractPhoneNumber,
  linkUserToPhone,
  normalizePhoneNumber,
  getCrossChannelContext,
  getLinkedUserId,
  updateSharedData,
  getSharedData,
  setPreferredChannel,
  recordChannelActivity,
  hasOtherChannelActivity,
  getCrossChannelContextForLLM,
};
