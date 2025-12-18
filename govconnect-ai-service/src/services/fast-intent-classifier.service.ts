/**
 * Fast Intent Classifier Service
 * 
 * Klasifikasi intent cepat menggunakan pattern matching sebelum LLM.
 * Mengurangi latency dan cost untuk pesan-pesan yang jelas intentnya.
 * 
 * Flow:
 * 1. Fast classify dengan regex patterns
 * 2. Jika confidence tinggi (>0.8) → skip LLM untuk intent detection
 * 3. Jika confidence rendah → fallback ke LLM
 * 
 * REFACTORED: Now uses centralized patterns from constants/intent-patterns.ts
 */

import logger from '../utils/logger';
import {
  GREETING_PATTERNS,
  CONFIRMATION_PATTERNS,
  REJECTION_PATTERNS,
  THANKS_PATTERNS,
  CREATE_COMPLAINT_PATTERNS,
  CREATE_RESERVATION_PATTERNS,
  UPDATE_RESERVATION_PATTERNS,
  CHECK_STATUS_PATTERNS,
  CANCEL_PATTERNS,
  HISTORY_PATTERNS,
  KNOWLEDGE_QUERY_PATTERNS,
  COMPLAINT_CATEGORY_PATTERNS,
  SERVICE_CODE_PATTERNS,
  matchesAnyPattern,
  findMatchingCategory,
} from '../constants/intent-patterns';

export interface FastClassifyResult {
  intent: string;
  confidence: number;
  extractedFields: Record<string, any>;
  skipLLM: boolean;
  reason: string;
}

// ==================== ENTITY EXTRACTION ====================

/**
 * Extract complaint category from message
 * Uses centralized patterns from constants
 */
function extractComplaintCategory(message: string): string | null {
  return findMatchingCategory(message, COMPLAINT_CATEGORY_PATTERNS);
}

/**
 * Extract service code from message
 * Uses centralized patterns from constants
 */
function extractServiceCode(message: string): string | null {
  return findMatchingCategory(message, SERVICE_CODE_PATTERNS);
}

/**
 * Extract complaint/reservation ID from message
 */
function extractIds(message: string): { complaintId?: string; reservationId?: string } {
  const result: { complaintId?: string; reservationId?: string } = {};
  
  const lapMatch = message.match(/\b(LAP-\d{8}-\d{3})\b/i);
  if (lapMatch) result.complaintId = lapMatch[1].toUpperCase();
  
  const rsvMatch = message.match(/\b(RSV-\d{8}-\d{3})\b/i);
  if (rsvMatch) result.reservationId = rsvMatch[1].toUpperCase();
  
  return result;
}

/**
 * Extract NIK from message
 */
function extractNIK(message: string): string | null {
  const nikMatch = message.match(/\b(\d{16})\b/);
  return nikMatch ? nikMatch[1] : null;
}

/**
 * Extract phone number from message
 */
function extractPhone(message: string): string | null {
  const phoneMatch = message.match(/\b(08\d{8,12})\b/);
  return phoneMatch ? phoneMatch[1] : null;
}

// ==================== MAIN CLASSIFIER ====================

/**
 * Fast classify intent using pattern matching
 * Returns null if no confident match found (should fallback to LLM)
 */
