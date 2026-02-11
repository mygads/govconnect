/**
 * UMP Utils — shared utility functions used across multiple handler modules.
 *
 * Includes name extraction (NLU), conversation history helpers,
 * address extraction, complaint type resolution, and the webchat
 * context builder.
 */

import logger from '../utils/logger';
import { getWIBDateTime } from '../utils/wib-datetime';
import axios from 'axios';
import { config } from '../config/env';
import { buildContext, buildKnowledgeQueryContext } from './context-builder.service';
import type { PromptFocus } from '../prompts/system-prompt';
import * as systemPromptModule from '../prompts/system-prompt';
import { extractNameViaNLU, analyzeAddress, matchComplaintType } from './micro-llm-matcher.service';
import { getVillageProfileSummary } from './knowledge.service';
import { getComplaintTypes } from './case-client.service';
import type { ChannelType } from './ump-formatters';
import { buildComplaintCategoriesText } from './complaint-handler';
import { conversationHistoryCache, complaintTypeCache } from './ump-state';
import { RAGContext } from '../types/embedding.types';

// ==================== NAME EXTRACTION ====================

/**
 * Extract name from text using micro NLU.
 * Returns null quickly for obviously non-name inputs (empty, too long, numbers only).
 */
export async function extractNameFromTextNLU(
  text: string,
  context?: { village_id?: string; wa_user_id?: string; session_id?: string; channel?: string; last_assistant_message?: string }
): Promise<string | null> {
  const cleaned = (text || '').trim();
  if (!cleaned || cleaned.length > 60 || cleaned.length < 2) return null;
  // Pure numbers/symbols → not a name
  if (/^[\d\s\W]+$/.test(cleaned)) return null;

  const result = await extractNameViaNLU(cleaned, context);
  if (!result || !result.name || result.confidence < 0.6) return null;
  return result.name;
}

export async function extractNameFromHistoryNLU(
  history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  context?: { village_id?: string; wa_user_id?: string; session_id?: string; channel?: string }
): Promise<string | null> {
  if (!history || history.length === 0) return null;
  // Find the last assistant message for context
  let lastAssistantMsg = '';
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].role === 'assistant') {
      lastAssistantMsg = history[i].content || '';
      break;
    }
  }
  // Check user messages from newest to oldest
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const item = history[i];
    if (item.role !== 'user') continue;
    const name = await extractNameFromTextNLU(item.content, { ...context, last_assistant_message: lastAssistantMsg });
    if (name) return name;
  }
  return null;
}

export function getLastAssistantMessage(history?: Array<{ role: 'user' | 'assistant'; content: string }>): string {
  if (!history || history.length === 0) return '';
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const item = history[i];
    if (item.role === 'assistant') return item.content || '';
  }
  return '';
}

