/**
 * Sentiment Analysis Service
 * 
 * Detects user mood/sentiment for escalation and adaptive responses.
 * Uses micro-LLM (Gemini Flash Lite) for all sentiment classification.
 * 
 * No hardcoded regex patterns — the LLM understands Indonesian sentiment,
 * slang, abbreviations, urgency, and conversational context far better
 * than any fixed keyword list.
 */

import logger from '../utils/logger';
import { LRUCache } from '../utils/lru-cache';
import { classifySentimentUrgency } from './micro-llm-matcher.service';

export type SentimentLevel = 'positive' | 'neutral' | 'negative' | 'angry' | 'urgent';

export interface SentimentResult {
  level: SentimentLevel;
  score: number;         // -1 to 1 (-1 = very negative, 1 = very positive)
  triggers: string[];    // Words/phrases that triggered this sentiment
  isEscalationCandidate: boolean;
  urgencyLevel: number;  // 0-3 (0 = normal, 3 = emergency)
  suggestedTone: string; // Hint for AI response tone
}

// Bounded LRU cache for tracking consecutive sentiment per user.
// TTL = 1 hour, max 500 users.
const sentimentHistory = new LRUCache<string, { score: number; timestamp: number }[]>({
  maxSize: 500,
  ttlMs: 60 * 60 * 1000,
  name: 'sentiment-history',
});

/**
 * Response tone suggestions based on sentiment
 */
const TONE_SUGGESTIONS: Record<SentimentLevel, string> = {
  angry: 'Gunakan nada yang sangat empati dan menenangkan. Minta maaf dengan tulus, validasi perasaan user, fokus pada solusi konkret.',
  negative: 'Tunjukkan empati, minta maaf atas ketidaknyamanan, berikan informasi yang jelas dan solusi.',
  neutral: 'Nada profesional dan ramah seperti biasa.',
  positive: 'Apresiasi feedback positif, tetap ramah dan helpful.',
  urgent: 'Prioritaskan urgensi, tunjukkan bahwa masalah ini serius dan akan ditangani segera. Berikan langkah darurat jika ada.',
};

/** Score mapping from sentiment level */
const SCORE_MAP: Record<SentimentLevel, number> = {
  angry: -0.8,
  negative: -0.4,
  neutral: 0,
  positive: 0.6,
  urgent: -0.2,
};

/**
 * Analyze sentiment of a message (sync fallback — returns neutral).
 * Kept for backward compat; prefer analyzeSentimentWithLLM() in async contexts.
 */
export function analyzeSentiment(message: string, _wa_user_id?: string): SentimentResult {
  // Sync path cannot call LLM. Return neutral — the async path handles real analysis.
  return {
    level: 'neutral',
    score: 0,
    triggers: [],
    isEscalationCandidate: false,
    urgencyLevel: 0,
    suggestedTone: TONE_SUGGESTIONS.neutral,
  };
}

/**
 * Full sentiment analysis via micro-LLM.
 * 
 * The LLM handles all sentiment/urgency classification in a single call:
 * - Detects anger, frustration, satisfaction, urgency
 * - Understands Indonesian slang, abbreviations, and context
 * - Returns structured { sentiment, urgency, confidence, reason }
 * 
 * Falls back to neutral if LLM is unavailable (graceful degradation).
 */
