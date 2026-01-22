/**
 * Enhanced Conversation Context Manager
 * 
 * Memperbaiki FSM dengan context yang lebih kaya:
 * - Tracking clarification count (untuk detect frustasi)
 * - Conversation summary (untuk context yang lebih baik)
 * - Last question tracking (untuk follow-up yang tepat)
 * - Intent confidence tracking
 * 
 * Bekerja bersama conversation-fsm.service.ts
 */

import logger from '../utils/logger';
import { getContext as getFSMContext, ConversationState } from './conversation-fsm.service';

// ==================== TYPES ====================

export interface EnhancedContext {
  userId: string;
  
  // Current conversation state
  currentIntent: string;
  intentConfidence: number;
  fsmState: ConversationState;
  
  // Data collection
  collectedData: Record<string, any>;
  missingFields: string[];
  validationErrors: string[];
  
  // Conversation flow tracking
  clarificationCount: number;
  lastQuestionAsked: string;
  lastQuestionField: string;
  unansweredQuestions: string[];
  
  // Context summary
  conversationSummary: string;
  keyPoints: string[];
  
  // Timing
  conversationStartTime: number;
  lastActivityTime: number;
  totalTurns: number;
  
  // Flags
  isStuck: boolean; // User tidak progress setelah beberapa clarification
  needsHumanHelp: boolean;
  hasCompletedAction: boolean;
}

interface ContextUpdate {
  currentIntent?: string;
  intentConfidence?: number;
  collectedData?: Record<string, any>;
  missingFields?: string[];
  validationErrors?: string[];
  lastQuestionAsked?: string;
  lastQuestionField?: string;
  keyPoints?: string[];
}

// ==================== STORAGE ====================

const contextCache = new Map<string, EnhancedContext>();

// Cleanup expired contexts (older than 30 minutes)
const CONTEXT_TTL = 30 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [userId, ctx] of contextCache.entries()) {
    if (now - ctx.lastActivityTime > CONTEXT_TTL) {
      contextCache.delete(userId);
      logger.debug('[ConversationContext] Cleaned up expired context', { userId });
    }
  }
}, 5 * 60 * 1000);

// ==================== CORE FUNCTIONS ====================

/**
 * Get or create enhanced context for user
 */
export function getEnhancedContext(userId: string): EnhancedContext {
  let ctx = contextCache.get(userId);
  
  if (!ctx) {
    ctx = createInitialContext(userId);
    contextCache.set(userId, ctx);
  }
  
  // Sync with FSM state
  const fsmCtx = getFSMContext(userId);
  ctx.fsmState = fsmCtx.state;
  ctx.collectedData = { ...ctx.collectedData, ...fsmCtx.collectedData };
  ctx.missingFields = fsmCtx.missingFields;
  
  return ctx;
}

/**
 * Create initial context
 */
function createInitialContext(userId: string): EnhancedContext {
  const now = Date.now();
  
  return {
    userId,
    currentIntent: '',
    intentConfidence: 0,
    fsmState: 'IDLE',
    collectedData: {},
    missingFields: [],
    validationErrors: [],
    clarificationCount: 0,
    lastQuestionAsked: '',
    lastQuestionField: '',
    unansweredQuestions: [],
    conversationSummary: '',
    keyPoints: [],
    conversationStartTime: now,
    lastActivityTime: now,
    totalTurns: 0,
    isStuck: false,
    needsHumanHelp: false,
    hasCompletedAction: false,
  };
}

/**
 * Update context with new information
 */
export function updateContext(userId: string, updates: ContextUpdate): EnhancedContext {
  const ctx = getEnhancedContext(userId);
  
  if (updates.currentIntent !== undefined) {
    // Track intent change
    if (ctx.currentIntent && ctx.currentIntent !== updates.currentIntent) {
      ctx.keyPoints.push(`Intent berubah: ${ctx.currentIntent} → ${updates.currentIntent}`);
    }
    ctx.currentIntent = updates.currentIntent;
  }
  
  if (updates.intentConfidence !== undefined) {
    ctx.intentConfidence = updates.intentConfidence;
  }
  
  if (updates.collectedData !== undefined) {
    ctx.collectedData = { ...ctx.collectedData, ...updates.collectedData };
  }
  
  if (updates.missingFields !== undefined) {
    ctx.missingFields = updates.missingFields;
  }
  
  if (updates.validationErrors !== undefined) {
    ctx.validationErrors = updates.validationErrors;
  }
  
  if (updates.lastQuestionAsked !== undefined) {
    // Track unanswered questions
    if (ctx.lastQuestionAsked && ctx.lastQuestionField) {
      // Check if previous question was answered
      const wasAnswered = ctx.collectedData[ctx.lastQuestionField] !== undefined;
      if (!wasAnswered) {
        ctx.unansweredQuestions.push(ctx.lastQuestionAsked);
      }
    }
    ctx.lastQuestionAsked = updates.lastQuestionAsked;
  }
  
  if (updates.lastQuestionField !== undefined) {
    ctx.lastQuestionField = updates.lastQuestionField;
  }
  
  if (updates.keyPoints !== undefined) {
    ctx.keyPoints = [...ctx.keyPoints, ...updates.keyPoints].slice(-10); // Keep last 10
  }
  
  ctx.lastActivityTime = Date.now();
  ctx.totalTurns++;
  
  // Update conversation summary
  ctx.conversationSummary = buildConversationSummary(ctx);
  
  // Check if user is stuck
  ctx.isStuck = checkIfStuck(ctx);
  ctx.needsHumanHelp = ctx.isStuck || ctx.clarificationCount >= 5;
  
  contextCache.set(userId, ctx);
  
  return ctx;
}