export function extractNameFromAssistantPrompt(text?: string): string | null {
  const cleaned = (text || '').trim();
  if (!cleaned) return null;
  const match = cleaned.match(/(?:dengan|ini)\s+(?:Bapak|Ibu|Pak|Bu|Bapak\/Ibu)\s+([a-zA-Z\s]{2,30})/i);
  if (!match?.[1]) return null;
  const name = match[1].trim().split(/\s+/).slice(0, 2).join(' ');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function wasNamePrompted(history?: Array<{ role: 'user' | 'assistant'; content: string }>): boolean {
  if (!history || history.length === 0) return false;
  const lastAssistant = [...history].reverse().find(item => item.role === 'assistant');
  if (!lastAssistant) return false;
  return /(nama|dengan\s+siapa|siapa\s+nama)/i.test(lastAssistant.content);
}

// ==================== CONVERSATION HISTORY ====================

export async function fetchConversationHistoryFromChannel(
  wa_user_id: string,
  village_id?: string
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  // Check cache first — avoids HTTP round-trip per message
  const cached = conversationHistoryCache.get(wa_user_id);
  if (cached) {
    logger.debug('Conversation history served from cache', { wa_user_id, count: cached.history.length });
    return cached.history;
  }

  try {
    const response = await axios.get(`${config.channelServiceUrl}/internal/messages`, {
      params: { wa_user_id, limit: 30, ...(village_id ? { village_id } : {}) },
      headers: { 'x-internal-api-key': config.internalApiKey },
      timeout: 3000,
    });

    const messages = Array.isArray(response.data?.messages) ? response.data.messages : [];
    const ordered = [...messages].sort((a: any, b: any) => {
      const aTime = new Date(a.timestamp || a.created_at || 0).getTime();
      const bTime = new Date(b.timestamp || b.created_at || 0).getTime();
      return aTime - bTime;
    });

    const history = ordered.map((m: any) => ({
      role: (m.direction === 'IN' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.message_text || '',
    }));

    // Cache the result (60s TTL via LRU config)
    conversationHistoryCache.set(wa_user_id, { history, timestamp: Date.now() });
    return history;
  } catch (error: any) {
    logger.warn('Failed to load WhatsApp history for name detection', {
      wa_user_id,
      error: error.message,
    });
    return [];
  }
}

/**
 * Append a message to the conversation history cache for a user.
 * This keeps the cache fresh without needing another HTTP round-trip.
 */
export function appendToHistoryCache(userId: string, role: 'user' | 'assistant', content: string): void {
  const cached = conversationHistoryCache.get(userId);
  if (cached) {
    cached.history.push({ role, content });
    // Keep max 30 messages in cache (FIFO)
    if (cached.history.length > 30) {
      cached.history.shift();
    }
    cached.timestamp = Date.now();
    conversationHistoryCache.set(userId, cached);
  }
}

// ==================== ADDRESS HELPERS ====================

/**
 * Check if an address is too vague/incomplete using micro NLU.
 * Returns true if address needs confirmation.
 */
export async function isVagueAddress(
  alamat: string,
  context?: { village_id?: string; wa_user_id?: string; session_id?: string; channel?: string; kategori?: string }
): Promise<boolean> {
  if (!alamat) return true;

  const cleanAlamat = alamat.trim();
  if (cleanAlamat.length < 3) return true;

  // Fast-path: address with RT+RW or street+number is specific enough — skip LLM call
  const hasRtRw = /\brt\s*\.?\s*\d+\s*[\/\s]*rw\s*\.?\s*\d+/i.test(cleanAlamat);
  const hasStreetNumber = /\b(?:jl|jln|jalan)\.?\s+\w+.*(?:no|nomor|blok)\.?\s*\d+/i.test(cleanAlamat);
  if (hasRtRw || hasStreetNumber) {
    return false; // Address is specific enough
  }

  const result = await analyzeAddress(cleanAlamat, {
    ...context,
    is_complaint_context: true,
    kategori: context?.kategori,
  });

  // If NLU call fails, be lenient (accept the address)
  if (!result) return false;

  return result.quality === 'vague' || result.quality === 'not_address';
}

/**
 * Extract address from message using smart detection
 * IMPROVED: Uses NLU-based address analysis for accurate extraction
 */
export async function extractAddressFromMessage(currentMessage: string, userId: string, context?: { village_id?: string; channel?: string; kategori?: string }): Promise<string> {
  try {
    const result = await analyzeAddress(currentMessage, {
      village_id: context?.village_id, wa_user_id: userId, session_id: userId,
      channel: context?.channel as ChannelType, kategori: context?.kategori,
    });
    if (result && result.has_address && result.address && result.quality !== 'not_address') {
      logger.info('NLU address extraction: address detected', { userId, detectedAlamat: result.address, quality: result.quality });
      return result.address;
    }
  } catch (err) {
    logger.warn('NLU address extraction failed, returning empty', { userId, error: (err as Error).message });
  }
  return '';
}

// ==================== COMPLAINT TYPE RESOLUTION ====================

export async function getCachedComplaintTypes(villageId?: string): Promise<any[]> {
  if (!villageId) return [];

  const cacheKey = villageId;
  const cached = complaintTypeCache.get(cacheKey);

  // LRU cache already handles TTL expiration — .get() returns undefined if expired
  if (cached) {
    return cached.data;
  }

  const data = await getComplaintTypes(villageId);
  complaintTypeCache.set(cacheKey, { data, timestamp: Date.now() });
  return data;
}

/**
 * Resolve complaint type configuration from database using micro LLM.
 */
export async function resolveComplaintTypeConfig(kategori?: string, villageId?: string) {
  if (!kategori || !villageId) return null;

  const types = await getCachedComplaintTypes(villageId);
  if (!types.length) return null;

  // Prepare options for micro LLM
  const options = types
    .filter(t => t?.id && t?.name)
    .map(t => ({
      id: t.id,
      name: t.name,
      categoryName: t.category?.name || 'Lainnya',
    }));

  if (!options.length) return null;

  try {
    const result = await matchComplaintType(kategori, options);

    if (result?.matched_id && result.confidence >= 0.5) {
      const matched = types.find(t => t.id === result.matched_id);
      if (matched) {
        logger.debug('resolveComplaintTypeConfig: Micro LLM match', {
          kategori,
          matchedType: matched.name,
          confidence: result.confidence,
          reason: result.reason,
        });
        return matched;
      }
    }
  } catch (error: any) {
    logger.warn('resolveComplaintTypeConfig: Micro LLM failed, no fallback', {
      error: error.message,
      kategori,
    });
  }

  logger.debug('resolveComplaintTypeConfig: No match found', { kategori, villageId });
  return null;
}

export async function resolveVillageSlugForPublicForm(villageId?: string): Promise<string> {
  if (!villageId) return 'desa';
  try {
    const profile = await getVillageProfileSummary(villageId);
    if (profile?.short_name) return profile.short_name;
  } catch {
    // ignore
  }
  return 'desa';
}

// ==================== WEBCHAT CONTEXT BUILDER ====================

/**
 * Build context with provided conversation history (for webchat)
 */
export async function buildContextWithHistory(
  userId: string,
  currentMessage: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  ragContext?: RAGContext | string,
  villageId?: string,
  promptFocus?: string
): Promise<{ systemPrompt: string; messageCount: number }> {

  const conversationHistory = await (async () => {
    const SUMMARIZE_THRESHOLD = 8;
    const MAX_RECENT = 6;
    if (history.length > SUMMARIZE_THRESHOLD) {
      const older = history.slice(0, history.length - MAX_RECENT);
      const recent = history.slice(-MAX_RECENT);

      // Try micro-LLM summarization for older messages
      let summaryText: string | null = null;
      try {
        const { summarizeConversation } = require('./micro-llm-matcher.service');
        summaryText = await summarizeConversation(
          older.map(m => ({ role: m.role === 'user' ? 'User' : 'Assistant', content: m.content })),
          { wa_user_id: userId }
        );
      } catch { /* fallback below */ }

      let prefix: string;
      if (summaryText) {
        prefix = `[RINGKASAN PERCAKAPAN SEBELUMNYA (${older.length} pesan)]\n${summaryText}\n\n[PERCAKAPAN TERBARU]\n`;
      } else {
        // Fallback: extract key info from older messages instead of dropping them silently
        const keyParts = older
          .filter(m => m.role === 'user')
          .map(m => m.content)
          .filter(c => c.length > 5)
          .slice(-3) // Keep last 3 user messages as keywords
          .map(c => c.substring(0, 80));
        prefix = keyParts.length > 0
          ? `[TOPIK SEBELUMNYA: ${keyParts.join('; ')}]\n\n[PERCAKAPAN TERBARU]\n`
          : '';
      }
      return prefix + recent.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
    }
    return history.slice(-10).map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
  })();

  let knowledgeSection = '';
  if (ragContext) {
    if (typeof ragContext === 'string') {
      knowledgeSection = ragContext ? `\n\nKNOWLEDGE BASE YANG TERSEDIA:\n${ragContext}` : '';
    } else if (ragContext.contextString) {
      const confidence = ragContext.confidence;
      let confidenceInstruction = '';
      if (confidence) {
        switch (confidence.level) {
          case 'high': confidenceInstruction = `\n[CONFIDENCE: TINGGI - ${confidence.reason}]`; break;
          case 'medium': confidenceInstruction = `\n[CONFIDENCE: SEDANG - ${confidence.reason}]`; break;
          case 'low': confidenceInstruction = `\n[CONFIDENCE: RENDAH - ${confidence.reason}]`; break;
        }
      }

      // DB-FIRST PRIORITY instruction
      let dbPriorityInstruction = '';
      if (ragContext.contextString.includes('[SUMBER: DATABASE RESMI')) {
        dbPriorityInstruction = `\n[PRIORITAS DATA] Jika ada data dari DATABASE RESMI dan data serupa dari knowledge base/dokumen, SELALU gunakan data DATABASE RESMI (otoritatif).`;
      }

      // CONFLICT DETECTION instruction
      let conflictInstruction = '';
      if (ragContext.contextString.includes('KONFLIK DATA')) {
        conflictInstruction = `\n[PENANGANAN DATA BERBEDA] Tampilkan SEMUA versi data yang berbeda dan beri tahu user: "Kami menemukan beberapa data yang berbeda dari sumber berbeda." Sarankan konfirmasi ke kantor desa. Jika salah satu sumber adalah DATABASE RESMI, prioritaskan itu.`;
      }

      knowledgeSection = `\n\nKNOWLEDGE BASE YANG TERSEDIA:\n${ragContext.contextString}${confidenceInstruction}${dbPriorityInstruction}${conflictInstruction}`;
    }
  }

  // Calculate current date, time, and tomorrow for prompt (in WIB timezone)
  const wib = getWIBDateTime();
  const currentDate = wib.date;
  const tomorrowDate = wib.tomorrow;
  const currentTime = wib.time;
  const timeOfDay = wib.timeOfDay;

  // Build dynamic complaint categories from DB
  const complaintCategoriesText = await buildComplaintCategoriesText(villageId);

  // Determine if knowledge exists for conditional prompt inclusion
  const hasKnowledge = !!knowledgeSection.trim();
  const getPromptFn = promptFocus && typeof systemPromptModule.getAdaptiveSystemPrompt === 'function'
    ? () => (systemPromptModule as any).getAdaptiveSystemPrompt(promptFocus, hasKnowledge)
    : typeof systemPromptModule.getFullSystemPrompt === 'function'
      ? systemPromptModule.getFullSystemPrompt
      : () => (systemPromptModule as any).SYSTEM_PROMPT_WITH_KNOWLEDGE || '';

  const systemPrompt = getPromptFn()
    .replace('{knowledge_context}', knowledgeSection)
    .replace('{history}', conversationHistory || '(Ini adalah percakapan pertama dengan user)')
    .replace('{user_message}', currentMessage)
    .replace(/\{\{current_date\}\}/g, currentDate)
    .replace(/\{\{tomorrow_date\}\}/g, tomorrowDate)
    .replace(/\{\{current_time\}\}/g, currentTime)
    .replace(/\{\{time_of_day\}\}/g, timeOfDay)
    .replace(/\{\{complaint_categories\}\}/g, complaintCategoriesText);

  return { systemPrompt, messageCount: history.length };
}