export function fastClassifyIntent(message: string): FastClassifyResult | null {
  const cleanMessage = message.trim();
  const lowerMessage = cleanMessage.toLowerCase();
  
  // Skip very long messages - let LLM handle complex queries
  if (cleanMessage.length > 300) {
    logger.debug('[FastClassifier] Message too long, skipping', { length: cleanMessage.length });
    return null;
  }
  
  // 1. Check GREETING (highest confidence for short greetings)
  if (cleanMessage.length < 30) {
    for (const pattern of GREETING_PATTERNS) {
      if (pattern.test(cleanMessage)) {
        return {
          intent: 'GREETING',
          confidence: 0.95,
          extractedFields: {},
          skipLLM: false, // Still use LLM for personalized greeting
          reason: 'Greeting pattern matched',
        };
      }
    }
  }
  
  // 2. Check CONFIRMATION (very short messages)
  if (cleanMessage.length < 20) {
    for (const pattern of CONFIRMATION_PATTERNS) {
      if (pattern.test(cleanMessage)) {
        return {
          intent: 'CONFIRMATION',
          confidence: 0.95,
          extractedFields: { isConfirmation: true },
          skipLLM: true, // Can handle without LLM
          reason: 'Confirmation pattern matched',
        };
      }
    }
    
    for (const pattern of REJECTION_PATTERNS) {
      if (pattern.test(cleanMessage)) {
        return {
          intent: 'REJECTION',
          confidence: 0.95,
          extractedFields: { isRejection: true },
          skipLLM: true,
          reason: 'Rejection pattern matched',
        };
      }
    }
    
    for (const pattern of THANKS_PATTERNS) {
      if (pattern.test(cleanMessage)) {
        return {
          intent: 'THANKS',
          confidence: 0.95,
          extractedFields: {},
          skipLLM: true,
          reason: 'Thanks pattern matched',
        };
      }
    }
  }
  
  // 3. Check CHECK_STATUS (with ID extraction)
  const ids = extractIds(cleanMessage);
  if (ids.complaintId || ids.reservationId) {
    return {
      intent: 'CHECK_STATUS',
      confidence: 0.95,
      extractedFields: {
        complaint_id: ids.complaintId,
        reservation_id: ids.reservationId,
      },
      skipLLM: true, // Can directly check status
      reason: 'Status check with ID detected',
    };
  }
  
  for (const pattern of CHECK_STATUS_PATTERNS) {
    if (pattern.test(lowerMessage)) {
      return {
        intent: 'CHECK_STATUS',
        confidence: 0.85,
        extractedFields: {},
        skipLLM: false, // Need LLM to ask for ID
        reason: 'Status check pattern matched',
      };
    }
  }
  
  // 4. Check UPDATE_RESERVATION (before CANCEL to avoid confusion)
  for (const pattern of UPDATE_RESERVATION_PATTERNS) {
    if (pattern.test(lowerMessage)) {
      return {
        intent: 'UPDATE_RESERVATION',
        confidence: ids.reservationId ? 0.9 : 0.75,
        extractedFields: {
          reservation_id: ids.reservationId,
        },
        skipLLM: false, // Need LLM to ask for new date/time
        reason: 'Update reservation pattern matched',
      };
    }
  }
  
  // 5. Check CANCEL
  for (const pattern of CANCEL_PATTERNS) {
    if (pattern.test(lowerMessage)) {
      return {
        intent: ids.complaintId ? 'CANCEL_COMPLAINT' : ids.reservationId ? 'CANCEL_RESERVATION' : 'CANCEL',
        confidence: 0.85,
        extractedFields: {
          complaint_id: ids.complaintId,
          reservation_id: ids.reservationId,
        },
        skipLLM: !!(ids.complaintId || ids.reservationId),
        reason: 'Cancel pattern matched',
      };
    }
  }
  
  // 6. Check HISTORY
  for (const pattern of HISTORY_PATTERNS) {
    if (pattern.test(lowerMessage)) {
      return {
        intent: 'HISTORY',
        confidence: 0.9,
        extractedFields: {},
        skipLLM: true, // Can directly fetch history
        reason: 'History pattern matched',
      };
    }
  }
  
  // 6. Check CREATE_COMPLAINT (with category extraction)
  for (const pattern of CREATE_COMPLAINT_PATTERNS) {
    if (pattern.test(lowerMessage)) {
      const kategori = extractComplaintCategory(lowerMessage);
      return {
        intent: 'CREATE_COMPLAINT',
        confidence: kategori ? 0.9 : 0.8,
        extractedFields: {
          kategori,
        },
        skipLLM: false, // Need LLM for address extraction and response
        reason: 'Complaint pattern matched' + (kategori ? ` (${kategori})` : ''),
      };
    }
  }
  
  // 7. Check CREATE_RESERVATION (with service code extraction)
  for (const pattern of CREATE_RESERVATION_PATTERNS) {
    if (pattern.test(lowerMessage)) {
      const serviceCode = extractServiceCode(lowerMessage);
      const nik = extractNIK(cleanMessage);
      const phone = extractPhone(cleanMessage);
      
      return {
        intent: 'CREATE_RESERVATION',
        confidence: serviceCode ? 0.9 : 0.8,
        extractedFields: {
          service_code: serviceCode,
          nik,
          phone,
        },
        skipLLM: false, // Need LLM for data collection flow
        reason: 'Reservation pattern matched' + (serviceCode ? ` (${serviceCode})` : ''),
      };
    }
  }
  
  // 9. Check KNOWLEDGE_QUERY
  for (const pattern of KNOWLEDGE_QUERY_PATTERNS) {
    if (pattern.test(lowerMessage)) {
      return {
        intent: 'KNOWLEDGE_QUERY',
        confidence: 0.85,
        extractedFields: {},
        skipLLM: false, // Need LLM + RAG for knowledge response
        reason: 'Knowledge query pattern matched',
      };
    }
  }
  
  // No confident match - fallback to LLM
  logger.debug('[FastClassifier] No confident match, fallback to LLM', {
    messagePreview: cleanMessage.substring(0, 50),
  });
  
  return null;
}

/**
 * Check if message is a simple confirmation that can skip LLM
 */
export function isSimpleConfirmation(message: string): boolean {
  const result = fastClassifyIntent(message);
  return result?.intent === 'CONFIRMATION' && result.skipLLM === true;
}

/**
 * Check if message is a simple rejection
 */
export function isSimpleRejection(message: string): boolean {
  const result = fastClassifyIntent(message);
  return result?.intent === 'REJECTION' && result.skipLLM === true;
}

/**
 * Check if message is a thanks/closing
 */
export function isSimpleThanks(message: string): boolean {
  const result = fastClassifyIntent(message);
  return result?.intent === 'THANKS' && result.skipLLM === true;
}

export default {
  fastClassifyIntent,
  isSimpleConfirmation,
  isSimpleRejection,
  isSimpleThanks,
  extractComplaintCategory,
  extractServiceCode,
  extractIds,
  extractNIK,
  extractPhone,
};
