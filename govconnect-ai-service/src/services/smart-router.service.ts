/**
 * Smart Router Service
 * 
 * Analyzes message complexity for monitoring and analytics.
 * All messages use NLU architecture — routing logic has been removed.
 */

import logger from '../utils/logger';
import { extractAllEntities } from './entity-extractor.service';

// ==================== TYPES ====================

export type ArchitectureChoice = 'nlu'; // Only NLU architecture now

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
  const lowerMessage = message.toLowerCase();
  
  // Count intent-indicating keywords
  const intentKeywords = [
    /\b(lapor|pengaduan|keluhan|komplain)\b/i,
    /\b(mau|ingin|butuh|perlu)\s+(buat|bikin|urus)\b/i,
    /\b(status|cek|lihat)\b/i,
    /\b(batal|cancel)\b/i,
    /\b(info|informasi|tanya|gimana|bagaimana)\b/i,
    /\b(kontak|nomor|telepon)\b/i,
  ];
  
  let matchCount = 0;
  for (const pattern of intentKeywords) {
    if (pattern.test(lowerMessage)) {
      matchCount++;
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
  // All messages now use NLU architecture
  return 'nlu';
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
  nlu: 0,
  totalRouted: 0,
};

export function recordRouting(architecture: ArchitectureChoice): void {
  routingStats.totalRouted++;
  routingStats.nlu++;
}

export function getRoutingStats() {
  return {
    ...routingStats,
    architecture: 'NLU-based with Micro NLU',
    note: 'Two-layer architecture has been deprecated',
  };
}

export function resetRoutingStats(): void {
  routingStats = { nlu: 0, totalRouted: 0 };
}

export default {
  analyzeComplexity,
  recordRouting,
  getRoutingStats,
  resetRoutingStats,
};
