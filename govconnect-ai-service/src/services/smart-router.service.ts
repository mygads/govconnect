/**
 * Smart Router Service
 * 
 * Intelligent routing that selects architecture based on message complexity.
 * Simple messages → Single-Layer (faster, cheaper)
 * Complex messages → 2-Layer (more accurate)
 * 
 * Complexity factors:
 * - Message length
 * - Entity count
 * - Intent ambiguity
 * - Conversation context
 */

import logger from '../utils/logger';
import { extractAllEntities } from './entity-extractor.service';
import INTENT_PATTERNS from '../constants/intent-patterns';

// ==================== TYPES ====================

export type ArchitectureChoice = 'single-layer' | 'two-layer';

export interface ComplexityAnalysis {
  score: number;           // 0-100
  level: 'simple' | 'moderate' | 'complex';
  recommendedArchitecture: ArchitectureChoice;
  factors: {
    messageLength: number;
    entityCount: number;
    intentAmbiguity: number;
    hasMultipleIntents: boolean;
    requiresContext: boolean;
    isTransactional: boolean;
  };
  reasoning: string;
}

// ==================== CONFIGURATION ====================

const COMPLEXITY_CONFIG = {
  // Thresholds
  simpleThreshold: 30,      // Below this = simple
  complexThreshold: 60,     // Above this = complex

  // Weights for scoring
  weights: {
    messageLength: 0.15,
    entityCount: 0.20,
    intentAmbiguity: 0.25,
    multipleIntents: 0.15,
    requiresContext: 0.10,
    isTransactional: 0.15,
  },

  // Message length scoring
  lengthScoring: {
    short: { max: 20, score: 10 },
    medium: { max: 50, score: 30 },
    long: { max: 100, score: 50 },
    veryLong: { max: Infinity, score: 70 },
  },
};

// Simple patterns that don't need 2-layer
const SIMPLE_PATTERNS = [
  /^(halo|hai|hi|hello|hey)[\s!.,]*$/i,
  /^(selamat\s+(pagi|siang|sore|malam))[\s!.,]*$/i,
  /^(terima\s*kasih|makasih|thanks|thx)[\s!.,]*$/i,
  /^(oke|ok|baik|siap|ya)[\s!.,]*$/i,
  /^(bye|dadah|sampai\s+jumpa)[\s!.,]*$/i,
];

// Transactional intents that benefit from 2-layer
const TRANSACTIONAL_INTENTS = [
  'CREATE_COMPLAINT',
  'UPDATE_COMPLAINT',
  'CREATE_SERVICE_REQUEST',
  'CANCEL_COMPLAINT',
];

// ==================== MAIN FUNCTIONS ====================

/**
 * Analyze message complexity and recommend architecture
 */
export function analyzeComplexity(
  message: string,
  conversationHistory?: string
): ComplexityAnalysis {
  const factors = {
    messageLength: scoreMessageLength(message),
    entityCount: scoreEntityCount(message, conversationHistory),
    intentAmbiguity: scoreIntentAmbiguity(message),
    hasMultipleIntents: hasMultipleIntents(message),
    requiresContext: requiresConversationContext(message, conversationHistory),
    isTransactional: isTransactionalMessage(message),
  };

  // Calculate weighted score
  const score = calculateComplexityScore(factors);

  // Determine level and architecture
  const level = score < COMPLEXITY_CONFIG.simpleThreshold ? 'simple'
    : score > COMPLEXITY_CONFIG.complexThreshold ? 'complex'
      : 'moderate';

  const recommendedArchitecture = determineArchitecture(score, factors);
  const reasoning = generateReasoning(factors, score, recommendedArchitecture);

  logger.debug('Complexity analysis completed', {
    messagePreview: message.substring(0, 50),
    score,
    level,
    recommendedArchitecture,
    factors,
  });

  return {
    score,
    level,
    recommendedArchitecture,
    factors,
    reasoning,
  };
}

/**
 * Quick check if message is simple (for fast path)
 */
export function isSimpleMessage(message: string): boolean {
  // Check against simple patterns
  for (const pattern of SIMPLE_PATTERNS) {
    if (pattern.test(message.trim())) {
      return true;
    }
  }

  // Very short messages are usually simple
  if (message.trim().length < 15) {
    return true;
  }

  return false;
}

/**
 * Route message to appropriate architecture
 */
export function routeMessage(
  message: string,
  conversationHistory?: string,
  forceArchitecture?: ArchitectureChoice
): ArchitectureChoice {
  // Allow forcing architecture (for testing or specific cases)
  if (forceArchitecture) {
    return forceArchitecture;
  }

  // Quick check for simple messages
  if (isSimpleMessage(message)) {
    logger.debug('Quick route: simple message detected', {
      messagePreview: message.substring(0, 30),
    });
    return 'single-layer';
  }

  // Full complexity analysis
  const analysis = analyzeComplexity(message, conversationHistory);
  return analysis.recommendedArchitecture;
}

// ==================== SCORING FUNCTIONS ====================

function scoreMessageLength(message: string): number {
  const length = message.trim().length;
  const { lengthScoring } = COMPLEXITY_CONFIG;

  if (length <= lengthScoring.short.max) return lengthScoring.short.score;
  if (length <= lengthScoring.medium.max) return lengthScoring.medium.score;
  if (length <= lengthScoring.long.max) return lengthScoring.long.score;
  return lengthScoring.veryLong.score;
}

