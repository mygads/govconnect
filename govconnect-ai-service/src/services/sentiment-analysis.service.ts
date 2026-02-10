/**
 * Sentiment Analysis Service
 * 
 * Detects user mood/sentiment for escalation and adaptive responses
 * Tracks consecutive negative sentiment for auto-escalation to human agent
 */

import logger from '../utils/logger';
import { LRUCache } from '../utils/lru-cache';

export type SentimentLevel = 'positive' | 'neutral' | 'negative' | 'angry' | 'urgent';

export interface SentimentResult {
  level: SentimentLevel;
  score: number;         // -1 to 1 (-1 = very negative, 1 = very positive)
  triggers: string[];    // Words/phrases that triggered this sentiment
  isEscalationCandidate: boolean;
  urgencyLevel: number;  // 0-3 (0 = normal, 3 = emergency)
  suggestedTone: string; // Hint for AI response tone
}

// Bounded LRU cache replaces unbounded Map + setInterval cleanup.
// TTL = 1 hour (same as previous), max 500 users.
const sentimentHistory = new LRUCache<string, { score: number; timestamp: number }[]>({
  maxSize: 500,
  ttlMs: 60 * 60 * 1000,
  name: 'sentiment-history',
});

/**
 * Sentiment patterns
 */
const SENTIMENT_PATTERNS = {
  // ANGRY patterns - strong negative emotions
  angry: {
    patterns: [
      // Explicit anger/frustration
      /\b(kesal|marah|emosi|jengkel|sebel|sebal|bete|bt|muak|geram|dongkol|murka)\b/gi,
      /\b(parah|payah|buruk|jelek|ancur|hancur|berantakan|kacau|bobrok)\b/gi,
      /\b(gila|sinting|edan|stress|frustasi|frustrasi)\b/gi,
      // Complaints about service
      /\b(ga\s*beres|gak\s*beres|tidak\s*beres|berantakan)\b/gi,
      /\b(gimana\s*sih|apa-apaan|apaan\s*ini|apa\s*ini)\b/gi,
      // Strong negatives
      /\b(sampah|busuk|brengsek|sialan|bangsat)\b/gi,
      // Capitalized (shouting) - weighted less but still counts
      /[A-Z]{4,}/g,
      // Multiple exclamation/question marks
      /[!?]{2,}/g,
    ],
    weight: -0.8,
    urgency: 1,
  },
  
  // NEGATIVE patterns - general dissatisfaction  
  negative: {
    patterns: [
      // Waiting/delay complaints
      /\b(lama|lambat|lemot|telat|terlambat)\b.*\b(banget|sekali|bgt|amat)/gi,
      /\b(sudah|udah|udeh)\s*(berapa|brp)?\s*(lama|hari|minggu|bulan)/gi,
      /\b(kapan|sampe\s*kapan|sampai\s*kapan)\b/gi,
      /\b(belum|blm)\s*(ada|di|jadi|selesai|kelar)/gi,
      // Dissatisfaction
      /\b(kecewa|kurang|tidak\s*puas|gak\s*puas)\b/gi,
      /\b(tidak\s*jelas|gak\s*jelas|membingungkan|bingung)\b/gi,
      /\b(susah|sulit|ribet|repot)\b/gi,
      /\b(gagal|error|salah|keliru)\b/gi,
      // Questions with negative tone
      /\b(kenapa|mengapa)\b.*\b(lama|susah|sulit|tidak|gak)/gi,
      /\b(masa|masak|kok)\b.*\b(gitu|begitu|gini|begini)/gi,
    ],
    weight: -0.5,
    urgency: 0,
  },
  
  // URGENT patterns - time-sensitive or emergency situations
  urgent: {
    patterns: [
      // Emergency keywords
      /\b(darurat|emergency|urgent|segera|cepat|buru-buru)\b/gi,
      /\b(bahaya|berbahaya|mencelakakan|membahayakan)\b/gi,
      /\b(kebakaran|banjir\s*besar|longsor|gempa|kecelakaan)\b/gi,
      /\b(tolong|tolongin|bantuin|help)\b.*\b(segera|cepat|sekarang)/gi,
      // Safety concerns
      /\b(anak|balita|bayi|lansia|orang\s*tua)\b.*\b(bahaya|terjebak|sakit)/gi,
      /\b(terjebak|terperangkap|tenggelam|hanyut)\b/gi,
      // Infrastructure emergencies
      /\b(putus|terputus|rubuh|roboh|ambruk)\b/gi,
      /\b(listrik\s*mati|air\s*mati)\b.*\b(sudah|udah)\s*\d+/gi,
    ],
    weight: 0,  // Neutral sentiment but high urgency
    urgency: 3,
  },
  
  // POSITIVE patterns
  positive: {
    patterns: [
      // Thanks and appreciation
      /\b(terima\s*kasih|makasih|thanks|thx|tq|tengkyu|hatur\s*nuhun|matur\s*nuwun)\b/gi,
      /\b(bagus|mantap|keren|hebat|top|jos|oke|baik|good|great)\b/gi,
      /\b(senang|suka|puas|appreciate|apresiasi)\b/gi,
      /\b(cepat|responsif|tanggap|sigap)\b.*\b(banget|sekali)/gi,
      // Satisfied expressions
      /\b(sudah|udah)\s*(beres|selesai|kelar|solved|fix)/gi,
      /\b(berhasil|sukses|lancar)\b/gi,
      // Emojis (basic detection)
      /[😊🙏👍✅💯🎉😃]/g,
    ],
    weight: 0.6,
    urgency: 0,
  },
  
  // NEUTRAL patterns (reduce sentiment impact)
  neutral: {
    patterns: [
      // Questions without negative tone
      /^(apa|siapa|dimana|kapan|bagaimana|berapa)\b/gi,
      // Simple requests
      /\b(mau|ingin|tolong|mohon|bisa)\b.*\b(tanya|info|bantu)/gi,
      // Greetings
      /^(halo|hai|hi|selamat|assalamualaikum|permisi)\b/gi,
    ],
    weight: 0,
    urgency: 0,
  },
};

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

