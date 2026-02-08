/**
 * Response Adapter Service
 * 
 * Mengadaptasi response AI berdasarkan:
 * - Sentiment user (empathetic jika negatif)
 * - User profile (formal/informal)
 * - Conversation context (stuck/frustrated)
 * - Urgency level
 * 
 * Juga menangani offer human takeover ketika diperlukan.
 */

import logger from '../utils/logger';
import { SentimentResult, getEscalationStatus } from './sentiment-analysis.service';
import { getProfile, UserProfile } from './user-profile.service';
import { getEnhancedContext, EnhancedContext } from './conversation-context.service';

// ==================== TYPES ====================

export interface AdaptationContext {
  userId: string;
  sentiment: SentimentResult;
  profile: UserProfile;
  conversationContext: EnhancedContext;
}

export interface AdaptedResponse {
  response: string;
  guidanceText?: string;
  shouldOfferHumanHelp: boolean;
  adaptationsApplied: string[];
}

// ==================== EMPATHY PREFIXES ====================

const EMPATHY_PREFIXES: Record<string, string[]> = {
  angry: [
    'Saya sangat memahami kekesalan Bapak/Ibu, dan saya minta maaf atas ketidaknyamanan ini. ',
    'Mohon maaf atas situasi ini Pak/Bu, saya paham ini sangat menjengkelkan. ',
    'Saya mengerti Bapak/Ibu sedang kesal, dan itu wajar. Izinkan saya bantu selesaikan. ',
  ],
  negative: [
    'Saya paham ini tidak mudah Pak/Bu. ',
    'Mohon maaf atas ketidaknyamanannya. ',
    'Saya mengerti Pak/Bu, mari kita selesaikan bersama. ',
  ],
  urgent: [
    '🚨 Saya paham ini situasi darurat. ',
    '⚠️ Baik Pak/Bu, saya prioritaskan ini. ',
    'Saya mengerti urgensinya Pak/Bu. ',
  ],
  frustrated: [
    'Saya minta maaf jika penjelasan saya kurang jelas. Mari coba cara lain. ',
    'Maaf ya Pak/Bu jika membingungkan. Saya coba jelaskan lebih sederhana. ',
    'Saya paham ini membuat frustrasi. Izinkan saya bantu dengan cara berbeda. ',
  ],
};

// ==================== HUMAN HELP OFFERS ====================

const HUMAN_HELP_OFFERS: string[] = [
  '\n\n💬 Jika Bapak/Ibu ingin berbicara langsung dengan petugas, ketik "hubungi petugas" ya.',
  '\n\n👤 Bapak/Ibu juga bisa minta bantuan petugas langsung dengan ketik "minta bantuan".',
  '\n\n📞 Kalau mau lebih cepat, Bapak/Ibu bisa ketik "bicara dengan admin" untuk dihubungkan dengan petugas.',
];

// ==================== STYLE ADAPTATIONS ====================

const FORMAL_REPLACEMENTS: [RegExp, string][] = [
  [/\bKak\b/g, 'Bapak/Ibu'],
  [/\bKakak\b/g, 'Bapak/Ibu'],
  [/\bya\b/g, 'ya'],
  [/\bnih\b/g, 'ini'],
  [/\bdeh\b/g, ''],
  [/\bdong\b/g, ''],
  [/\bsih\b/g, ''],
  [/\bbanget\b/g, 'sekali'],
  [/\budah\b/g, 'sudah'],
  [/\bgak\b/g, 'tidak'],
  [/\bga\b/g, 'tidak'],
  [/\bnggak\b/g, 'tidak'],
  [/😊|😃|👋|🙏/g, ''],
];

const INFORMAL_ADDITIONS: [RegExp, string][] = [
  [/\bBapak\/Ibu\b/g, 'Kak'],
  [/\bAnda\b/g, 'Kak'],
  [/\bterima kasih\b/gi, 'makasih'],
];

// ==================== CORE FUNCTIONS ====================

/**
 * Adapt response based on context
 */
