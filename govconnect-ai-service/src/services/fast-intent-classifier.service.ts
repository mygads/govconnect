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
  SERVICE_INFO_PATTERNS,
  CREATE_SERVICE_REQUEST_PATTERNS,
  UPDATE_SERVICE_REQUEST_PATTERNS,
  CHECK_STATUS_PATTERNS,
  CANCEL_PATTERNS,
  CANCEL_SERVICE_PATTERNS,
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
 * Extract complaint/service request ID from message
 */
function extractIds(message: string): { complaintId?: string; requestNumber?: string } {
  const result: { complaintId?: string; requestNumber?: string } = {};
  
  const lapMatch = message.match(/\b(LAP-\d{8}-\d{3})\b/i);
  if (lapMatch) result.complaintId = lapMatch[1].toUpperCase();
  
  const layMatch = message.match(/\b(LAY-\d{8}-\d{3})\b/i);
  if (layMatch) result.requestNumber = layMatch[1].toUpperCase();
  
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
  if (ids.complaintId || ids.requestNumber) {
    return {
      intent: 'CHECK_STATUS',
      confidence: 0.95,
      extractedFields: {
        complaint_id: ids.complaintId,
        request_number: ids.requestNumber,
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
  
  // 4. Check CANCEL (only if ID is present, otherwise let LLM decide)
  const cancelPatterns = [...CANCEL_PATTERNS, ...CANCEL_SERVICE_PATTERNS];
  for (const pattern of cancelPatterns) {
    if (pattern.test(lowerMessage)) {
      if (ids.requestNumber) {
        return {
          intent: 'CANCEL_SERVICE_REQUEST',
          confidence: 0.88,
          extractedFields: {
            request_number: ids.requestNumber,
          },
          skipLLM: true,
          reason: 'Cancel service request with ID detected',
        };
      }

      if (ids.complaintId) {
        return {
          intent: 'CANCEL_COMPLAINT',
          confidence: 0.88,
          extractedFields: {
            complaint_id: ids.complaintId,
          },
          skipLLM: true,
          reason: 'Cancel complaint with ID detected',
        };
      }

      return {
        intent: 'CANCEL_COMPLAINT',
        confidence: 0.6,
        extractedFields: {},
        skipLLM: false,
        reason: 'Cancel intent without ID, requires LLM clarification',
      };
    }
  }

  // 5. Check UPDATE_SERVICE_REQUEST
  for (const pattern of UPDATE_SERVICE_REQUEST_PATTERNS) {
    if (pattern.test(lowerMessage)) {
      if (ids.requestNumber) {
        return {
          intent: 'UPDATE_SERVICE_REQUEST',
          confidence: 0.85,
          extractedFields: { request_number: ids.requestNumber },
          skipLLM: true,
          reason: 'Update service request with ID detected',
        };
      }

      return {
        intent: 'UPDATE_SERVICE_REQUEST',
        confidence: 0.6,
        extractedFields: {},
        skipLLM: false,
        reason: 'Update service request without ID, requires clarification',
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
  
  // 7. Check SERVICE_INFO
  for (const pattern of SERVICE_INFO_PATTERNS) {
    if (pattern.test(lowerMessage)) {
      return {
        intent: 'SERVICE_INFO',
        confidence: 0.85,
        extractedFields: {
          service_code: extractServiceCode(lowerMessage),
        },
        skipLLM: false,
        reason: 'Service info pattern matched',
      };
    }
  }
  
  // 8. Check CREATE_SERVICE_REQUEST
  for (const pattern of CREATE_SERVICE_REQUEST_PATTERNS) {
    if (pattern.test(lowerMessage)) {
      return {
        intent: 'CREATE_SERVICE_REQUEST',
        confidence: 0.85,
        extractedFields: {
          service_code: extractServiceCode(lowerMessage),
        },
        skipLLM: false,
        reason: 'Service request pattern matched',
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