/**
 * Analyze sentiment of a message
 */
export function analyzeSentiment(message: string, wa_user_id?: string): SentimentResult {
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

  let totalScore = 0;
  let maxUrgency = 0;
  const triggers: string[] = [];

  // Check each sentiment category
  for (const [category, config] of Object.entries(SENTIMENT_PATTERNS)) {
    for (const pattern of config.patterns) {
      const matches = message.match(pattern);
      if (matches) {
        totalScore += matches.length * config.weight;
        maxUrgency = Math.max(maxUrgency, config.urgency);
        triggers.push(...matches.slice(0, 3)); // Limit triggers per category
      }
    }
  }

  // Normalize score to -1 to 1 range
  const normalizedScore = Math.max(-1, Math.min(1, totalScore / 3));

  // Determine sentiment level
  let level: SentimentLevel;
  if (maxUrgency >= 2) {
    level = 'urgent';
  } else if (normalizedScore <= -0.6) {
    level = 'angry';
  } else if (normalizedScore <= -0.2) {
    level = 'negative';
  } else if (normalizedScore >= 0.3) {
    level = 'positive';
  } else {
    level = 'neutral';
  }

  // Check escalation based on history
  let isEscalationCandidate = false;
  
  if (wa_user_id) {
    // Update sentiment history
    const history = sentimentHistory.get(wa_user_id) || [];
    history.push({ score: normalizedScore, timestamp: Date.now() });
    
    // Keep only last 10 messages
    if (history.length > 10) {
      history.shift();
    }
    sentimentHistory.set(wa_user_id, history);

    // Check for consecutive negative sentiment (3+ in a row)
    const recentNegative = history.slice(-3).filter(h => h.score < -0.3);
    if (recentNegative.length >= 3) {
      isEscalationCandidate = true;
      logger.warn('🚨 User showing consecutive negative sentiment - escalation candidate', {
        wa_user_id,
        recentScores: history.slice(-3).map(h => h.score.toFixed(2)),
      });
    }

    // Also escalate on single angry + urgent
    if (level === 'angry' && maxUrgency >= 2) {
      isEscalationCandidate = true;
    }
  }

  const result: SentimentResult = {
    level,
    score: normalizedScore,
    triggers: [...new Set(triggers)].slice(0, 5), // Unique triggers, max 5
    isEscalationCandidate,
    urgencyLevel: maxUrgency,
    suggestedTone: TONE_SUGGESTIONS[level],
  };

  // Log significant sentiment
  if (level === 'angry' || level === 'urgent' || isEscalationCandidate) {
    logger.info('😤 Significant sentiment detected', {
      wa_user_id,
      level,
      score: normalizedScore.toFixed(2),
      urgency: maxUrgency,
      escalation: isEscalationCandidate,
      triggers: result.triggers,
    });
  }

  return result;
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