/**
 * Record a clarification (user didn't provide expected data)
 */
export function recordClarification(userId: string, field: string, reason: string): void {
  const ctx = getEnhancedContext(userId);
  
  ctx.clarificationCount++;
  ctx.validationErrors.push(`${field}: ${reason}`);
  ctx.lastActivityTime = Date.now();
  
  // Check if stuck
  if (ctx.clarificationCount >= 3) {
    ctx.isStuck = true;
    logger.warn('[ConversationContext] User appears stuck', {
      userId,
      clarificationCount: ctx.clarificationCount,
      field,
    });
  }
  
  if (ctx.clarificationCount >= 5) {
    ctx.needsHumanHelp = true;
    logger.warn('[ConversationContext] User needs human help', {
      userId,
      clarificationCount: ctx.clarificationCount,
    });
  }
  
  contextCache.set(userId, ctx);
}

/**
 * Record successful data collection
 */
export function recordDataCollected(userId: string, field: string, value: any): void {
  const ctx = getEnhancedContext(userId);
  
  ctx.collectedData[field] = value;
  
  // Remove from missing fields
  ctx.missingFields = ctx.missingFields.filter(f => f !== field);
  
  // Clear validation errors for this field
  ctx.validationErrors = ctx.validationErrors.filter(e => !e.startsWith(`${field}:`));
  
  // Add to key points
  ctx.keyPoints.push(`${field}: ${typeof value === 'string' ? value.substring(0, 30) : value}`);
  
  ctx.lastActivityTime = Date.now();
  
  contextCache.set(userId, ctx);
}

/**
 * Record completed action (complaint/layanan dibuat)
 */
export function recordCompletedAction(userId: string, actionType: string, resultId: string): void {
  const ctx = getEnhancedContext(userId);
  
  ctx.hasCompletedAction = true;
  ctx.keyPoints.push(`✅ ${actionType} berhasil: ${resultId}`);
  ctx.conversationSummary = buildConversationSummary(ctx);
  
  // Reset clarification count on success
  ctx.clarificationCount = 0;
  ctx.isStuck = false;
  ctx.needsHumanHelp = false;
  
  contextCache.set(userId, ctx);
  
  logger.info('[ConversationContext] Action completed', {
    userId,
    actionType,
    resultId,
    totalTurns: ctx.totalTurns,
  });
}

/**
 * Reset context (start fresh conversation)
 */