export function adaptResponse(
  originalResponse: string,
  userId: string,
  sentiment: SentimentResult,
  guidanceText?: string
): AdaptedResponse {
  const profile = getProfile(userId);
  const conversationContext = getEnhancedContext(userId);
  const escalationStatus = getEscalationStatus(userId);
  
  let response = originalResponse;
  let guidance = guidanceText;
  const adaptationsApplied: string[] = [];
  let shouldOfferHumanHelp = false;
  
  // 1. Add empathy prefix based on sentiment
  if (sentiment.level === 'angry') {
    const prefix = getRandomItem(EMPATHY_PREFIXES.angry);
    response = prefix + response;
    adaptationsApplied.push('empathy_angry');
    shouldOfferHumanHelp = true;
  } else if (sentiment.level === 'negative') {
    const prefix = getRandomItem(EMPATHY_PREFIXES.negative);
    response = prefix + response;
    adaptationsApplied.push('empathy_negative');
  } else if (sentiment.level === 'urgent') {
    const prefix = getRandomItem(EMPATHY_PREFIXES.urgent);
    response = prefix + response;
    adaptationsApplied.push('empathy_urgent');
  }
  
  // 2. Add empathy if user is stuck/frustrated
  if (conversationContext.isStuck && conversationContext.clarificationCount >= 2) {
    if (!adaptationsApplied.includes('empathy_angry') && !adaptationsApplied.includes('empathy_negative')) {
      const prefix = getRandomItem(EMPATHY_PREFIXES.frustrated);
      response = prefix + response;
      adaptationsApplied.push('empathy_frustrated');
    }
    shouldOfferHumanHelp = true;
  }
  
  // 3. Check escalation status
  if (escalationStatus.needsEscalation || conversationContext.needsHumanHelp) {
    shouldOfferHumanHelp = true;
    adaptationsApplied.push('escalation_needed');
  }
  
  // 4. Adapt communication style
  if (profile.communication_style === 'formal') {
    response = applyFormalStyle(response);
    if (guidance) guidance = applyFormalStyle(guidance);
    adaptationsApplied.push('style_formal');
  } else if (profile.communication_style === 'informal') {
    response = applyInformalStyle(response);
    if (guidance) guidance = applyInformalStyle(guidance);
    adaptationsApplied.push('style_informal');
  }
  
  // 5. Add human help offer if needed
  if (shouldOfferHumanHelp && !response.includes('petugas') && !response.includes('admin')) {
    const helpOffer = getRandomItem(HUMAN_HELP_OFFERS);
    response = response + helpOffer;
    adaptationsApplied.push('human_help_offer');
  }
  
  // 6. Adjust response length based on preference
  if (profile.response_detail === 'brief' && response.length > 500) {
    response = shortenResponse(response);
    adaptationsApplied.push('shortened');
  }
  
  // Log adaptations
  if (adaptationsApplied.length > 0) {
    logger.info('[ResponseAdapter] Response adapted', {
      userId,
      sentiment: sentiment.level,
      adaptations: adaptationsApplied,
      originalLength: originalResponse.length,
      adaptedLength: response.length,
    });
  }
  
  return {
    response,
    guidanceText: guidance,
    shouldOfferHumanHelp,
    adaptationsApplied,
  };
}

/**
 * Apply formal style to response
 */
