/**
 * Message Complexity Analyzer
 *
 * Analyzes message complexity for monitoring and analytics.
 * Routing logic has been removed — all messages use the NLU pipeline.
 */

import { extractAllEntities } from './entity-extractor.service';

// ==================== TYPES ====================

export interface ComplexityAnalysis {
  score: number; // 0-100
  level: 'simple' | 'moderate' | 'complex';
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

const SIMPLE_THRESHOLD = 30;
const COMPLEX_THRESHOLD = 60;

const WEIGHTS = {
  messageLength: 0.15,
  entityCount: 0.20,
  intentAmbiguity: 0.25,
  multipleIntents: 0.15,
  requiresContext: 0.10,
  isTransactional: 0.15,
};

const LENGTH_SCORES: Array<{ max: number; score: number }> = [
  { max: 20, score: 10 },
  { max: 50, score: 30 },
  { max: 100, score: 50 },
  { max: Infinity, score: 70 },
];

// ==================== MAIN ====================

/**
 * Analyze message complexity (for analytics / debug endpoints).
 */
export function analyzeComplexity(message: string, conversationHistory?: string): ComplexityAnalysis {
  const factors = {
    messageLength: scoreMessageLength(message),
    entityCount: scoreEntityCount(message, conversationHistory),
    intentAmbiguity: scoreIntentAmbiguity(message),
    hasMultipleIntents: hasMultipleIntents(message),
    requiresContext: requiresConversationContext(message, conversationHistory),
    isTransactional: isTransactionalMessage(message),
  };

  const score = calculateScore(factors);
  const level = score < SIMPLE_THRESHOLD ? 'simple' : score > COMPLEX_THRESHOLD ? 'complex' : 'moderate';
  const reasoning = buildReasoning(factors, score);

  return { score, level, factors, reasoning };
}

// ==================== ROUTING STATS (deprecated, kept for dashboard compat) ====================

let totalRouted = 0;

export function recordRouting(): void {
  totalRouted++;
}

export function getRoutingStats() {
  return {
    totalRouted,
    architecture: 'NLU-based with Micro NLU',
  };
}

export function resetRoutingStats(): void {
  totalRouted = 0;
}

// ==================== SCORING HELPERS ====================

function scoreMessageLength(message: string): number {
  const len = message.trim().length;
  return (LENGTH_SCORES.find((s) => len <= s.max) ?? LENGTH_SCORES[LENGTH_SCORES.length - 1]).score;
}

function scoreEntityCount(message: string, history?: string): number {
  const count = extractAllEntities(message, history || '').extractedCount;
  if (count === 0) return 10;
  if (count <= 2) return 30;
  if (count <= 4) return 50;
  return 70;
}

function scoreIntentAmbiguity(message: string): number {
  const patterns = [
    /\b(lapor|pengaduan|keluhan|komplain)\b/i,
    /\b(mau|ingin|butuh|perlu)\s+(buat|bikin|urus)\b/i,
    /\b(status|cek|lihat)\b/i,
    /\b(batal|cancel)\b/i,
    /\b(info|informasi|tanya|gimana|bagaimana)\b/i,
    /\b(kontak|nomor|telepon)\b/i,
  ];
  const matchCount = patterns.filter((p) => p.test(message)).length;
  if (matchCount === 0) return 50;
  if (matchCount === 1) return 10;
  if (matchCount === 2) return 40;
  return 70;
}

function hasMultipleIntents(message: string): boolean {
  return [
    /\b(dan|juga|serta|terus|lalu|kemudian)\b.*\b(mau|ingin|tolong|bisa)\b/i,
    /\b(pertama|kedua|selain|selanjutnya)\b/i,
  ].some((p) => p.test(message));
}

function requiresConversationContext(message: string, history?: string): boolean {
  const contextPatterns = [
    /\b(itu|ini|tadi|sebelumnya|yang\s+tadi)\b/i,
    /\b(lanjut|lanjutkan|teruskan)\b/i,
    /\b(sama|seperti)\s+(yang|tadi)\b/i,
  ];
  return contextPatterns.some((p) => p.test(message)) && !!history && history.length > 0;
}

function isTransactionalMessage(message: string): boolean {
  return [
    /\b(buat|bikin|daftar|ajukan|layanan|permohonan)\b/i,
    /\b(lapor|aduan|keluhan|komplain)\b/i,
    /\b(batalkan|cancel|ubah|ganti)\b/i,
  ].some((p) => p.test(message));
}

function calculateScore(factors: ComplexityAnalysis['factors']): number {
  let score = 0;
  score += factors.messageLength * WEIGHTS.messageLength;
  score += factors.entityCount * WEIGHTS.entityCount;
  score += factors.intentAmbiguity * WEIGHTS.intentAmbiguity;
  score += (factors.hasMultipleIntents ? 70 : 10) * WEIGHTS.multipleIntents;
  score += (factors.requiresContext ? 60 : 10) * WEIGHTS.requiresContext;
  score += (factors.isTransactional ? 70 : 10) * WEIGHTS.isTransactional;
  return Math.round(score);
}

function buildReasoning(factors: ComplexityAnalysis['factors'], score: number): string {
  const reasons: string[] = [];
  if (factors.isTransactional) reasons.push('transactional message');
  if (factors.hasMultipleIntents) reasons.push('multiple intents');
  if (factors.intentAmbiguity > 50) reasons.push('ambiguous intent');
  if (factors.entityCount > 30) reasons.push('multiple entities');
  if (factors.requiresContext) reasons.push('requires context');
  if (reasons.length === 0) reasons.push(score < 30 ? 'simple message' : 'moderate complexity');
  return `NLU: ${reasons.join(', ')} (score: ${score})`;
}