export async function analyzeSentimentWithLLM(
  message: string,
  wa_user_id?: string,
  context?: { village_id?: string; wa_user_id?: string; session_id?: string; channel?: string }
): Promise<SentimentResult> {
  if (!message || message.trim().length < 2) {
    return {
      level: 'neutral',
      score: 0,
      triggers: [],
      isEscalationCandidate: false,
      urgencyLevel: 0,
      suggestedTone: TONE_SUGGESTIONS.neutral,
    };
  }

  try {
    const llmResult = await classifySentimentUrgency(message, context);
    
    if (!llmResult) {
      // LLM unavailable — return neutral (graceful degradation)
      return {
        level: 'neutral',
        score: 0,
        triggers: [],
        isEscalationCandidate: false,
        urgencyLevel: 0,
        suggestedTone: TONE_SUGGESTIONS.neutral,
      };
    }

    // Map LLM result to SentimentResult
    const level: SentimentLevel = llmResult.sentiment;
    const urgencyLevel = llmResult.urgency;
    const score = SCORE_MAP[level] ?? 0;

    // Check escalation based on history
    let isEscalationCandidate = false;
    
    if (wa_user_id) {
      const history = sentimentHistory.get(wa_user_id) || [];
      history.push({ score, timestamp: Date.now() });
      if (history.length > 10) history.shift();
      sentimentHistory.set(wa_user_id, history);

      // 3+ consecutive negative → escalation candidate
      const recentNegative = history.slice(-3).filter(h => h.score < -0.3);
      if (recentNegative.length >= 3) {
        isEscalationCandidate = true;
        logger.warn('🚨 User showing consecutive negative sentiment - escalation candidate', {
          wa_user_id,
          recentScores: history.slice(-3).map(h => h.score.toFixed(2)),
        });
      }

      // Also escalate on angry + high urgency
      if (level === 'angry' && urgencyLevel >= 2) {
        isEscalationCandidate = true;
      }
    }

    const result: SentimentResult = {
      level,
      score,
      triggers: llmResult.reason ? [llmResult.reason] : [],
      isEscalationCandidate,
      urgencyLevel,
      suggestedTone: TONE_SUGGESTIONS[level],
    };

    // Log significant sentiment
    if (level === 'angry' || level === 'urgent' || isEscalationCandidate) {
      logger.info('😤 Significant sentiment detected', {
        wa_user_id,
        level,
        score: score.toFixed(2),
        urgency: urgencyLevel,
        escalation: isEscalationCandidate,
        reason: llmResult.reason,
      });
    }

    return result;
  } catch (err: any) {
    logger.debug('[Sentiment] LLM analysis failed, returning neutral', { error: err.message });
    return {
      level: 'neutral',
      score: 0,
      triggers: [],
      isEscalationCandidate: false,
      urgencyLevel: 0,
      suggestedTone: TONE_SUGGESTIONS.neutral,
    };
  }
}

/**
 * Get sentiment context for LLM prompt injection
 */
export function getSentimentContext(sentiment: SentimentResult): string {
  if (sentiment.level === 'neutral' || sentiment.level === 'positive') {
    return '';
  }

  const urgencyNote = sentiment.urgencyLevel >= 2 
    ? '\n⚠️ URGENSI TINGGI: Masalah ini membutuhkan penanganan segera!' 
    : '';

  const escalationNote = sentiment.isEscalationCandidate
    ? '\n⚠️ ESKALASI: User menunjukkan frustasi berulang. Pertimbangkan untuk menawarkan hubungan langsung dengan petugas.'
    : '';

  return `
[SENTIMENT TERDETEKSI: ${sentiment.level.toUpperCase()}]
Skor: ${sentiment.score.toFixed(2)} | Urgensi: ${sentiment.urgencyLevel}/3
Kata pemicu: ${sentiment.triggers.join(', ') || '-'}
${urgencyNote}${escalationNote}

INSTRUKSI NADA: ${sentiment.suggestedTone}`;
}

/**
 * Check if user needs human escalation
 */
export function needsHumanEscalation(wa_user_id: string): boolean {
  const history = sentimentHistory.get(wa_user_id);
  if (!history || history.length < 3) return false;

  // Check last 5 messages
  const recent = history.slice(-5);
  const negativeCount = recent.filter(h => h.score < -0.3).length;
  const angryCount = recent.filter(h => h.score < -0.6).length;

  // Escalate if: 4+ negative in last 5, OR 2+ angry in last 5
  return negativeCount >= 4 || angryCount >= 2;
}

/**
 * Reset sentiment history for user (after successful resolution)
 */
export function resetSentimentHistory(wa_user_id: string): void {
  sentimentHistory.delete(wa_user_id);
  logger.debug('Sentiment history reset', { wa_user_id });
}

/**
 * Get current escalation status for dashboard
 */
export function getEscalationStatus(wa_user_id: string): {
  needsEscalation: boolean;
  recentSentiments: SentimentLevel[];
  avgScore: number;
} {
  const history = sentimentHistory.get(wa_user_id);
  
  if (!history || history.length === 0) {
    return {
      needsEscalation: false,
      recentSentiments: [],
      avgScore: 0,
    };
  }

  const recent = history.slice(-5);
  const avgScore = recent.reduce((sum, h) => sum + h.score, 0) / recent.length;
  
  const recentSentiments: SentimentLevel[] = recent.map(h => {
    if (h.score <= -0.6) return 'angry';
    if (h.score <= -0.2) return 'negative';
    if (h.score >= 0.3) return 'positive';
    return 'neutral';
  });

  return {
    needsEscalation: needsHumanEscalation(wa_user_id),
    recentSentiments,
    avgScore,
  };
}