function scoreEntityCount(message: string, history?: string): number {
  const entities = extractAllEntities(message, history || '');
  const count = entities.extractedCount;

  // More entities = more complex
  if (count === 0) return 10;
  if (count <= 2) return 30;
  if (count <= 4) return 50;
  return 70;
}

function scoreIntentAmbiguity(message: string): number {
  let matchCount = 0;
  const lowerMessage = message.toLowerCase();

  // Count how many intent patterns match
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    if (Array.isArray(patterns)) {
      for (const pattern of patterns) {
        if (pattern.test(lowerMessage)) {
          matchCount++;
          break; // Only count once per intent
        }
      }
    }
  }

  // More matches = more ambiguous
  if (matchCount === 0) return 50; // Unknown = moderate complexity
  if (matchCount === 1) return 10; // Clear intent
  if (matchCount === 2) return 40;
  return 70; // Very ambiguous
}

function hasMultipleIntents(message: string): boolean {
  // Check for conjunctions that might indicate multiple intents
  const multiIntentPatterns = [
    /\b(dan|juga|serta|terus|lalu|kemudian)\b.*\b(mau|ingin|tolong|bisa)\b/i,
    /\b(pertama|kedua|selain|selanjutnya)\b/i,
  ];

  return multiIntentPatterns.some(p => p.test(message));
}

function requiresConversationContext(message: string, history?: string): boolean {
  // Check for references to previous conversation
  const contextPatterns = [
    /\b(itu|ini|tadi|sebelumnya|yang\s+tadi)\b/i,
    /\b(lanjut|lanjutkan|teruskan)\b/i,
    /\b(sama|seperti)\s+(yang|tadi)\b/i,
  ];

  const needsContext = contextPatterns.some(p => p.test(message));

  // Also check if there's history to reference
  return needsContext && !!history && history.length > 0;
}

function isTransactionalMessage(message: string): boolean {
  const lowerMessage = message.toLowerCase();

  // Check for transactional keywords
  const transactionalPatterns = [
    /\b(buat|bikin|daftar|ajukan|layanan|permohonan)\b/i,
    /\b(lapor|aduan|keluhan|komplain)\b/i,
    /\b(batalkan|cancel|ubah|ganti)\b/i,
  ];

  return transactionalPatterns.some(p => p.test(lowerMessage));
}

function calculateComplexityScore(factors: ComplexityAnalysis['factors']): number {
  const { weights } = COMPLEXITY_CONFIG;

  let score = 0;
  score += factors.messageLength * weights.messageLength;
  score += factors.entityCount * weights.entityCount;
  score += factors.intentAmbiguity * weights.intentAmbiguity;
  score += (factors.hasMultipleIntents ? 70 : 10) * weights.multipleIntents;
  score += (factors.requiresContext ? 60 : 10) * weights.requiresContext;
  score += (factors.isTransactional ? 70 : 10) * weights.isTransactional;

  return Math.round(score);
}

function determineArchitecture(
  score: number,
  factors: ComplexityAnalysis['factors']
): ArchitectureChoice {
  // Force 2-layer for transactional messages (accuracy matters more)
  if (factors.isTransactional) {
    return 'two-layer';
  }

  // Force single-layer for very simple messages
  if (score < 20) {
    return 'single-layer';
  }

  // Use threshold for others
  return score > COMPLEXITY_CONFIG.simpleThreshold ? 'two-layer' : 'single-layer';
}

function generateReasoning(
  factors: ComplexityAnalysis['factors'],
  score: number,
  architecture: ArchitectureChoice
): string {
  const reasons: string[] = [];

  if (factors.isTransactional) {
    reasons.push('transactional message requires accuracy');
  }
  if (factors.hasMultipleIntents) {
    reasons.push('multiple intents detected');
  }
  if (factors.intentAmbiguity > 50) {
    reasons.push('ambiguous intent');
  }
  if (factors.entityCount > 30) {
    reasons.push('multiple entities to extract');
  }
  if (factors.requiresContext) {
    reasons.push('requires conversation context');
  }

  if (reasons.length === 0) {
    reasons.push(score < 30 ? 'simple message' : 'moderate complexity');
  }

  return `${architecture}: ${reasons.join(', ')} (score: ${score})`;
}

// ==================== STATS ====================

let routingStats = {
  singleLayer: 0,
  twoLayer: 0,
  totalRouted: 0,
};

export function recordRouting(architecture: ArchitectureChoice): void {
  routingStats.totalRouted++;
  if (architecture === 'single-layer') {
    routingStats.singleLayer++;
  } else {
    routingStats.twoLayer++;
  }
}

export function getRoutingStats() {
  return {
    ...routingStats,
    singleLayerPercent: routingStats.totalRouted > 0
      ? ((routingStats.singleLayer / routingStats.totalRouted) * 100).toFixed(1) + '%'
      : '0%',
    twoLayerPercent: routingStats.totalRouted > 0
      ? ((routingStats.twoLayer / routingStats.totalRouted) * 100).toFixed(1) + '%'
      : '0%',
  };
}

export function resetRoutingStats(): void {
  routingStats = { singleLayer: 0, twoLayer: 0, totalRouted: 0 };
}

export default {
  analyzeComplexity,
  isSimpleMessage,
  routeMessage,
  recordRouting,
  getRoutingStats,
  resetRoutingStats,
};