function applyFormalStyle(text: string): string {
  let result = text;
  
  for (const [pattern, replacement] of FORMAL_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  
  // Clean up double spaces
  result = result.replace(/\s+/g, ' ').trim();
  
  return result;
}

/**
 * Apply informal style to response
 */
function applyInformalStyle(text: string): string {
  let result = text;
  
  for (const [pattern, replacement] of INFORMAL_ADDITIONS) {
    result = result.replace(pattern, replacement);
  }
  
  return result;
}

/**
 * Shorten response while keeping key information
 */
function shortenResponse(text: string): string {
  // Split into paragraphs
  const paragraphs = text.split('\n\n');
  
  if (paragraphs.length <= 2) {
    return text;
  }
  
  // Keep first and last paragraph, summarize middle
  const first = paragraphs[0];
  const last = paragraphs[paragraphs.length - 1];
  
  // If there are bullet points, keep them
  const bulletParagraphs = paragraphs.filter(p => p.includes('•') || p.includes('-') || p.includes('✅'));
  
  if (bulletParagraphs.length > 0) {
    return [first, bulletParagraphs[0], last].join('\n\n');
  }
  
  return [first, last].join('\n\n');
}

/**
 * Get random item from array
 */
function getRandomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

// ==================== SPECIAL RESPONSES ====================

/**
 * Generate human takeover offer response
 */
export function generateHumanTakeoverOffer(userId: string, reason: string): string {
  const profile = getProfile(userId);
  const isInformal = profile.communication_style === 'informal';
  
  if (isInformal) {
    return `Kak, sepertinya ${reason}. Mau saya hubungkan dengan petugas langsung? Ketik "ya" untuk bicara dengan admin, atau lanjut chat dengan saya juga boleh 😊`;
  }

  
  return `Bapak/Ibu, ${reason}. Apakah Anda ingin saya hubungkan dengan petugas untuk bantuan lebih lanjut? Ketik "ya" untuk berbicara dengan admin, atau silakan lanjutkan percakapan dengan saya.`;
}

/**
 * Generate apology response for repeated issues
 */
export function generateApologyResponse(userId: string, issue: string): string {
  const profile = getProfile(userId);
  const isInformal = profile.communication_style === 'informal';
  
  if (isInformal) {
    return `Maaf banget ya Kak, ${issue}. Saya paham ini bikin kesal. Izinkan saya coba bantu dengan cara lain...`;

  }
  
  return `Mohon maaf atas ${issue}. Kami memahami ketidaknyamanan yang Bapak/Ibu rasakan. Izinkan saya membantu dengan pendekatan yang berbeda...`;
}

/**
 * Generate urgent acknowledgment
 */
export function generateUrgentAcknowledgment(userId: string, urgencyType: string): string {
  const profile = getProfile(userId);
  const isInformal = profile.communication_style === 'informal';
  
  if (isInformal) {
    return `🚨 Kak, saya paham ini ${urgencyType} dan perlu penanganan cepat. Saya prioritaskan laporan ini ya!`;
  }
  
  return `🚨 Kami memahami bahwa ini adalah ${urgencyType} yang memerlukan penanganan segera. Laporan Bapak/Ibu akan kami prioritaskan.`;
}

// ==================== CONTEXT BUILDER ====================

/**
 * Build adaptation context for LLM prompt
 */
export function buildAdaptationContext(
  userId: string,
  sentiment: SentimentResult
): string {
  const profile = getProfile(userId);
  const conversationContext = getEnhancedContext(userId);
  const escalationStatus = getEscalationStatus(userId);
  
  const parts: string[] = [];
  
  // Sentiment instruction
  if (sentiment.level === 'angry' || sentiment.level === 'negative') {
    parts.push(`[SENTIMENT: ${sentiment.level.toUpperCase()}]`);
    parts.push(sentiment.suggestedTone);
  }
  
  // Style instruction
  if (profile.communication_style === 'formal') {
    parts.push('[GAYA: FORMAL] Gunakan bahasa formal, panggil "Bapak/Ibu". Hindari kata santai seperti "Kak", "nih", "banget".');
  } else if (profile.communication_style === 'informal') {
    parts.push('[GAYA: INFORMAL] Gunakan bahasa santai dan friendly, panggil "Kak".');
  }
  
  // Frustration warning
  if (conversationContext.isStuck) {
    parts.push(`[⚠️ USER KESULITAN] User sudah ${conversationContext.clarificationCount}x clarification. Coba pendekatan berbeda atau tawarkan bantuan manual.`);
  }
  
  // Escalation warning
  if (escalationStatus.needsEscalation) {
    parts.push('[🚨 ESKALASI] User menunjukkan frustasi berulang. Tawarkan untuk dihubungkan dengan petugas.');
  }
  
  // Returning user context
  if (profile.total_messages > 10) {
    parts.push(`[USER LAMA] Sudah ${profile.total_messages} interaksi, ${profile.total_complaints} laporan, ${profile.total_service_requests} layanan.`);
  }
  
  if (parts.length === 0) {
    return '';
  }
  
  return '\n' + parts.join('\n');
}

// ==================== EXPORTS ====================

export default {
  adaptResponse,
  generateHumanTakeoverOffer,
  generateApologyResponse,
  generateUrgentAcknowledgment,
  buildAdaptationContext,
};