export function resetContext(userId: string): void {
  contextCache.delete(userId);
  logger.debug('[ConversationContext] Context reset', { userId });
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Build conversation summary from context
 */
function buildConversationSummary(ctx: EnhancedContext): string {
  const parts: string[] = [];
  
  if (ctx.currentIntent) {
    parts.push(`Intent: ${ctx.currentIntent}`);
  }
  
  if (ctx.fsmState !== 'IDLE') {
    parts.push(`State: ${ctx.fsmState}`);
  }
  
  const collectedFields = Object.keys(ctx.collectedData).filter(k => ctx.collectedData[k]);
  if (collectedFields.length > 0) {
    parts.push(`Data terkumpul: ${collectedFields.join(', ')}`);
  }
  
  if (ctx.missingFields.length > 0) {
    parts.push(`Masih perlu: ${ctx.missingFields.join(', ')}`);
  }
  
  if (ctx.clarificationCount > 0) {
    parts.push(`Clarification: ${ctx.clarificationCount}x`);
  }
  
  if (ctx.hasCompletedAction) {
    parts.push('✅ Aksi selesai');
  }
  
  return parts.join(' | ');
}

/**
 * Check if user is stuck (not progressing)
 */
function checkIfStuck(ctx: EnhancedContext): boolean {
  // Stuck if: 3+ clarifications on same field
  if (ctx.clarificationCount >= 3) {
    return true;
  }
  
  // Stuck if: same missing fields for 5+ turns
  if (ctx.totalTurns >= 5 && ctx.missingFields.length > 0) {
    // Check if we've been asking for same field
    const sameFieldCount = ctx.unansweredQuestions.filter(
      q => q === ctx.lastQuestionAsked
    ).length;
    
    if (sameFieldCount >= 2) {
      return true;
    }
  }
  
  return false;
}

// ==================== CONTEXT FOR LLM ====================

/**
 * Get context string for LLM prompt injection
 */
export function getContextForLLM(userId: string): string {
  const ctx = getEnhancedContext(userId);
  
  if (ctx.fsmState === 'IDLE' && !ctx.currentIntent) {
    return '';
  }
  
  const parts: string[] = [];
  
  // Current state
  parts.push(`[CONVERSATION CONTEXT]`);
  parts.push(`State: ${ctx.fsmState}`);
  
  if (ctx.currentIntent) {
    parts.push(`Intent: ${ctx.currentIntent} (confidence: ${(ctx.intentConfidence * 100).toFixed(0)}%)`);
  }
  
  // Collected data
  const collectedEntries = Object.entries(ctx.collectedData)
    .filter(([_, v]) => v !== undefined && v !== null && v !== '');
  
  if (collectedEntries.length > 0) {
    parts.push(`\nData yang sudah dikumpulkan:`);
    for (const [key, value] of collectedEntries) {
      const displayValue = typeof value === 'string' ? value.substring(0, 50) : value;
      parts.push(`- ${key}: ${displayValue}`);
    }
  }
  
  // Missing fields
  if (ctx.missingFields.length > 0) {
    parts.push(`\nData yang masih diperlukan: ${ctx.missingFields.join(', ')}`);
  }
  
  // Last question (untuk follow-up)
  if (ctx.lastQuestionAsked) {
    parts.push(`\nPertanyaan terakhir: "${ctx.lastQuestionAsked}"`);
  }
  
  // Stuck warning
  if (ctx.isStuck) {
    parts.push(`\n⚠️ User tampak kesulitan (${ctx.clarificationCount}x clarification). Coba pendekatan berbeda atau tawarkan bantuan manual.`);
  }
  
  // Human help needed
  if (ctx.needsHumanHelp) {
    parts.push(`\n🚨 User mungkin perlu bantuan manusia. Tawarkan untuk dihubungkan dengan petugas.`);
  }
  
  return parts.join('\n');
}

/**
 * Get smart follow-up question based on context
 */
export function getSmartFollowUp(userId: string): string | null {
  const ctx = getEnhancedContext(userId);
  
  if (ctx.missingFields.length === 0) {
    return null;
  }
  
  const nextField = ctx.missingFields[0];
  
  // If we've asked this before, try different approach
  const askedBefore = ctx.unansweredQuestions.some(q => 
    q.toLowerCase().includes(nextField.toLowerCase())
  );
  
  const questionVariants: Record<string, string[]> = {
    'alamat': [
      'Di mana lokasi masalahnya? Sebutkan alamat atau patokan terdekat.',
      'Boleh sebutkan alamatnya? Bisa pakai nama jalan, gang, atau patokan seperti "depan masjid X".',
      'Untuk lokasi, cukup sebutkan patokan yang mudah ditemukan petugas ya.',
    ],
    'kategori': [
      'Jenis masalah apa yang ingin dilaporkan?',
      'Masalahnya tentang apa? Jalan rusak, lampu mati, sampah, atau yang lain?',
      'Bisa jelaskan masalahnya? Nanti saya bantu kategorikan.',
    ],
    'nama_lengkap': [
      'Siapa nama lengkap Kakak sesuai KTP?',
      'Boleh sebutkan nama lengkap untuk data layanan?',
      'Nama lengkapnya siapa ya Kak?',
    ],
    'nik': [
      'Berapa NIK (16 digit) Kakak?',
      'Boleh sebutkan NIK-nya? 16 digit angka di KTP.',
      'NIK-nya berapa Kak? Yang 16 digit di KTP.',
    ],
  };
  
  const variants = questionVariants[nextField];
  if (variants) {
    const index = askedBefore ? Math.min(ctx.clarificationCount, variants.length - 1) : 0;
    return variants[index];
  }
  
  return `Boleh sebutkan ${nextField.replace(/_/g, ' ')} Kakak?`;
}

// ==================== EXPORTS ====================

export default {
  getEnhancedContext,
  updateContext,
  recordClarification,
  recordDataCollected,
  recordCompletedAction,
  resetContext,
  getContextForLLM,
  getSmartFollowUp,
};
