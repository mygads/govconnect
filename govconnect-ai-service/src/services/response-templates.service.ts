/**
 * Response Templates Service
 * 
 * Pre-defined response templates for common scenarios to reduce LLM calls.
 * 
 * Benefits:
 * - Faster response time
 * - Lower API costs
 * - Consistent responses
 * - Works offline if LLM is down
 * 
 * REFACTORED: Now uses centralized patterns and templates from constants/
 */

import {
  GREETING_PATTERNS,
  CONFIRMATION_PATTERNS,
  THANKS_PATTERNS,
  KNOWLEDGE_JAM_BUKA_PATTERNS,
  KNOWLEDGE_LOKASI_PATTERNS,
  KNOWLEDGE_LAYANAN_PATTERNS,
  KNOWLEDGE_SYARAT_PATTERNS,
  KNOWLEDGE_BIAYA_PATTERNS,
  matchesAnyPattern,
} from '../constants/intent-patterns';

import {
  GREETING_RESPONSES,
  THANKS_RESPONSES,
  CONFIRMATION_RESPONSES,
  JAM_BUKA_RESPONSE,
  LOKASI_RESPONSE,
  LAYANAN_RESPONSE,
  SYARAT_UMUM_RESPONSE,
  BIAYA_RESPONSE,
  getRandomItem,
} from '../constants/response-templates';

// ==================== TYPES ====================

export interface TemplateMatch {
  matched: boolean;
  response?: string;
  intent?: string;
  confidence: number;
}

// ==================== MAIN FUNCTION ====================

/**
 * Try to match message with templates
 * Returns response if matched, null otherwise
 * Uses centralized patterns from constants/intent-patterns.ts
 */
export function matchTemplate(message: string): TemplateMatch {
  const cleanMessage = message.trim();

  // Check greetings (using centralized patterns)
  if (matchesAnyPattern(cleanMessage, GREETING_PATTERNS)) {
    return {
      matched: true,
      response: getRandomItem(GREETING_RESPONSES),
      intent: 'GREETING',
      confidence: 0.95,
    };
  }

  // Check thanks (using centralized patterns)
  if (matchesAnyPattern(cleanMessage, THANKS_PATTERNS)) {
    return {
      matched: true,
      response: getRandomItem(THANKS_RESPONSES),
      intent: 'THANKS',
      confidence: 0.95,
    };
  }

  // Check confirmations (short messages only, using centralized patterns)
  if (cleanMessage.length < 15 && matchesAnyPattern(cleanMessage, CONFIRMATION_PATTERNS)) {
    return {
      matched: true,
      response: getRandomItem(CONFIRMATION_RESPONSES),
      intent: 'CONFIRMATION',
      confidence: 0.9,
    };
  }

  // Check jam buka (using centralized patterns)
  if (matchesAnyPattern(cleanMessage, KNOWLEDGE_JAM_BUKA_PATTERNS)) {
    return {
      matched: true,
      response: JAM_BUKA_RESPONSE,
      intent: 'KNOWLEDGE_QUERY',
      confidence: 0.9,
    };
  }

  // Check lokasi (using centralized patterns)
  if (matchesAnyPattern(cleanMessage, KNOWLEDGE_LOKASI_PATTERNS)) {
    return {
      matched: true,
      response: LOKASI_RESPONSE,
      intent: 'KNOWLEDGE_QUERY',
      confidence: 0.9,
    };
  }

  // Check layanan (using centralized patterns)
  if (matchesAnyPattern(cleanMessage, KNOWLEDGE_LAYANAN_PATTERNS)) {
    return {
      matched: true,
      response: LAYANAN_RESPONSE,
      intent: 'KNOWLEDGE_QUERY',
      confidence: 0.9,
    };
  }

  // Check syarat (using centralized patterns)
  if (matchesAnyPattern(cleanMessage, KNOWLEDGE_SYARAT_PATTERNS)) {
    return {
      matched: true,
      response: SYARAT_UMUM_RESPONSE,
      intent: 'KNOWLEDGE_QUERY',
      confidence: 0.85,
    };
  }

  // Check biaya (using centralized patterns)
  if (matchesAnyPattern(cleanMessage, KNOWLEDGE_BIAYA_PATTERNS)) {
    return {
      matched: true,
      response: BIAYA_RESPONSE,
      intent: 'KNOWLEDGE_QUERY',
      confidence: 0.9,
    };
  }

  return { matched: false, confidence: 0 };
}

// ==================== EXPORTS ====================

export default {
  matchTemplate,
};
