/**
 * Fallback Response Service
 * 
 * Smart fallback responses ketika LLM gagal atau tidak tersedia.
 * Menggunakan template-based responses dengan variasi untuk menghindari
 * response yang monoton.
 * 
 * Features:
 * - Intent-based fallback templates
 * - Random variation untuk response yang lebih natural
 * - Context-aware fallback (berdasarkan collected data)
 * - Graceful degradation
 * 
 * REFACTORED: Now uses centralized templates from constants/response-templates.ts
 */

import logger from '../utils/logger';
import { getContext, ConversationState } from './conversation-fsm.service';
import { detectIntentFromPatterns } from '../constants/intent-patterns';
import {
  FALLBACK_TEMPLATES,
  MISSING_FIELD_PROMPTS,
  ERROR_TEMPLATES,
  getRandomItem,
  getFallbackByIntent,
  getMissingFieldPrompt,
  getErrorFallback,
} from '../constants/response-templates';

// ==================== STATE-BASED FALLBACKS ====================

/**
 * Fallback berdasarkan conversation state
 * Lebih context-aware daripada intent-based
 */
const STATE_FALLBACKS: Record<ConversationState, string[]> = {
  'IDLE': FALLBACK_TEMPLATES['UNKNOWN'],
  
  'COLLECTING_COMPLAINT_DATA': [
    'Untuk melanjutkan laporan, kami perlu info lokasi masalahnya Pak/Bu. Di mana alamatnya?',
    'Baik Pak/Bu, boleh sebutkan alamat lengkap lokasi masalahnya?',
  ],
  
  'CONFIRMING_COMPLAINT': [
    'Apakah data laporan sudah benar Pak/Bu? Ketik "YA" untuk lanjut atau "TIDAK" untuk ubah.',
    'Apakah Bapak/Ibu ingin kami proses laporannya? Ketik "YA" untuk konfirmasi.',
  ],
  
  'COLLECTING_SERVICE_REQUEST_DATA': [
    'Untuk permohonan layanan, kami masih perlu beberapa data Pak/Bu. Boleh dilengkapi?',
    'Data layanan belum lengkap Pak/Bu. Ada yang perlu ditambahkan?',
  ],
  
  'CONFIRMING_SERVICE_REQUEST': [
    'Apakah data layanan sudah benar Pak/Bu? Ketik "YA" untuk konfirmasi.',
    'Apakah Bapak/Ibu ingin kami proses permohonan layanannya? Ketik "YA" untuk lanjut.',
  ],
  
  'AWAITING_ADDRESS_DETAIL': [
    'Alamatnya kurang spesifik Pak/Bu. Bisa tambahkan detail seperti RT/RW atau patokan terdekat?',
    'Boleh sebutkan alamat lebih lengkap Pak/Bu? Misalnya nama jalan, nomor, atau patokan.',
  ],
  
  'AWAITING_CONFIRMATION': [
    'Menunggu konfirmasi Pak/Bu. Ketik "YA" untuk lanjut atau "TIDAK" untuk batal.',
    'Silakan konfirmasi Pak/Bu. Ketik "YA" atau "TIDAK".',
  ],
  
  'CHECK_STATUS_FLOW': [
    'Untuk cek status, sebutkan nomor laporan atau layanan ya Pak/Bu.',
    'Nomor laporan/layanannya berapa Pak/Bu? (contoh: LAP-20251201-001 atau LAY-20251201-001)',
  ],
  
  'CANCELLATION_FLOW': [
    'Untuk pembatalan, sebutkan nomor laporan yang mau dibatalkan ya Pak/Bu.',
    'Nomor laporan yang mau dibatalkan berapa Pak/Bu?',
  ],
};

// ==================== MAIN FUNCTIONS ====================

// Re-export from centralized templates for backward compatibility
export { getFallbackByIntent, getMissingFieldPrompt, getErrorFallback };

/**
 * Get fallback response based on conversation state
 * More context-aware than intent-based
 * 
 * @param userId - User ID to get conversation context
 * @returns Context-aware fallback response
 */
export function getFallbackByState(userId: string): string {
  const ctx = getContext(userId);
  const templates = STATE_FALLBACKS[ctx.state] || FALLBACK_TEMPLATES['UNKNOWN'];
  return getRandomItem(templates);
}

/**
 * Get smart fallback response
 * Combines intent, state, and missing fields for best response
 * 
 * @param userId - User ID
 * @param intent - Detected intent (optional)
 * @param message - Original user message (for context)
 * @returns Smart fallback response
 */
export function getSmartFallback(
  userId: string,
  intent?: string,
  message?: string
): string {
  const ctx = getContext(userId);
  
  // 1. If we have missing fields, ask for the first one
  if (ctx.missingFields.length > 0) {
    const firstMissing = ctx.missingFields[0];
    const prompt = getMissingFieldPrompt(firstMissing);
    
    logger.info('[Fallback] Using missing field prompt', {
      userId,
      state: ctx.state,
      missingField: firstMissing,
    });
    
    return prompt;
  }
  
  // 2. If we're in an active flow, use state-based fallback
  if (ctx.state !== 'IDLE') {
    logger.info('[Fallback] Using state-based fallback', {
      userId,
      state: ctx.state,
    });
    
    return getFallbackByState(userId);
  }
  
  // 3. If we have intent, use intent-based fallback
  if (intent) {
    logger.info('[Fallback] Using intent-based fallback', {
      userId,
      intent,
    });
    
    return getFallbackByIntent(intent);
  }
  
  // 4. Try to detect intent from message using centralized patterns
  if (message) {
    const detectedIntent = detectIntentFromPatterns(message);
    if (detectedIntent) {
      logger.info('[Fallback] Using detected intent fallback', {
        userId,
        detectedIntent,
      });
      
      return getFallbackByIntent(detectedIntent);
    }
  }
  
  // 5. Default fallback
  logger.info('[Fallback] Using default fallback', { userId });
  return getFallbackByIntent('UNKNOWN');
}



// ==================== EXPORTS ====================

export default {
  getFallbackByIntent,
  getFallbackByState,
  getMissingFieldPrompt,
  getSmartFallback,
  getErrorFallback,
  // Re-export from centralized templates
  FALLBACK_TEMPLATES,
  STATE_FALLBACKS,
};
