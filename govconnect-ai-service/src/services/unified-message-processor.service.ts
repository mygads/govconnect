/**
 * Unified Message Processor Service
 * 
 * SINGLE SOURCE OF TRUTH untuk memproses pesan dari berbagai channel:
 * - WhatsApp (via RabbitMQ)
 * - Webchat (via HTTP)
 * - Channel lain (opsional)
 * 
 * Semua logic NLU, intent detection, RAG, prompt building, dan action handling
 * dipusatkan di sini agar response konsisten di semua channel.
 * 
 * IMPORTANT: File ini berisi semua logic yang sudah di-test dan dilatih dengan baik.
 * Jangan ubah tanpa testing yang memadai.
 * 
 * OPTIMIZATIONS (December 2025):
 * - Fast Intent Classification: Skip LLM untuk intent yang jelas
 * - Response Caching: Cache response untuk pertanyaan berulang
 * - Entity Pre-extraction: Ekstrak data sebelum LLM
 */

import logger from '../utils/logger';
import { getWIBDateTime } from '../utils/wib-datetime';
import axios from 'axios';
import { config } from '../config/env';
import { buildContext, buildKnowledgeQueryContext, sanitizeUserInput } from './context-builder.service';
import type { PromptFocus } from '../prompts/system-prompt';
import * as systemPromptModule from '../prompts/system-prompt';
import { callGemini } from './llm.service';
import {
  createComplaint,
  cancelComplaint,
  cancelServiceRequest,
  getComplaintTypes,
  getUserHistory,
  updateComplaintByUser,
  getServiceRequestStatusWithOwnership,
  requestServiceRequestEditToken,
  getServiceRequirements,
  getComplaintStatusWithOwnership,
  ServiceRequirementDefinition,
  HistoryItem,
} from './case-client.service';
import { getImportantContacts } from './important-contacts.service';
import { searchKnowledge, searchKnowledgeKeywordsOnly, getRAGContext, getKelurahanInfoContext, getVillageProfileSummary, reportKnowledgeGap } from './knowledge.service';
import { shouldRetrieveContext, isSpamMessage } from './rag.service';
import { detectLanguage, getLanguageContext } from './language-detection.service';
import { analyzeSentiment, getSentimentContext, needsHumanEscalation } from './sentiment-analysis.service';
import { rateLimiterService } from './rate-limiter.service';
import { aiAnalyticsService } from './ai-analytics.service';
import { recordTokenUsage } from './token-usage.service';
import { RAGContext } from '../types/embedding.types';
import { preProcessMessage } from './ai-optimizer.service';
import { learnFromMessage, recordInteraction, saveDefaultAddress, getProfileContext, recordServiceUsage, updateProfile, getProfile, clearProfile, deleteProfile } from './user-profile.service';
import { updateConversationUserProfile } from './channel-client.service';
import { getEnhancedContext, updateContext, recordDataCollected, recordCompletedAction, getContextForLLM } from './conversation-context.service';
import { adaptResponse, buildAdaptationContext } from './response-adapter.service';
import { normalizeText } from './text-normalizer.service';
import { classifyConfirmation } from './confirmation-classifier.service';
import {
  appendAntiHallucinationInstruction,
  hasKnowledgeInPrompt,
  logAntiHallucinationEvent,
  needsAntiHallucinationRetry,
  sanitizeFakeLinks,
} from './anti-hallucination.service';
import { matchServiceSlug, matchComplaintType, classifyFarewell, classifyGreeting, classifyNameUpdate, classifyMessage, extractNameViaNLU, classifyKnowledgeSubtype, analyzeAddress, matchContactQuery, classifyUpdateIntent, validateResponseAgainstKnowledge } from './micro-llm-matcher.service';
import type { UnifiedClassifyResult } from './micro-llm-matcher.service';
import { createProcessingTracker } from './processing-status.service';
import { getGraphContextAsync, findNodeByKeywordAsync, getAllServiceCodes, getAllServiceKeywords } from './knowledge-graph.service';
import { getSmartFallback, getErrorFallback } from './fallback-response.service';
import { getCachedResponse, setCachedResponse, isCacheable } from './response-cache.service';

// ==================== TYPES ====================

export type ChannelType = 'whatsapp' | 'webchat' | 'other';

export interface ProcessMessageInput {
  /** Unique user identifier (wa_user_id for WhatsApp, session_id for webchat) */
  userId: string;
  /** Optional tenant context (GovConnect village_id) */
  villageId?: string;
  /** The message text from user */
  message: string;
  /** Channel source */
  channel: ChannelType;
  /** Optional conversation history (for webchat that doesn't use Channel Service) */
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Optional media URL (for complaints with photos) */
  mediaUrl?: string;
  /** Optional media type */
  mediaType?: string;
  /** When true, skip side effects (profile writes, analytics, rate limits, cache writes).
   *  Used by golden-set evaluation to avoid polluting production data. */
  isEvaluation?: boolean;
}

export interface ProcessMessageResult {
  success: boolean;
  /** Main response text */
  response: string;
  /** Optional guidance/follow-up text (sent as separate bubble in WhatsApp) */
  guidanceText?: string;
  /** Detected intent */
  intent: string;
  /** Extracted fields from NLU */
  fields?: Record<string, any>;
  /** Processing metadata */
  metadata: {
    processingTimeMs: number;
    model?: string;
    hasKnowledge: boolean;
    knowledgeConfidence?: string;
    sentiment?: string;
    language?: string;
    /** Unique trace ID for correlating logs across NLU → RAG → LLM → response */
    traceId?: string;
  };
  /** Error message if failed */
  error?: string;
}

// ==================== IN-MEMORY CACHES (Bounded LRU) ====================
// All caches use LRU eviction to prevent unbounded memory growth (OOM protection).
// Max sizes are generous — under normal load each cache holds < 100 entries.

import { LRUCache } from '../utils/lru-cache';

// Address confirmation state cache (for VAGUE addresses)
const pendingAddressConfirmation = new LRUCache<string, {
  alamat: string;
  kategori: string;
  deskripsi: string;
  village_id?: string;
  timestamp: number;
  foto_url?: string;
}>({ maxSize: 1000, ttlMs: 10 * 60 * 1000, name: 'pendingAddressConfirmation' });

// Pending address request cache (for MISSING required addresses)
const pendingAddressRequest = new LRUCache<string, {
  kategori: string;
  deskripsi: string;
  village_id?: string;
  timestamp: number;
  foto_url?: string;
}>({ maxSize: 1000, ttlMs: 10 * 60 * 1000, name: 'pendingAddressRequest' });

// Cancellation confirmation state cache
const pendingCancelConfirmation = new LRUCache<string, {
  type: 'laporan' | 'layanan';
  id: string;
  reason?: string;
  timestamp: number;
}>({ maxSize: 500, ttlMs: 10 * 60 * 1000, name: 'pendingCancelConfirmation' });

// Name confirmation state cache
const pendingNameConfirmation = new LRUCache<string, {
  name: string;
  timestamp: number;
}>({ maxSize: 500, ttlMs: 10 * 60 * 1000, name: 'pendingNameConfirmation' });

// Online service form offer state cache
const pendingServiceFormOffer = new LRUCache<string, {
  service_slug: string;
  village_id?: string;
  timestamp: number;
}>({ maxSize: 500, ttlMs: 10 * 60 * 1000, name: 'pendingServiceFormOffer' });

// Pending complaint data cache (waiting for name/phone before creating complaint)
const pendingComplaintData = new LRUCache<string, {
  kategori: string;
  deskripsi: string;
  alamat?: string;
  rt_rw?: string;
  village_id?: string;
  foto_url?: string;
  channel: ChannelType;
  timestamp: number;
  waitingFor: 'nama' | 'no_hp';
}>({ maxSize: 500, ttlMs: 10 * 60 * 1000, name: 'pendingComplaintData' });

// Accumulated photos cache (for multi-photo complaint support, max 5 per user)
const pendingPhotos = new LRUCache<string, {
  urls: string[];
  timestamp: number;
}>({ maxSize: 500, ttlMs: 10 * 60 * 1000, name: 'pendingPhotos' });

const MAX_PHOTOS_PER_COMPLAINT = 5;

/**
 * Add a photo URL to the pending photos cache for a user.
 * Returns the current count after adding.
 */
function addPendingPhoto(userId: string, photoUrl: string): number {
  const existing = pendingPhotos.get(userId);
  if (existing) {
    if (existing.urls.length >= MAX_PHOTOS_PER_COMPLAINT) {
      return existing.urls.length; // Already at max, don't add
    }
    existing.urls.push(photoUrl);
    existing.timestamp = Date.now();
    return existing.urls.length;
  }
  pendingPhotos.set(userId, { urls: [photoUrl], timestamp: Date.now() });
  return 1;
}

/**
 * Get and clear all pending photos for a user.
 * Returns a foto_url string: single URL or JSON array string for multiple.
 */
function consumePendingPhotos(userId: string, currentMediaUrl?: string): string | undefined {
  const pending = pendingPhotos.get(userId);
  const allUrls: string[] = [];
  
  if (pending) {
    allUrls.push(...pending.urls);
    pendingPhotos.delete(userId);
  }
  
  if (currentMediaUrl && !allUrls.includes(currentMediaUrl)) {
    allUrls.push(currentMediaUrl);
  }
  
  if (allUrls.length === 0) return undefined;
  if (allUrls.length === 1) return allUrls[0]; // Single URL (backward compatible)
  // Enforce max
  const trimmed = allUrls.slice(0, MAX_PHOTOS_PER_COMPLAINT);
  return JSON.stringify(trimmed); // JSON array string for multiple photos
}

/**
 * Get current pending photo count for a user.
 */
function getPendingPhotoCount(userId: string): number {
  return pendingPhotos.get(userId)?.urls.length || 0;
}

// Complaint types cache (per village) — bounded LRU
const complaintTypeCache = new LRUCache<string, { data: any[]; timestamp: number }>({
  maxSize: 100, ttlMs: 5 * 60 * 1000, name: 'complaintTypeCache',
});

// Conversation history cache — avoids HTTP round-trip per message (H2 optimization)
// Key: userId, Value: { history, timestamp }
// New incoming/outgoing messages are appended directly to the cache.
const conversationHistoryCache = new LRUCache<string, {
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  timestamp: number;
}>({ maxSize: 2000, ttlMs: 60 * 1000, name: 'conversationHistoryCache' });

// Service search results cache — avoids HTTP + micro LLM per lookup (M3 optimization)
// Key: `${villageId}:${queryNormalized}`, Value: { slug, name, timestamp }
const serviceSearchCache = new LRUCache<string, {
  slug: string;
  name?: string;
  timestamp: number;
}>({ maxSize: 500, ttlMs: 5 * 60 * 1000, name: 'serviceSearchCache' });

// Cleanup expired entries from all LRU caches (TTL-based purge)
setInterval(() => {
  const caches = [
    pendingAddressConfirmation, pendingAddressRequest, pendingCancelConfirmation,
    pendingNameConfirmation, pendingServiceFormOffer, pendingComplaintData,
    pendingPhotos, complaintTypeCache, conversationHistoryCache,
    serviceSearchCache,
  ];
  let totalPurged = 0;
  for (const cache of caches) {
    totalPurged += cache.purgeExpired();
  }
  if (totalPurged > 0) {
    logger.debug(`Purged ${totalPurged} expired cache entries`);
  }
}, 60 * 1000);

/**
 * Clear ALL in-memory caches (for admin cache management endpoint).
 */
export function clearAllUMPCaches(): { cleared: number; caches: string[] } {
  const cacheList = [
    { cache: pendingAddressConfirmation, name: 'pendingAddressConfirmation' },
    { cache: pendingAddressRequest, name: 'pendingAddressRequest' },
    { cache: pendingCancelConfirmation, name: 'pendingCancelConfirmation' },
    { cache: pendingNameConfirmation, name: 'pendingNameConfirmation' },
    { cache: pendingServiceFormOffer, name: 'pendingServiceFormOffer' },
    { cache: pendingComplaintData, name: 'pendingComplaintData' },
    { cache: pendingPhotos, name: 'pendingPhotos' },
    { cache: complaintTypeCache, name: 'complaintTypeCache' },
    { cache: conversationHistoryCache, name: 'conversationHistoryCache' },
    { cache: serviceSearchCache, name: 'serviceSearchCache' },
  ];
  let cleared = 0;
  const names: string[] = [];
  for (const { cache, name } of cacheList) {
    if (cache.size > 0) {
      cleared += cache.size;
      names.push(`${name}(${cache.size})`);
      cache.clear();
    }
  }
  logger.info(`[Admin] Cleared all UMP caches: ${cleared} entries`, { caches: names });
  return { cleared, caches: names };
}

/**
 * Clear all in-memory caches for a SPECIFIC user.
 * Used when admin clears a conversation or user resets their chat session.
 * Also clears the user profile's personal data (name, phone, etc.)
 */
export function clearUserCaches(userId: string): { cleared: number } {
  const userCaches = [
    pendingAddressConfirmation, pendingAddressRequest, pendingCancelConfirmation,
    pendingNameConfirmation, pendingServiceFormOffer, pendingComplaintData,
    pendingPhotos, conversationHistoryCache,
  ];
  let cleared = 0;
  for (const cache of userCaches) {
    if (cache.get(userId)) {
      cache.delete(userId);
      cleared++;
    }
  }
  // Fully delete user profile so AI has zero memory of this user
  deleteProfile(userId);
  logger.info(`[Admin] Cleared caches for user: ${userId}`, { cleared });
  return { cleared };
}

/**
 * Sync user name to Channel Service conversation record.
 * This updates the sidebar display in the livechat dashboard
 * (shows user name instead of phone number).
 * Non-blocking — failures are logged but don't affect the response.
 */
function syncNameToChannelService(
  channelIdentifier: string,
  userName: string,
  villageId?: string,
  channel?: ChannelType,
): void {
  const channelUpper = (channel || 'whatsapp').toUpperCase() as 'WHATSAPP' | 'WEBCHAT';
  updateConversationUserProfile(channelIdentifier, { user_name: userName }, villageId, channelUpper)
    .then(ok => {
      if (ok) logger.debug('👤 Name synced to Channel Service', { channelIdentifier, userName });
    })
    .catch(() => { /* non-critical */ });
}

/**
 * Get stats from ALL UMP caches (for admin dashboard).
 */
export function getUMPCacheStats() {
  return [
    pendingAddressConfirmation, pendingAddressRequest, pendingCancelConfirmation,
    pendingNameConfirmation, pendingServiceFormOffer, pendingComplaintData,
    pendingPhotos, complaintTypeCache, conversationHistoryCache,
    serviceSearchCache,
  ].map(c => c.getStats());
}

// ==================== ACTIVE PROCESSING TRACKER ====================

let _activeProcessingCount = 0;

/** Get the count of messages currently being processed */
export function getActiveProcessingCount(): number {
  return _activeProcessingCount;
}

/**
 * Wait until all in-flight message processing completes (for graceful shutdown).
 * Polls every 500ms, gives up after maxWaitMs.
 */
export async function drainActiveProcessing(maxWaitMs: number = 15_000): Promise<boolean> {
  if (_activeProcessingCount === 0) return true;
  logger.info(`Draining ${_activeProcessingCount} active message(s)...`);
  const deadline = Date.now() + maxWaitMs;
  while (_activeProcessingCount > 0 && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 500));
  }
  if (_activeProcessingCount > 0) {
    logger.warn(`Drain timeout: ${_activeProcessingCount} message(s) still active after ${maxWaitMs}ms`);
    return false;
  }
  logger.info('All active processing drained');
  return true;
}

// ==================== SHARED CONSTANTS ====================

// COMPLAINT_KEYWORD_PATTERN and LANDMARK_PATTERNS removed — address analysis is now NLU-based.

/**
 * Status display maps — shared across complaint and service request formatters.
 */
const COMPLAINT_STATUS_MAP: Record<string, { emoji: string; text: string; description: string }> = {
  'OPEN': { emoji: '🆕', text: 'OPEN', description: 'Laporan baru diterima dan menunggu diproses.' },
  'PROCESS': { emoji: '🔄', text: 'PROCESS', description: 'Laporan sedang diproses oleh petugas desa.' },
  'DONE': { emoji: '✅', text: 'DONE', description: 'Laporan sudah selesai ditangani.' },
  'CANCELED': { emoji: '🔴', text: 'CANCELED', description: 'Laporan dibatalkan sesuai keterangan.' },
  'REJECT': { emoji: '❌', text: 'REJECT', description: 'Laporan ditolak oleh petugas desa.' },
  'baru': { emoji: '🆕', text: 'OPEN', description: 'Laporan baru diterima dan menunggu diproses.' },
  'proses': { emoji: '🔄', text: 'PROCESS', description: 'Laporan sedang diproses oleh petugas desa.' },
  'selesai': { emoji: '✅', text: 'DONE', description: 'Laporan sudah selesai ditangani.' },
  'dibatalkan': { emoji: '🔴', text: 'CANCELED', description: 'Laporan dibatalkan sesuai keterangan.' },
};

const SERVICE_STATUS_MAP: Record<string, { emoji: string; text: string }> = {
  'OPEN': { emoji: '🆕', text: 'OPEN' },
  'PROCESS': { emoji: '🔄', text: 'PROCESS' },
  'DONE': { emoji: '✅', text: 'DONE' },
  'CANCELED': { emoji: '🔴', text: 'CANCELED' },
  'REJECT': { emoji: '❌', text: 'REJECT' },
  'baru': { emoji: '🆕', text: 'OPEN' },
  'proses': { emoji: '🔄', text: 'PROCESS' },
  'selesai': { emoji: '✅', text: 'DONE' },
  'dibatalkan': { emoji: '🔴', text: 'CANCELED' },
};

// ==================== RESPONSE VALIDATION ====================

/**
 * Profanity patterns to filter from AI response
 */
const PROFANITY_PATTERNS = [
  /\b(anjing|babi|bangsat|kontol|memek|ngentot|jancok|kampret|tai|asu|bajingan|keparat)\b/gi,
  /\b(bodoh|tolol|idiot|goblok|bego|dungu)\b/gi,
];

/**
 * Validate and sanitize AI response before sending to user
 */
export function validateResponse(response: string): string {
  if (!response || response.trim().length === 0) {
    return 'Ada yang bisa saya bantu lagi?';
  }
  
  let cleaned = response;
  for (const pattern of PROFANITY_PATTERNS) {
    cleaned = cleaned.replace(pattern, '***');
  }
  
  // Ensure response isn't too long
  if (cleaned.length > 4000) {
    cleaned = cleaned.substring(0, 3950) + '...\n\nPesan terpotong karena terlalu panjang.';
  }
  
  // Remove raw JSON/code artifacts
  if (cleaned.includes('```') || cleaned.includes('{"')) {
    cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
    cleaned = cleaned.replace(/\{\"[\s\S]*?\}/g, '');
    cleaned = cleaned.trim();
    
    if (cleaned.length < 10) {
      return 'Maaf, terjadi kesalahan. Silakan ulangi pertanyaan Anda.';
    }
  }
  
  return cleaned;
}

// ==================== ADDRESS VALIDATION ====================

/**
 * Check if an address is too vague/incomplete using micro NLU.
 * Returns true if address needs confirmation.
 * Fast-path: skip NLU if address clearly contains RT/RW or street+number.
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

// detectEmergencyComplaint REMOVED — was a no-op stub.
// Emergency detection is fully DB-driven via complaintTypeConfig.is_urgent.

type HandlerResult = string | { replyText: string; guidanceText?: string };

function normalizeHandlerResult(result: HandlerResult): { replyText: string; guidanceText?: string } {
  if (typeof result === 'string') {
    return { replyText: result };
  }
  return {
    replyText: result.replyText,
    guidanceText: result.guidanceText,
  };
}

// expandServiceAlias REMOVED — each village has different abbreviations/aliases.
// matchServiceSlug micro NLU handles semantic matching against the village's service catalog.

async function resolveServiceSlugFromSearch(query: string, villageId?: string): Promise<{ slug: string; name?: string; alternatives?: Array<{ slug: string; name: string }> } | null> {
  const trimmedQuery = (query || '').trim();
  if (!trimmedQuery) return null;

  // Pass raw query directly to micro NLU — no hardcoded alias expansion
  const searchQuery = trimmedQuery;

  // Check service search cache first (M3 optimization)
  const cacheKey = `${villageId || ''}:${searchQuery.toLowerCase()}`;
  const cached = serviceSearchCache.get(cacheKey);
  if (cached) {
    logger.debug('resolveServiceSlugFromSearch: served from cache', { query: trimmedQuery, slug: cached.slug });
    return { slug: cached.slug, name: cached.name };
  }
  try {

    // Fetch candidate services from Case Service
    const response = await axios.get(`${config.caseServiceUrl}/services/search`, {
      params: {
        village_id: villageId,
        q: searchQuery,
        limit: 10,
      },
      headers: { 'x-internal-api-key': config.internalApiKey },
      timeout: 5000,
    });

    let services = Array.isArray(response.data?.data) ? response.data.data : [];
    if (!services.length && villageId) {
      const fallbackResponse = await axios.get(`${config.caseServiceUrl}/services`, {
        params: { village_id: villageId },
        headers: { 'x-internal-api-key': config.internalApiKey },
        timeout: 5000,
      });
      services = Array.isArray(fallbackResponse.data?.data) ? fallbackResponse.data.data : [];
    }
    if (!services.length) return null;

    // Use micro LLM for semantic matching instead of synonym/keyword scoring
    const options = services
      .filter((s: any) => s?.slug)
      .map((s: any) => ({
        slug: String(s.slug),
        name: String(s.name || ''),
        description: String(s.description || ''),
      }));

    if (!options.length) return null;

    const result = await matchServiceSlug(searchQuery, options);

    if (result?.matched_slug && result.confidence >= 0.5) {
      const matched = services.find((s: any) => s.slug === result.matched_slug);
      if (matched) {
        logger.debug('resolveServiceSlugFromSearch: Micro LLM match', {
          query: searchQuery,
          matched_slug: result.matched_slug,
          confidence: result.confidence,
          reason: result.reason,
        });
        const matchResult = { slug: String(matched.slug), name: String(matched.name || '') };
        // Cache the result for 5 min
        serviceSearchCache.set(cacheKey, { ...matchResult, timestamp: Date.now() });
        return matchResult;
      }
    }

    // If ambiguous (matched_slug is null but alternatives exist), return with alternatives
    if (!result?.matched_slug && result?.alternatives && result.alternatives.length > 1) {
      logger.info('resolveServiceSlugFromSearch: Ambiguous match, returning alternatives', {
        query: searchQuery,
        alternatives: result.alternatives,
      });
      return { slug: '', name: '', alternatives: result.alternatives };
    }

    logger.debug('resolveServiceSlugFromSearch: No match via micro LLM', { query: trimmedQuery });
    return null;
  } catch (error: any) {
    logger.warn('Service search lookup failed', { error: error.message, villageId });
    return null;
  }
}

async function getCachedComplaintTypes(villageId?: string): Promise<any[]> {
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
 * Build complaint categories text for injection into LLM prompt.
 * Fetches dynamic categories from Case Service DB and formats them
 * so the LLM knows which kategori values are valid.
 */
async function buildComplaintCategoriesText(villageId?: string): Promise<string> {
  try {
    const types = await getCachedComplaintTypes(villageId);
    if (!types || types.length === 0) {
      logger.warn('No complaint types from DB, using generic fallback');
      return 'lainnya (kategori pengaduan akan disesuaikan oleh sistem berdasarkan deskripsi)';
    }

    // Group by category
    const categoryMap = new Map<string, string[]>();
    for (const type of types) {
      const catName = type?.category?.name || 'Lainnya';
      if (!categoryMap.has(catName)) {
        categoryMap.set(catName, []);
      }
      const typeName = type?.name || '';
      if (typeName) {
        categoryMap.get(catName)!.push(typeName);
      }
    }

    // Format: "Kategori: tipe1, tipe2, tipe3"
    const lines: string[] = [];
    for (const [category, typeNames] of categoryMap) {
      const snakeCaseNames = typeNames.map(n => n.toLowerCase().replace(/\s+/g, '_'));
      lines.push(`- ${category}: ${snakeCaseNames.join(', ')}`);
    }
    lines.push('- lainnya (gunakan jika tidak ada kategori yang cocok)');

    return lines.join('\n');
  } catch (error: any) {
    logger.warn('Failed to build complaint categories text', { error: error.message });
    return 'lainnya (kategori pengaduan akan disesuaikan oleh sistem berdasarkan deskripsi)';
  }
}

/**
 * Resolve complaint type configuration from database using micro LLM.
 *
 * Instead of hardcoded synonyms, sends the user's kategori + all available
 * complaint types to a lightweight Gemini model for semantic matching.
 * This handles slang, typos, regional words, informal language naturally.
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

/**
 * Format URL for clickable link in webchat
 * WhatsApp handles links natively, webchat needs HTML anchor
 */
function formatClickableLink(url: string, channel: ChannelType, label?: string): string {
  // Both channels: just return the URL.
  // The webchat widget will auto-linkify URLs; WhatsApp does it natively.
  if (label && channel === 'webchat') {
    return `${label}:\n${url}`;
  }
  return url;
}

/**
 * Format phone number for clickable display
 * Webchat: show wa.me link so widget auto-linkifies it
 * WhatsApp: just return the number (WA handles it natively)
 */
function formatClickablePhone(phone: string, channel: ChannelType): string {
  // Normalize phone to 62xxx format for wa.me
  const digits = (phone || '').replace(/[^\d]/g, '');
  let normalizedPhone = digits;
  if (digits.startsWith('0')) normalizedPhone = `62${digits.slice(1)}`;
  else if (digits.startsWith('8')) normalizedPhone = `62${digits}`;
  
  if (channel === 'webchat') {
    // Return wa.me link - webchat widget will auto-linkify
    return `https://wa.me/${normalizedPhone}`;
  }
  // For WhatsApp, just return the number - WA handles it natively
  return phone;
}

function buildImportantContactsMessage(contacts: Array<{ name: string; phone: string; description?: string | null }>, channel: ChannelType = 'whatsapp'): string {
  if (!contacts.length) return '';

  const lines = contacts.map(contact => {
    const desc = contact.description ? ` (${contact.description})` : '';
    const phoneFormatted = formatClickablePhone(contact.phone, channel);
    return `• ${contact.name}: ${phoneFormatted}${desc}`;
  });

  return `\n\n📞 *Nomor Penting Terkait*\n${lines.join('\n')}`;
}

// ==================== ACTION HANDLERS ====================

/**
 * Handle complaint creation
 */
export async function handleComplaintCreation(
  userId: string,
  channel: ChannelType,
  llmResponse: any,
  currentMessage: string,
  mediaUrl?: string
): Promise<string> {
  const { kategori, rt_rw } = llmResponse.fields || {};
  let { alamat, deskripsi } = llmResponse.fields || {};
  const villageId = llmResponse.fields?.village_id;
  const complaintTypeConfig = await resolveComplaintTypeConfig(kategori, villageId);
  const requireAddress = complaintTypeConfig?.require_address ?? false;
  
  logger.info('LLM complaint fields', {
    userId,
    kategori,
    alamat,
    deskripsi,
    rt_rw,
    hasMedia: !!mediaUrl,
    currentMessage: currentMessage.substring(0, 100),
  });
  
  // SMART ALAMAT DETECTION: If LLM didn't extract alamat, try NLU-based extraction
  if (!alamat) {
    alamat = await extractAddressFromMessage(currentMessage, userId, { village_id: villageId, channel, kategori });
  }
  
  // Fallback: if deskripsi is empty but we have kategori, generate default description
  if (!deskripsi && kategori) {
    // Use DB-backed complaint type name if available, otherwise title-case the kategori
    deskripsi = complaintTypeConfig?.name
      ? `Laporan ${complaintTypeConfig.name}`
      : `Laporan ${String(kategori).replace(/_/g, ' ')}`;
  }
  
  // Ensure deskripsi is at least 10 characters (Case Service requirement)
  if (deskripsi && deskripsi.length < 10) {
    // Enrich short description with category and address info
    const kategoriLabel = String(kategori || 'masalah').replace(/_/g, ' ');
    if (alamat) {
      deskripsi = `Laporan ${kategoriLabel} di ${alamat}`;
    } else {
      deskripsi = `Laporan ${kategoriLabel} - ${deskripsi}`;
    }
    logger.info('Description enriched to meet minimum length', { 
      userId, 
      originalLength: (llmResponse.fields?.deskripsi || '').length,
      newLength: deskripsi.length,
      deskripsi,
    });
  }
  
  // Check if we have enough information
  if (!kategori || (requireAddress && !alamat)) {
    logger.info('Incomplete complaint data, asking for more info', {
      userId,
      hasKategori: !!kategori,
      hasAlamat: !!alamat,
      hasDeskripsi: !!deskripsi,
      requireAddress,
    });
    
    if (!kategori) {
      return 'Mohon jelaskan jenis masalah yang ingin dilaporkan (contoh: jalan rusak, lampu mati, sampah, dll).';
    }
    if (!alamat) {
      // Store pending address request so we can continue when user provides address
      // Accumulate photo if present
      if (mediaUrl) addPendingPhoto(userId, mediaUrl);
      pendingAddressRequest.set(userId, {
        kategori,
        deskripsi: deskripsi || `Laporan ${kategori.replace(/_/g, ' ')}`,
        village_id: villageId,
        timestamp: Date.now(),
        foto_url: undefined, // Photos tracked in pendingPhotos cache
      });
      
      // Use DB-backed complaint type name if available
      const kategoriLabel = complaintTypeConfig?.name?.toLowerCase()
        || kategori.replace(/_/g, ' ');
      // Emergency detection is DB-driven via complaintTypeConfig.is_urgent
      const isEmergencyNeedAddress = typeof complaintTypeConfig?.is_urgent === 'boolean'
        ? complaintTypeConfig.is_urgent : false;
      
      logger.info('Storing pending address request', { userId, kategori, deskripsi });
      
      if (isEmergencyNeedAddress) {
        return 'Baik Pak/Bu, mohon segera kirimkan alamat lokasi kejadian.';
      }
      return `Baik Pak/Bu, mohon jelaskan lokasi ${kategoriLabel} tersebut.`;
    }
    
    return llmResponse.reply_text;
  }
  
  // Check if alamat is too vague - ask for confirmation
  if (alamat && await isVagueAddress(alamat, { village_id: villageId, wa_user_id: userId, session_id: userId, channel, kategori })) {
    logger.info('Address is vague, asking for confirmation', { userId, alamat, kategori });
    
    // Accumulate photo if present
    if (mediaUrl) addPendingPhoto(userId, mediaUrl);
    pendingAddressConfirmation.set(userId, {
      alamat,
      kategori,
      deskripsi: deskripsi || `Laporan ${kategori.replace(/_/g, ' ')}`,
      village_id: villageId,
      timestamp: Date.now(),
      foto_url: undefined, // Photos tracked in pendingPhotos cache
    });
    
    const kategoriLabel = kategori.replace(/_/g, ' ');
    const pendingPhotoCount = getPendingPhotoCount(userId);
    const photoNote = pendingPhotoCount > 0 ? `\n\n${pendingPhotoCount} foto sudah kami terima.` : '';
    return `Alamat "${alamat}" sepertinya kurang spesifik untuk laporan ${kategoriLabel}.${photoNote}\n\nApakah Bapak/Ibu ingin menambahkan detail alamat (nomor rumah, RT/RW, nama jalan lengkap) atau balas "YA" untuk tetap menggunakan alamat ini?`;
  }
  
  // Check if this is an emergency complaint
  // PRIORITY RULE:
  // - Jika ada konfigurasi jenis pengaduan, gunakan itu sebagai sumber utama.
  // - Heuristic hanya dipakai sebagai fallback saat tidak ada konfigurasi.
  // Emergency detection is fully DB-driven via complaintTypeConfig.is_urgent
  const isEmergency = typeof complaintTypeConfig?.is_urgent === 'boolean'
    ? complaintTypeConfig.is_urgent : false;
  
  // ==================== NAME & PHONE VALIDATION ====================
  // Before creating complaint, we need user's identity:
  // - WhatsApp: Only need nama_lengkap (phone is already known from WA number)
  // - Webchat: Need BOTH nama_lengkap AND no_hp (so we can contact them)
  
  const isWebchatChannel = channel === 'webchat';
  const userProfile = getProfile(userId);
  const hasName = !!userProfile.nama_lengkap;
  const hasPhone = !!userProfile.no_hp;
  
  // For webchat: need both name and phone
  // For WhatsApp: only need name
  const needsName = !hasName;
  const needsPhone = isWebchatChannel && !hasPhone;
  
  if (needsName || needsPhone) {
    // Store complaint data temporarily while we collect user info
    // Accumulate photo if present
    if (mediaUrl) addPendingPhoto(userId, mediaUrl);
    pendingComplaintData.set(userId, {
      kategori,
      deskripsi: deskripsi || `Laporan ${kategori.replace(/_/g, ' ')}`,
      alamat: alamat || undefined,
      rt_rw: rt_rw || '',
      village_id: villageId,
      foto_url: undefined, // Photos tracked in pendingPhotos cache
      channel,
      timestamp: Date.now(),
      waitingFor: needsName ? 'nama' : 'no_hp',
    });
    
    logger.info('Storing pending complaint, waiting for user info', {
      userId,
      channel,
      needsName,
      needsPhone,
      kategori,
    });
    
    const pendingPhotoCount = getPendingPhotoCount(userId);
    const photoNote = pendingPhotoCount > 0 ? `\n${pendingPhotoCount} foto sudah kami terima.` : '';
    
    if (needsName) {
      return `Baik Pak/Bu, sebelum laporan diproses, boleh kami tahu nama Bapak/Ibu?${photoNote}`;
    }
    
    // needsPhone (webchat only, name already provided)
    return `Baik Pak/Bu, mohon informasikan nomor telepon yang dapat dihubungi agar petugas bisa menghubungi Bapak/Ibu terkait laporan ini.${photoNote}`;
  }
  
  // ==================== CREATE COMPLAINT ====================
  // All required data is complete, proceed with creation
  
  // Combine accumulated photos with current mediaUrl
  const combinedFotoUrl = consumePendingPhotos(userId, mediaUrl);
  
  // Create complaint in Case Service
  const complaintId = await createComplaint({
    wa_user_id: isWebchatChannel ? undefined : userId,
    channel: isWebchatChannel ? 'WEBCHAT' : 'WHATSAPP',
    channel_identifier: userId,
    kategori,
    deskripsi: deskripsi || `Laporan ${kategori.replace(/_/g, ' ')}`,
    village_id: villageId,
    alamat: alamat || undefined,
    rt_rw: rt_rw || '',
    foto_url: combinedFotoUrl,
    category_id: complaintTypeConfig?.category_id,
    type_id: complaintTypeConfig?.id,
    is_urgent: isEmergency,
    require_address: requireAddress,
    // Include user identity
    reporter_name: userProfile.nama_lengkap,
    reporter_phone: isWebchatChannel ? userProfile.no_hp : userId, // For WA, userId is the phone
  });
  
  if (complaintId) {
    rateLimiterService.recordReport(userId);
    aiAnalyticsService.recordSuccess('CREATE_COMPLAINT');
    
    // Save address to user profile for future auto-fill
    saveDefaultAddress(userId, alamat, rt_rw);
    
    // Record service usage for profile
    recordServiceUsage(userId, kategori);
    
    // Record completed action in conversation context
    recordCompletedAction(userId, 'CREATE_COMPLAINT', complaintId);
    
    // Record collected data
    recordDataCollected(userId, 'kategori', kategori);
    if (alamat) {
      recordDataCollected(userId, 'alamat', alamat);
    }
    
    const hasRtRw = Boolean(rt_rw) || /\brt\b|\brw\b/i.test(alamat || '');
    const photoCount = combinedFotoUrl ? (combinedFotoUrl.startsWith('[') ? JSON.parse(combinedFotoUrl).length : 1) : 0;
    const withPhotoNote = photoCount > 0 ? `\n${photoCount > 1 ? photoCount + ' foto' : 'Foto'} pendukung sudah kami terima.` : '';
    
    // ==================== IMPORTANT CONTACTS ====================
    // For emergency complaints, always try to send relevant contacts
    let importantContactsMessage = '';
    
    // If complaint type has explicit config for important contacts
    if (complaintTypeConfig?.send_important_contacts && complaintTypeConfig?.important_contact_category) {
      const contacts = await getImportantContacts(
        villageId,
        complaintTypeConfig.important_contact_category,
        undefined
      );
      importantContactsMessage = buildImportantContactsMessage(contacts, channel);
    } 
    // Fallback for emergency categories without config - try to find relevant contacts
    else if (isEmergency) {
      // Map kategori to likely contact category
      const emergencyContactMap: Record<string, string> = {
        'banjir': 'Bencana',
        'kebakaran': 'Darurat',
        'pohon_tumbang': 'Bencana',
        'bencana': 'Bencana',
        'kecelakaan': 'Darurat',
      };
      
      const fallbackCategory = emergencyContactMap[kategori] || 'Darurat';
      logger.warn('Emergency contact fallback map used (no config)', { kategori, fallbackCategory });
      const contacts = await getImportantContacts(villageId, fallbackCategory, undefined);
      
      // If no contacts found with specific category, try generic emergency
      if (!contacts || contacts.length === 0) {
        const genericContacts = await getImportantContacts(villageId, undefined, undefined);
        importantContactsMessage = buildImportantContactsMessage(genericContacts, channel);
      } else {
        importantContactsMessage = buildImportantContactsMessage(contacts, channel);
      }
      
      logger.info('Emergency complaint: sending fallback contacts', {
        userId,
        kategori,
        fallbackCategory,
        hasContacts: !!importantContactsMessage,
      });
    }

    if (isEmergency) {
      logger.info('Emergency complaint detected', { userId, complaintId, kategori, deskripsi });
    }

    const statusLine = isEmergency || hasRtRw ? '\nStatus laporan saat ini: OPEN.' : '';
    const photoReminder = photoCount === 0
      ? '\n\n📷 Tip: Bapak/Ibu bisa kirim foto pendukung untuk mempercepat penanganan. Cukup kirim foto kapan saja.'
      : '';
    const multiComplaintHint = '\n\nJika ada laporan lain, silakan langsung sampaikan.';
    return `Terima kasih.\nLaporan telah kami terima dengan nomor ${complaintId}.${statusLine}${withPhotoNote}${photoReminder}${importantContactsMessage}${multiComplaintHint}`;
  }
  
  aiAnalyticsService.recordFailure('CREATE_COMPLAINT');
  throw new Error('Failed to create complaint in Case Service');
}

/**
 * Handle service information request - Query requirements from database
 */
function normalizeTo628(input: string): string {
  const digits = (input || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('8')) return `62${digits}`;
  return digits;
}

/**
 * Extract name from text using micro NLU.
 * Returns null quickly for obviously non-name inputs (empty, too long, numbers only).
 * For real name extraction, use extractNameViaNLU() directly.
 */
async function extractNameFromTextNLU(
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

async function extractNameFromHistoryNLU(
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

function getLastAssistantMessage(history?: Array<{ role: 'user' | 'assistant'; content: string }>): string {
  if (!history || history.length === 0) return '';
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const item = history[i];
    if (item.role === 'assistant') return item.content || '';
  }
  return '';
}

function extractNameFromAssistantPrompt(text?: string): string | null {
  const cleaned = (text || '').trim();
  if (!cleaned) return null;
  const match = cleaned.match(/(?:dengan|ini)\s+(?:Bapak|Ibu|Pak|Bu|Bapak\/Ibu)\s+([a-zA-Z\s]{2,30})/i);
  if (!match?.[1]) return null;
  const name = match[1].trim().split(/\s+/).slice(0, 2).join(' ');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function wasNamePrompted(history?: Array<{ role: 'user' | 'assistant'; content: string }>): boolean {
  if (!history || history.length === 0) return false;
  const lastAssistant = [...history].reverse().find(item => item.role === 'assistant');
  if (!lastAssistant) return false;
  return /(nama|dengan\s+siapa|siapa\s+nama)/i.test(lastAssistant.content);
}

async function fetchConversationHistoryFromChannel(
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
function appendToHistoryCache(userId: string, role: 'user' | 'assistant', content: string): void {
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

function buildChannelParams(
  channel: ChannelType,
  userId: string
): { channel: 'WEBCHAT' | 'WHATSAPP'; wa_user_id?: string; channel_identifier?: string } {
  const isWebchat = channel === 'webchat';
  return {
    channel: isWebchat ? 'WEBCHAT' : 'WHATSAPP',
    wa_user_id: isWebchat ? undefined : userId,
    channel_identifier: isWebchat ? userId : undefined,
  };
}

function isValidCitizenWaNumber(value: string): boolean {
  return /^628\d{8,12}$/.test(value);
}

function getPublicFormBaseUrl(): string {
  return (process.env.PUBLIC_BASE_URL
    || 'https://govconnect.my.id'
  ).replace(/\/$/, '');
}

function buildPublicServiceFormUrl(
  baseUrl: string,
  villageSlug: string,
  serviceSlug: string,
  userId: string,
  channel: 'whatsapp' | 'webchat'
): string {
  const url = `${baseUrl}/form/${villageSlug}/${serviceSlug}`;
  if (channel === 'webchat') {
    return `${url}?session=${encodeURIComponent(userId)}`;
  }
  const waUser = normalizeTo628(userId);
  if (!isValidCitizenWaNumber(waUser)) return url;
  return `${url}?wa=${encodeURIComponent(waUser)}`;
}

function buildEditServiceFormUrl(
  baseUrl: string,
  requestNumber: string,
  token: string,
  userId: string,
  channel: 'whatsapp' | 'webchat'
): string {
  const url = `${baseUrl}/form/edit/${encodeURIComponent(requestNumber)}`;
  const params = new URLSearchParams();
  params.set('token', token);
  if (channel === 'webchat') {
    params.set('session', userId);
  } else {
    const waUser = normalizeTo628(userId);
    if (isValidCitizenWaNumber(waUser)) {
      params.set('wa', waUser);
    }
  }
  return `${url}?${params.toString()}`;
}

async function resolveVillageSlugForPublicForm(villageId?: string): Promise<string> {
  if (!villageId) return 'desa';
  try {
    const profile = await getVillageProfileSummary(villageId);
    if (profile?.short_name) return profile.short_name;
  } catch {
    // ignore
  }
  return 'desa';
}

export async function handleServiceInfo(userId: string, llmResponse: any, channel: ChannelType = 'whatsapp'): Promise<HandlerResult> {
  let { service_slug, service_id } = llmResponse.fields || {};
  const villageId = llmResponse.fields?.village_id || '';
  const rawMessage = llmResponse.fields?._original_message || llmResponse.fields?.service_name || llmResponse.fields?.service_query || '';

  if (!service_slug && !service_id && rawMessage) {
    const resolved = await resolveServiceSlugFromSearch(rawMessage, villageId);
    if (resolved?.alternatives && resolved.alternatives.length > 1) {
      // Ambiguous match — present options to user
      const optionsList = resolved.alternatives.map((a, i) => `${i + 1}. ${a.name}`).join('\n');
      return { replyText: `Mohon maaf Pak/Bu, ada beberapa layanan yang cocok:\n\n${optionsList}\n\nMohon pilih salah satu dengan menyebutkan nama lengkap layanannya.` };
    }
    if (resolved?.slug) {
      service_slug = resolved.slug;
      llmResponse.fields = {
        ...(llmResponse.fields || {}),
        service_slug: resolved.slug,
        service_name: resolved.name || llmResponse.fields?.service_name,
      } as any;
    }
  }
  
  if (!service_slug && !service_id) {
    return { replyText: llmResponse.reply_text || 'Baik Pak/Bu, layanan apa yang ingin ditanyakan?' };
  }
  
  try {
    
    // Query service details from case-service
    const fetchService = async (slug?: string, id?: string) => {
      let serviceUrl = '';

      if (id) {
        serviceUrl = `${config.caseServiceUrl}/services/${id}`;
      } else if (slug) {
        serviceUrl = `${config.caseServiceUrl}/services/by-slug?village_id=${villageId}&slug=${slug}`;
      }

      if (!serviceUrl) return null;

      try {
        const response = await axios.get(serviceUrl, {
          headers: { 'x-internal-api-key': config.internalApiKey },
          timeout: 5000,
        });

        return response.data?.data || null;
      } catch (error: any) {
        if (error.response?.status === 404) return null;
        throw error;
      }
    };

    let service = await fetchService(service_slug, service_id);

    if (!service && rawMessage) {
      const resolved = await resolveServiceSlugFromSearch(rawMessage, villageId);
      if (resolved?.slug) {
        service_slug = resolved.slug;
        service = await fetchService(resolved.slug, undefined);
      }
    }
    
    if (!service) {
      return { replyText: llmResponse.reply_text || 'Mohon maaf Pak/Bu, layanan tersebut tidak ditemukan. Silakan tanyakan layanan lain.' };
    }

    if (service.is_active === false) {
      return { replyText: `Mohon maaf Pak/Bu, layanan ${service.name} saat ini belum tersedia.` };
    }

    const resolvedVillageId = villageId || service.village_id || service.villageId || '';
    
    // Build requirements list
    const requirements = service.requirements || [];
    let requirementsList = '';
    if (requirements.length > 0) {
      requirementsList = requirements
        .sort((a: any, b: any) => (a.order_index || 0) - (b.order_index || 0))
        .map((req: any, i: number) => {
          const required = req.is_required ? ' (wajib)' : ' (opsional)';
          return `${i + 1}. ${req.label}${required}`;
        })
        .join('\n');
    }
    
    // Check if service is available online
    const isOnline = service.mode === 'online' || service.mode === 'both';
    const baseUrl = getPublicFormBaseUrl();
    const villageSlug = await resolveVillageSlugForPublicForm(resolvedVillageId || villageId);
    
    let replyText = `Baik Pak/Bu, untuk pembuatan ${service.name} persyaratannya antara lain:\n\n`;
    let guidanceText = '';

    if (requirementsList) {
      replyText += `${requirementsList}\n\n`;
    } else if (service.description) {
      replyText += `${service.description}\n\n`;
    }

    if (isOnline) {
      // Proactively include the form link so the user can immediately apply.
      // Also set pendingServiceFormOffer as fallback if user replies "ya" later.
      setPendingServiceFormOffer(userId, {
        service_slug: service.slug,
        village_id: resolvedVillageId || villageId,
        timestamp: Date.now(),
      });

      const formUrl = buildPublicServiceFormUrl(baseUrl, villageSlug, service.slug, userId, channel === 'webchat' ? 'webchat' : 'whatsapp');
      guidanceText = `Jika ingin mengajukan layanan ini secara online, silakan klik link berikut:\n${formUrl}`;
    } else {
      replyText += 'Layanan ini diproses secara offline di kantor desa/kelurahan.\n\nSilakan datang ke kantor dengan membawa persyaratan di atas.';
    }
    
    return { replyText, guidanceText: guidanceText || undefined };
  } catch (error: any) {
    logger.error('Failed to fetch service info', { error: error.message, service_slug, service_id });
    return { replyText: llmResponse.reply_text || 'Baik Pak/Bu, saya cek dulu info layanan tersebut ya.' };
  }
}

/**
 * Handle service request creation (send public form link)
 */
export async function handleServiceRequestCreation(userId: string, channel: ChannelType, llmResponse: any): Promise<string> {
  let { service_slug } = llmResponse.fields || {};
  const rawMessage = llmResponse.fields?._original_message || llmResponse.fields?.service_name || llmResponse.fields?.service_query || '';
  let villageId = llmResponse.fields?.village_id || '';

  // If no service_slug, try to resolve from raw message
  if (!service_slug && rawMessage) {
    const resolved = await resolveServiceSlugFromSearch(rawMessage, villageId);
    if (resolved?.slug) {
      service_slug = resolved.slug;
      llmResponse.fields = {
        ...(llmResponse.fields || {}),
        service_slug: resolved.slug,
        service_name: resolved.name || llmResponse.fields?.service_name,
      } as any;
    }
  }

  if (!service_slug) {
    return llmResponse.reply_text || 'Mohon sebutkan nama layanan yang ingin diajukan ya Pak/Bu.';
  }

  try {

    let response = await axios.get(`${config.caseServiceUrl}/services/by-slug`, {
      params: { village_id: villageId, slug: service_slug },
      headers: { 'x-internal-api-key': config.internalApiKey },
      timeout: 5000,
    }).catch(() => null);

    let service = response?.data?.data;

    // If service not found with exact slug, try search with the slug as query
    if (!service) {
      logger.info('Service not found by slug, trying search', { service_slug, villageId });
      const searchQuery = service_slug.replace(/-/g, ' '); // Convert slug to search query
      const resolved = await resolveServiceSlugFromSearch(searchQuery, villageId);
      if (resolved?.slug) {
        service_slug = resolved.slug;
        // Try again with resolved slug
        response = await axios.get(`${config.caseServiceUrl}/services/by-slug`, {
          params: { village_id: villageId, slug: service_slug },
          headers: { 'x-internal-api-key': config.internalApiKey },
          timeout: 5000,
        }).catch(() => null);
        service = response?.data?.data;
      }
    }

    if (!service) {
      return 'Mohon maaf Pak/Bu, layanan tersebut tidak ditemukan. Silakan tanyakan layanan lain.';
    }

    if (service.is_active === false) {
      return `Mohon maaf Pak/Bu, layanan ${service.name} saat ini belum tersedia.`;
    }

    if (!villageId && (service.village_id || service.villageId)) {
      villageId = service.village_id || service.villageId;
    }

    const isOnline = service.mode === 'online' || service.mode === 'both';
    if (!isOnline) {
      return `${service.name} saat ini hanya bisa diproses secara offline di kantor kelurahan/desa.\n\nSilakan datang ke kantor dengan membawa persyaratan yang diperlukan.`;
    }

    const baseUrl = getPublicFormBaseUrl();
    const villageSlug = await resolveVillageSlugForPublicForm(villageId);
    const formUrl = buildPublicServiceFormUrl(baseUrl, villageSlug, service.slug || service_slug, userId, channel === 'webchat' ? 'webchat' : 'whatsapp');

    const clickableUrl = formatClickableLink(formUrl, channel, 'Link Formulir Layanan');
    return `Baik Pak/Bu, silakan mengisi permohonan melalui link berikut:\n${clickableUrl}\n\nSetelah dikirim, Bapak/Ibu akan mendapatkan nomor layanan.\n⚠️ Mohon simpan nomor layanan dengan baik.\nUntuk cek status, ketik: *status <kode layanan>*\n(Contoh: status LAY-20250209-001)`;
  } catch (error: any) {
    logger.error('Failed to validate service before sending form link', { error: error.message, service_slug, villageId });
    return llmResponse.reply_text || 'Mohon maaf Pak/Bu, saya belum bisa menyiapkan link formulirnya sekarang. Coba lagi sebentar ya.';
  }
}

/**
 * Handle service request edit (send edit link with token)
 */
export async function handleServiceRequestEditLink(userId: string, channel: ChannelType, llmResponse: any): Promise<string> {
  const { request_number } = llmResponse.fields || {};

  if (!request_number) {
    return llmResponse.reply_text || 'Baik Pak/Bu, link tersebut sudah tidak berlaku. Apakah Bapak/Ibu ingin kami kirimkan link pembaruan yang baru?';
  }

  const tokenResult = await requestServiceRequestEditToken(request_number, buildChannelParams(channel, userId));

  if (!tokenResult.success) {
    if (tokenResult.error === 'NOT_FOUND') {
      return `Permohonan layanan *${request_number}* tidak ditemukan. Mohon cek nomor layanan ya Pak/Bu.`;
    }
    if (tokenResult.error === 'NOT_OWNER') {
      return `Mohon maaf Pak/Bu, permohonan *${request_number}* bukan milik Anda, jadi tidak bisa diubah.`;
    }
    if (tokenResult.error === 'LOCKED') {
      return `Mohon maaf Pak/Bu, layanan *${request_number}* sudah selesai/dibatalkan/ditolak sehingga tidak dapat diperbarui.`;
    }
    return tokenResult.message || 'Mohon maaf Pak/Bu, ada kendala saat menyiapkan link edit.';
  }

  const baseUrl = (process.env.PUBLIC_FORM_BASE_URL || process.env.PUBLIC_BASE_URL || 'https://govconnect.my.id').replace(/\/$/, '');
  const editUrl = buildEditServiceFormUrl(
    baseUrl,
    request_number,
    tokenResult.edit_token || '',
    userId,
    channel === 'webchat' ? 'webchat' : 'whatsapp'
  );

  const clickableEditUrl = formatClickableLink(editUrl, channel, 'Link Edit Permohonan');
  return `Baik Pak/Bu, perubahan data layanan hanya dapat dilakukan melalui website.\n\nSilakan lakukan pembaruan melalui link berikut:\n${clickableEditUrl}\n\nLink ini hanya berlaku satu kali.`;
}

/**
 * Extract address from message using smart detection
 * IMPROVED: Uses NLU-based address analysis for accurate extraction
 */
async function extractAddressFromMessage(currentMessage: string, userId: string, context?: { village_id?: string; channel?: string; kategori?: string }): Promise<string> {
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

// extractAddressFromComplaintMessage REMOVED — was identical to extractAddressFromMessage.

/**
 * Handle status check for complaints dan permohonan layanan
 * Now includes ownership validation - user can only check their own records
 */
export async function handleStatusCheck(userId: string, channel: ChannelType, llmResponse: any, currentMessage: string = ''): Promise<string> {
  const { complaint_id, request_number } = llmResponse.fields;
  const detailMode = !!(llmResponse.fields?.detail_mode || llmResponse.fields?.detail);
  
  if (!complaint_id && !request_number) {
    if (llmResponse.reply_text) return llmResponse.reply_text;
    const ctx = getEnhancedContext(userId);
    const lastComplaint = ctx.keyPoints
      .slice()
      .reverse()
      .find(point => /CREATE_COMPLAINT berhasil:/i.test(point));
    const inferredComplaintId = lastComplaint?.split('berhasil:')[1]?.trim();
    if (inferredComplaintId) {
      llmResponse.fields.complaint_id = inferredComplaintId;
    } else {
      return 'Untuk cek status, mohon sebutkan nomor laporan atau layanan ya Pak/Bu (contoh: LAP-20251201-001 atau LAY-20251201-001).';
    }
  }
  
  if (complaint_id) {
    // Use ownership validation - user can only check their own complaints
    const result = await getComplaintStatusWithOwnership(complaint_id, buildChannelParams(channel, userId));
    
    if (!result.success) {
      if (result.error === 'NOT_FOUND') {
        return `Mohon maaf Pak/Bu, kami tidak menemukan laporan dengan nomor *${complaint_id}*.\n\nSilakan cek ulang format nomor laporan (contoh: LAP-20251201-001).`;
      }
      if (result.error === 'NOT_OWNER') {
        return `Mohon maaf Pak/Bu, laporan *${complaint_id}* bukan milik Anda.\n\nSilakan cek kembali nomor laporan Anda. Jika lupa, ketik "riwayat" untuk melihat daftar laporan Anda.`;
      }
      return 'Mohon maaf Pak/Bu, ada kendala saat mengecek status. Silakan coba lagi.';
    }

    if (!result.data) {
      return 'Mohon maaf Pak/Bu, ada kendala saat menampilkan detail laporan. Silakan coba lagi.';
    }
    
    if (!detailMode) {
      const isExplicitCheck = /(cek|status|cek\s+laporan|cek\s+lagi)/i.test(currentMessage || '');
      const statusInfo = getStatusInfo(result.data.status);
      if (!isExplicitCheck && statusInfo.text === 'PROCESS') {
        return `Mohon maaf Pak/Bu, laporan ${complaint_id} masih dalam proses penanganan oleh petugas desa.`;
      }
      if (!isExplicitCheck && statusInfo.text === 'OPEN') {
        return `Mohon maaf Pak/Bu, laporan ${complaint_id} masih menunggu untuk diproses oleh petugas desa.`;
      }
    }
    return detailMode ? buildComplaintDetailResponse(result.data) : buildNaturalStatusResponse(result.data);
  }
  
  if (request_number) {
    const result = await getServiceRequestStatusWithOwnership(request_number, buildChannelParams(channel, userId));
    
    if (!result.success) {
      if (result.error === 'NOT_FOUND') {
        return `Mohon maaf Pak/Bu, kami tidak menemukan permohonan layanan dengan nomor *${request_number}*.\n\nSilakan cek ulang format nomor layanan (contoh: LAY-20251201-001).`;
      }
      if (result.error === 'NOT_OWNER') {
        return `Mohon maaf Pak/Bu, permohonan layanan *${request_number}* bukan milik Anda.\n\nSilakan cek kembali nomor layanan Anda. Jika lupa, ketik "riwayat" untuk melihat daftar layanan Anda.`;
      }
      return 'Mohon maaf Pak/Bu, ada kendala saat mengecek status layanan. Silakan coba lagi.';
    }
    
    if (!result.data) {
      return 'Mohon maaf Pak/Bu, ada kendala saat menampilkan detail layanan. Silakan coba lagi.';
    }

    if (!detailMode) return buildNaturalServiceStatusResponse(result.data);

    let requirementDefs: ServiceRequirementDefinition[] = [];
    const serviceId: string | undefined = result.data?.service_id || result.data?.serviceId;
    if (serviceId) {
      requirementDefs = await getServiceRequirements(String(serviceId));
    }

    return buildServiceRequestDetailResponse(result.data, requirementDefs);
  }
  
  return 'Mohon maaf Pak/Bu, ada kendala saat mengecek status. Silakan coba lagi.';
}

export async function handleCancellationRequest(
  userId: string,
  type: 'laporan' | 'layanan',
  llmResponse: any
): Promise<string> {
  const { complaint_id, request_number, cancel_reason } = llmResponse.fields || {};
  const targetId = type === 'laporan' ? complaint_id : request_number;

  if (!targetId) {
    if (llmResponse.reply_text) return llmResponse.reply_text;
    return type === 'laporan'
      ? 'Untuk membatalkan laporan, mohon sertakan nomornya ya Pak/Bu (contoh: LAP-20251201-001).'
      : 'Untuk membatalkan layanan, mohon sertakan nomornya ya Pak/Bu (contoh: LAY-20251201-001).';
  }

  setPendingCancelConfirmation(userId, {
    type,
    id: targetId,
    reason: cancel_reason,
    timestamp: Date.now(),
  });

  const label = type === 'laporan' ? 'laporan' : 'layanan';
  return `Apakah Bapak/Ibu yakin ingin membatalkan ${label} ${targetId}?\nBalas YA untuk konfirmasi.`;
}

/**
 * Handle complaint update by user
 */
export async function handleComplaintUpdate(userId: string, channel: ChannelType, llmResponse: any, currentMessage: string = ''): Promise<string> {
  const { complaint_id, alamat, deskripsi, rt_rw } = llmResponse.fields || {};

  if (!complaint_id) {
    return llmResponse.reply_text || 'Mohon sebutkan nomor laporan yang ingin diperbarui (contoh: LAP-20251201-001).';
  }

  // Use NLU to classify update intent instead of regex
  let wantsPhoto = false;
  try {
    const updateIntent = await classifyUpdateIntent(currentMessage || '', {
      village_id: undefined, wa_user_id: userId, session_id: userId, channel,
    });
    if (updateIntent && updateIntent.intent === 'send_photo' && updateIntent.confidence >= 0.6) {
      wantsPhoto = true;
    }
  } catch {
    // NLU failed, proceed without photo detection
  }
  if (wantsPhoto) {
    return 'Baik, silakan kirimkan foto pendukung laporan tersebut.';
  }

  if (!alamat && !deskripsi && !rt_rw) {
    return 'Baik, silakan sampaikan keterangan tambahan yang ingin ditambahkan.';
  }

  // Mark update descriptions with [Update] prefix so case service can append
  let mergedDeskripsi = deskripsi;
  if (deskripsi) {
    mergedDeskripsi = `[Update] ${deskripsi}`;
  }

  const result = await updateComplaintByUser(complaint_id, buildChannelParams(channel, userId), { alamat, deskripsi: mergedDeskripsi, rt_rw });

  if (!result.success) {
    if (result.error === 'NOT_FOUND') {
      return `Hmm, laporan *${complaint_id}* tidak ditemukan. Coba cek kembali nomor laporan ya.`;
    }
    if (result.error === 'NOT_OWNER') {
      return `Mohon maaf Pak/Bu, laporan *${complaint_id}* bukan milik Anda, jadi tidak bisa diubah.`;
    }
    if (result.error === 'LOCKED') {
      return `Laporan *${complaint_id}* sudah selesai/dibatalkan/ditolak sehingga tidak bisa diubah.`;
    }
    return result.message || 'Maaf, terjadi kendala saat memperbarui laporan.';
  }

  return `Terima kasih.\nKeterangan laporan ${complaint_id} telah diperbarui.`;
}

/**
 * Handle user history request
 */
export async function handleHistory(userId: string, channel: ChannelType): Promise<string> {
  logger.info('Handling history request', { userId });
  
  const history = await getUserHistory(buildChannelParams(channel, userId));
  
  if (!history || history.total === 0) {
    return 'Belum ada laporan atau layanan. Silakan kirim pesan untuk memulai.';
  }
  
  return buildHistoryResponse(history.combined, history.total);
}

/**
 * Handle knowledge query
 */
export async function handleKnowledgeQuery(userId: string, message: string, llmResponse: any, mainLlmReplyText?: string, channel: string = 'whatsapp'): Promise<string> {
  logger.info('Handling knowledge query', { userId, knowledgeCategory: llmResponse.fields?.knowledge_category });
  
  try {
    const categories = llmResponse.fields?.knowledge_category ? [llmResponse.fields.knowledge_category] : undefined;
    const villageId: string | undefined = llmResponse.fields?.village_id;

    const normalizedQuery = (message || '').toLowerCase();
    const profile = await getVillageProfileSummary(villageId);
    const officeName = profile?.name || 'kantor desa/kelurahan';

    const normalizePhoneNumber = (value: string): string => {
      const digits = (value || '').replace(/\D/g, '');
      if (!digits) return '';
      if (digits.startsWith('0')) return `62${digits.slice(1)}`;
      if (digits.startsWith('62')) return digits;
      return digits;
    };

    const extractPhoneNumbers = (text: string): string[] => {
      if (!text) return [];
      const matches = text.match(/(\+?62|0)\s*\d[\d\s-]{7,14}\d/g) || [];
      const normalized = matches
        .map(raw => normalizePhoneNumber(raw))
        .filter(Boolean);
      return Array.from(new Set(normalized));
    };

    // Deterministic (no-LLM-hallucination) answers for profile/office info.
    // Use micro NLU to classify what kind of question the user is asking,
    // then answer from DB data to prevent hallucination.
    const knowledgeSubtype = await classifyKnowledgeSubtype(message, {
      village_id: villageId,
      wa_user_id: userId,
      session_id: userId,
      channel,
    });
    const subtypeResult = knowledgeSubtype?.subtype || 'general';
    const isAskingAddress = subtypeResult === 'address';
    const isAskingHours = subtypeResult === 'hours';
    const isAskingContact = subtypeResult === 'contact';
    const isTrackingNumberQuestion = subtypeResult === 'tracking';

    if (isAskingAddress) {
      if (!profile?.address && !profile?.gmaps_url) {
        return 'Mohon maaf Pak/Bu, informasi alamat kantor belum tersedia. Silakan datang langsung ke kantor desa/kelurahan pada jam kerja.';
      }

      if (profile?.address && profile?.gmaps_url) {
        return `Kantor ${officeName} beralamat di ${profile.address}.\nLokasi Google Maps:\n${profile.gmaps_url}`;
      }

      if (profile?.address) {
        return `Alamat Kantor ${officeName} adalah ${profile.address}.`;
      }

      return `Tentu Pak/Bu. Berikut lokasi Kantor ${officeName} di Google Maps:\n${profile.gmaps_url}`;
    }

    if (isAskingHours) {
      const hours: any = profile?.operating_hours;
      if (!hours || typeof hours !== 'object') {
        return 'Mohon maaf Pak/Bu, informasi jam operasional belum tersedia. Silakan datang langsung ke kantor desa/kelurahan pada jam kerja.';
      }

      const dayKeys = ['senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu'] as const;
      const requestedDay = dayKeys.find(d => new RegExp(`\\b${d}\\b`, 'i').test(normalizedQuery));

      const formatDay = (day: string, schedule: any): string => {
        const open = schedule?.open ?? null;
        const close = schedule?.close ?? null;
        if (!open || !close) return `${day.charAt(0).toUpperCase() + day.slice(1)}: Tutup`;
        return `${day.charAt(0).toUpperCase() + day.slice(1)}: ${open}–${close}`;
      };

      if (requestedDay) {
        const daySchedule = (hours as any)[requestedDay];
        if (!daySchedule?.open || !daySchedule?.close) {
          const dayLabel = requestedDay.charAt(0).toUpperCase() + requestedDay.slice(1);
          if (requestedDay === 'sabtu' || requestedDay === 'minggu') {
            return 'Mohon maaf Pak/Bu, kantor tidak beroperasi pada hari Sabtu dan Minggu.';
          }
          return `Mohon maaf Pak/Bu, kantor tidak beroperasi pada hari ${dayLabel}.`;
        }
        const dayLabel = requestedDay.charAt(0).toUpperCase() + requestedDay.slice(1);
        return `Kantor ${officeName} buka hari ${dayLabel} pukul ${daySchedule.open}–${daySchedule.close}.`;
      }

      const weekdayKeys = ['senin', 'selasa', 'rabu', 'kamis', 'jumat'];
      const weekendKeys = ['sabtu', 'minggu'];
      const firstWeekday = (hours as any)[weekdayKeys[0]];
      const allWeekdaysSame = weekdayKeys.every(day => {
        const h = (hours as any)[day];
        return h?.open === firstWeekday?.open && h?.close === firstWeekday?.close;
      });
      const weekendsClosed = weekendKeys.every(day => {
        const h = (hours as any)[day];
        return !h?.open || !h?.close;
      });

      if (allWeekdaysSame && firstWeekday?.open && firstWeekday?.close && weekendsClosed) {
        return `Kantor ${officeName} buka Senin–Jumat, pukul ${firstWeekday.open}–${firstWeekday.close} WIB.`;
      }

      const lines: string[] = [`Jam operasional ${officeName}:`];
      for (const day of dayKeys) {
        lines.push(formatDay(day, (hours as any)[day]));
      }
      return lines.join('\n');
    }

    if (isAskingContact) {
      // Use NLU to understand what type of contact user wants
      const contactEntity = knowledgeSubtype?.contact_entity || null;

      let contacts = await getImportantContacts(villageId || '');

      // Use micro NLU to match contacts semantically
      if (contacts && contacts.length > 0 && contactEntity) {
        const contactMatchResult = await matchContactQuery(
          message,
          contacts.map(c => ({
            name: c.name || '',
            description: c.description || '',
            category: c.category?.name || '',
          })),
          { village_id: villageId, wa_user_id: userId, session_id: userId, channel }
        );

        if (contactMatchResult && contactMatchResult.matched_indices.length > 0) {
          contacts = contactMatchResult.matched_indices.map(i => contacts![i]).filter(Boolean);
        }
        // If no NLU match found, keep all contacts (better to show all than nothing)
      }

      const dbPhoneSet = new Set(
        (contacts || [])
          .map(c => normalizePhoneNumber(c.phone || ''))
          .filter(Boolean)
      );

      let kbPhoneCandidates: string[] = [];
      if (villageId) {
        const knowledgeResult = await searchKnowledge(message, categories, villageId);
        const kbContext = knowledgeResult?.context || '';
        // Extract all phone numbers from knowledge context
        kbPhoneCandidates = extractPhoneNumbers(kbContext);
      }

      const kbUnique = kbPhoneCandidates.filter(phone => !dbPhoneSet.has(phone));

      if ((!contacts || contacts.length === 0) && kbUnique.length === 0) {
        const entityHint = contactEntity ? ` untuk ${contactEntity}` : '';
        return `Mohon maaf Pak/Bu, informasi nomor penting${entityHint} di ${officeName} belum tersedia.`;
      }

      const profileNameLower = (profile?.name || '').toLowerCase();
      const scored = contacts
        .map(c => {
          const nameLower = (c.name || '').toLowerCase();
          let score = 0;
          if (profileNameLower && nameLower.includes(profileNameLower)) score += 5;
          if (/admin/i.test(nameLower)) score += 1;
          return { c, score };
        })
        .sort((a, b) => b.score - a.score);

      const top = scored.slice(0, 3).map(s => s.c);
      const hasDbContacts = top.length > 0;
      const lines: string[] = [hasDbContacts ? `Kontak ${officeName}:` : `Nomor penting ${officeName}:`];

      // Format phone for WhatsApp: make it a tappable wa.me link
      const formatPhone = (phone: string): string => {
        const digits = normalizePhoneNumber(phone);
        if (channel === 'whatsapp' && digits.startsWith('62')) {
          return `wa.me/${digits}`;
        }
        return phone;
      };

      for (const c of top) {
        const extra = c.description ? ` — ${c.description}` : '';
        lines.push(`- ${c.name}: ${formatPhone(c.phone || '')}${extra}`);
      }

      if (kbUnique.length > 0) {
        if (hasDbContacts) {
          lines.push('\nNomor tambahan (KB):');
        }
        for (const phone of kbUnique.slice(0, 3)) {
          const display = channel === 'whatsapp' && phone.startsWith('62') ? `wa.me/${phone}` : phone;
          lines.push(`- ${display}`);
        }
      }

      return lines.join('\n');
    }

    // Cache for service slug match to avoid duplicate Case Service API + LLM calls
    let cachedServiceMatch: { matched_slug: string; confidence: number } | null = null;
    let cachedActiveServices: any[] | null = null;

    const tryAnswerFromServiceCatalog = async (): Promise<string | null> => {
      try {

        const response = await axios.get(`${config.caseServiceUrl}/services`, {
          params: { village_id: villageId },
          headers: { 'x-internal-api-key': config.internalApiKey },
          timeout: 5000,
        });

        const services = Array.isArray(response.data?.data) ? response.data.data : [];
        if (!services.length) return null;

        // Use micro LLM to match the query to the best service (zero hardcoded keywords)
        const activeServices = services.filter((s: any) => s.is_active !== false);
        if (!activeServices.length) return null;

        const match = await matchServiceSlug(
          normalizedQuery,
          activeServices.map((s: any) => ({
            slug: s.slug || '',
            name: s.name || '',
            description: s.description || '',
          })),
          { village_id: villageId }
        );

        // Cache the result for appendServiceOfferIfNeeded
        cachedActiveServices = activeServices;
        cachedServiceMatch = match?.matched_slug ? { matched_slug: match.matched_slug, confidence: match.confidence } : null;

        if (!match?.matched_slug || match.confidence < 0.5) return null;
        const best = activeServices.find((s: any) => s.slug === match.matched_slug);
        if (!best) return null;

        logger.info('[KnowledgeQuery] Micro LLM matched service from catalog', {
          userId, query: normalizedQuery, matched_slug: match.matched_slug,
          confidence: match.confidence, reason: match.reason,
        });

        const requirements = best.requirements || [];
        let requirementsList = '';
        if (requirements.length > 0) {
          requirementsList = requirements
            .sort((a: any, b: any) => (a.order_index || 0) - (b.order_index || 0))
            .map((req: any, i: number) => {
              const required = req.is_required ? ' (wajib)' : ' (opsional)';
              return `${i + 1}. ${req.label}${required}`;
            })
            .join('\n');
        }

        const isOnline = best.mode === 'online' || best.mode === 'both';
        let replyText = `Baik Pak/Bu, untuk ${best.name} persyaratannya antara lain:\n\n`;

        if (requirementsList) {
          replyText += `${requirementsList}\n\n`;
        } else if (best.description) {
          replyText += `${best.description}\n\n`;
        }

        if (isOnline) {
          setPendingServiceFormOffer(userId, {
            service_slug: best.slug,
            village_id: villageId,
            timestamp: Date.now(),
          });
          // Proactively include the form link
          const baseUrl = getPublicFormBaseUrl();
          const villageSlug = await resolveVillageSlugForPublicForm(villageId || '');
          const formUrl = buildPublicServiceFormUrl(baseUrl, villageSlug, best.slug, userId, 'whatsapp');
          replyText += `Jika ingin mengajukan layanan ini secara online, silakan klik link berikut:\n${formUrl}`;
        } else {
          replyText += 'Layanan ini diproses secara offline di kantor kelurahan/desa.\n\nSilakan datang ke kantor dengan membawa persyaratan di atas.';
        }

        return replyText;
      } catch (error: any) {
        logger.warn('Service catalog lookup failed', { error: error.message });
        return null;
      }
    };

    const catalogAnswer = await tryAnswerFromServiceCatalog();
    if (catalogAnswer) {
      return catalogAnswer;
    }

    const preloadedContext: string | undefined = llmResponse.fields?._preloaded_knowledge_context;
    let contextString = preloadedContext;
    let total = contextString ? 1 : 0;

    if (!contextString) {
      const knowledgeResult = await searchKnowledge(message, categories, villageId);
      total = knowledgeResult.total;
      contextString = knowledgeResult.context;
    }

    const tryExtractDeterministicKbAnswer = (queryLower: string, ctx: string): string | null => {
      const context = ctx || '';

      // 5W1H
      if (/\b5w1h\b/i.test(queryLower) && /(\bwhat\b\s*:|\bwhere\b\s*:|\bwhen\b\s*:|\bwho\b\s*:)/i.test(context)) {
        const labels = ['What', 'Where', 'When', 'Who', 'Why/How'] as const;
        const lines: string[] = ['Prinsip 5W1H untuk laporan:'];
        for (const label of labels) {
          const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const match = context.match(new RegExp(`(^|\\n)\\s*[-*]\\s*(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*:\\s*([^\\n]+)`, 'i'));
          if (match?.[2]) {
            lines.push(`- ${label}: ${match[2].trim()}`);
          }
        }
        if (lines.length >= 3) return lines.join('\n');
      }

      // Prioritas penanganan
      if (/prioritas/i.test(queryLower) && /(tinggi\s*:|sedang\s*:|rendah\s*:)/i.test(context)) {
        const labels = ['Tinggi', 'Sedang', 'Rendah'] as const;
        const lines: string[] = ['Prioritas penanganan pengaduan:'];
        for (const label of labels) {
          const match = context.match(new RegExp(`(^|\\n)\\s*[-*]\\s*(?:\\*\\*)?${label}(?:\\*\\*)?\\s*:\\s*([^\\n]+)`, 'i'));
          if (match?.[2]) {
            lines.push(`- ${label}: ${match[2].trim()}`);
          }
        }
        if (lines.length >= 3) return lines.join('\n');
      }

      // Embedding (glossary)
      if (/\bembedding\b/i.test(queryLower)) {
        const match = context.match(/(^|\n)\s*[-*]\s*(?:\*\*)?Embedding(?:\*\*)?\s*:\s*([^\n]+)/i);
        if (match?.[2]) {
          return `Embedding: ${match[2].trim()}`;
        }
      }

      // Data usage purpose
      if (/\bdata\b/i.test(queryLower) && /(digunakan|tujuan)/i.test(queryLower)) {
        // Prefer the KB phrasing that includes "proses layanan" when available.
        const usedForProses = context.match(/data\s+digunakan\s+untuk\s+(proses\s+layanan[^\n]*)/i);
        const usedForGeneric = context.match(/data\s+digunakan\s+untuk\s+([^\n]+)/i);
        const usedTail = (usedForProses?.[1] || usedForGeneric?.[1])?.trim();
        const accessedBy = context.match(/data\s+hanya\s+diakses\s+oleh\s+([^\n]+)/i);
        if (usedTail || accessedBy?.[1]) {
          const lines: string[] = ['Tujuan penggunaan data layanan digital:'];
          if (usedTail) lines.push(`- Data digunakan untuk ${usedTail}`);
          if (accessedBy?.[1]) lines.push(`- Data hanya diakses oleh ${accessedBy[1].trim()}`);
          return lines.join('\n');
        }
      }

      return null;
    };

    const appendServiceOfferIfNeeded = async (text: string): Promise<string> => {
      if (!text) return text;
      // Already contains an offer
      if (/(ajukan|mengajukan|link|formulir)/i.test(text)) return text;

      // Reuse cached match from tryAnswerFromServiceCatalog (avoids duplicate API + LLM call)
      try {
        if (cachedServiceMatch && cachedServiceMatch.confidence >= 0.5) {
          return `${text}\n\nJika Bapak/Ibu ingin mengajukan layanan ini, kami bisa bantu kirimkan link pengajuan.`;
        }

        // If cache is empty (tryAnswerFromServiceCatalog wasn't called or failed), do fresh lookup
        if (cachedServiceMatch === null && cachedActiveServices === null) {
          const svcResp = await axios.get(`${config.caseServiceUrl}/services`, {
            params: { village_id: villageId },
            headers: { 'x-internal-api-key': config.internalApiKey },
            timeout: 5000,
          });
          const services = Array.isArray(svcResp.data?.data) ? svcResp.data.data : [];
          if (services.length > 0) {
            const activeServices = services.filter((s: any) => s.is_active !== false);
            const match = await matchServiceSlug(
              normalizedQuery,
              activeServices.map((s: any) => ({ slug: s.slug || '', name: s.name || '', description: s.description || '' })),
              { village_id: villageId }
            );
            if (match?.matched_slug && match.confidence >= 0.5) {
              return `${text}\n\nJika Bapak/Ibu ingin mengajukan layanan ini, kami bisa bantu kirimkan link pengajuan.`;
            }
          }
        }
      } catch {
        // Silently skip — the offer is just a nice-to-have
      }
      return text;
    };

    // Deterministic KB extraction for anchored terms (prevents the second LLM step from omitting key lines).
    const deterministicFromContext = contextString ? tryExtractDeterministicKbAnswer(normalizedQuery, contextString) : null;
    if (deterministicFromContext) {
      return await appendServiceOfferIfNeeded(deterministicFromContext);
    }

    // If RAG context misses these anchored KB terms, force a keyword-only lookup and retry deterministic extraction.
    const wants5w1h = /\b5w1h\b/i.test(normalizedQuery);
    const wantsPriority = /prioritas/i.test(normalizedQuery);
    const wantsEmbedding = /\bembedding\b/i.test(normalizedQuery);
    const wantsDataPurpose = /\bdata\b/i.test(normalizedQuery) && /(digunakan|tujuan)/i.test(normalizedQuery);
    if (wants5w1h || wantsPriority || wantsEmbedding || wantsDataPurpose) {
      const forcedQuery = wants5w1h
        ? '5W1H What Where When Who Why How'
        : wantsPriority
          ? 'Prioritas Penanganan Tinggi Sedang Rendah'
          : wantsEmbedding
            ? 'Embedding vektor pencarian'
            : 'Tujuan Penggunaan Data proses layanan pengaduan diakses admin';

      const kw = await searchKnowledgeKeywordsOnly(forcedQuery, undefined, villageId);
      if (kw?.context) {
        const deterministicFromKeyword = tryExtractDeterministicKbAnswer(normalizedQuery, kw.context);
        if (deterministicFromKeyword) {
          return deterministicFromKeyword;
        }
        // Otherwise, enrich context for the LLM step.
        contextString = [contextString, kw.context].filter(Boolean).join('\n\n---\n\n');
        total = Math.max(total, kw.total || 0);
      }
    }

    if (!contextString || total === 0) {
      return `Maaf, saya belum memiliki informasi tentang hal tersebut untuk *${officeName}*. Jika perlu, silakan hubungi atau datang langsung ke kantor pada jam kerja.`;
    }

    // Skip second LLM call when the main LLM already produced a substantive
    // answer using the same preloaded RAG context.  Deterministic handlers
    // (address, hours, contact, service catalog) still run above — this only
    // skips the final callGemini() that would largely duplicate work.
    const hasPreloaded = !!preloadedContext;
    if (hasPreloaded && mainLlmReplyText && mainLlmReplyText.length > 50) {
      // Reject generic/placeholder replies that the main LLM sometimes produces
      const isGeneric = /(saya akan|saya cari|mencari informasi|berikut informasi yang saya|sedang mencari)/i.test(mainLlmReplyText);
      if (!isGeneric) {
        logger.info('[KnowledgeQuery] Reusing main LLM reply, skipping second callGemini', {
          userId, replyLength: mainLlmReplyText.length,
        });
        return await appendServiceOfferIfNeeded(mainLlmReplyText);
      }
    }

    const { systemPrompt } = await buildKnowledgeQueryContext(userId, message, contextString);
    const knowledgeResult2 = await callGemini(systemPrompt);
    
    if (!knowledgeResult2) {
      return 'Maaf, terjadi kendala teknis. Silakan coba lagi dalam beberapa saat.';
    }
    
    return await appendServiceOfferIfNeeded(knowledgeResult2.response.reply_text);
  } catch (error: any) {
    logger.error('Failed to handle knowledge query', { userId, error: error.message });
    return 'Maaf, terjadi kesalahan saat mencari informasi. Mohon coba lagi dalam beberapa saat.';
  }
}


// ==================== HELPER FUNCTIONS ====================

/**
 * Extract date from text
 */
function extractDateFromText(text: string): string | null {
  const today = new Date();
  const cleanText = text.toLowerCase();
  
  if (/besok/i.test(cleanText)) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  }
  if (/lusa/i.test(cleanText)) {
    const dayAfter = new Date(today);
    dayAfter.setDate(dayAfter.getDate() + 2);
    return dayAfter.toISOString().split('T')[0];
  }
  
  const dateMatch = text.match(/(\d{1,2})\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+(\d{4})/i);
  if (dateMatch) {
    const months: Record<string, number> = {
      'januari': 0, 'februari': 1, 'maret': 2, 'april': 3, 'mei': 4, 'juni': 5,
      'juli': 6, 'agustus': 7, 'september': 8, 'oktober': 9, 'november': 10, 'desember': 11
    };
    const day = parseInt(dateMatch[1]);
    const month = months[dateMatch[2].toLowerCase()];
    const year = parseInt(dateMatch[3]);
    const date = new Date(year, month, day);
    return date.toISOString().split('T')[0];
  }
  
  const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return isoMatch[0];
  
  return null;
}

/**
 * Extract time from text
 */
function extractTimeFromText(text: string): string | null {
  const cleanText = text.toLowerCase();
  
  const jamMatch = cleanText.match(/jam\s*(\d{1,2})(?::(\d{2}))?\s*(pagi|siang|sore|malam)?/i);
  if (jamMatch) {
    let hour = parseInt(jamMatch[1]);
    const minute = jamMatch[2] ? parseInt(jamMatch[2]) : 0;
    const period = jamMatch[3]?.toLowerCase();
    
    if (period === 'sore' && hour < 12) hour += 12;
    if (period === 'malam' && hour < 12) hour += 12;
    if (period === 'pagi' && hour === 12) hour = 0;
    
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  }
  
  const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
  if (timeMatch) {
    const hour = parseInt(timeMatch[1]);
    const minute = parseInt(timeMatch[2]);
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  }
  
  return null;
}

/**
 * Build natural response for complaint status
 */
function buildNaturalStatusResponse(complaint: any): string {
  const statusInfo = getStatusInfo(complaint.status);
  const complaintId = complaint.complaint_id;

  if (statusInfo.text === 'DONE') {
    const note = complaint.admin_notes || '-';
    return `Laporan ${complaintId} telah SELESAI.\nCatatan penanganan: ${note}`;
  }

  if (statusInfo.text === 'REJECT') {
    return `Laporan ${complaintId} DITOLAK.\nAlasan penolakan: ${complaint.admin_notes || '-'}`;
  }

  if (statusInfo.text === 'CANCELED') {
    return `Laporan ${complaintId} telah DIBATALKAN.\nKeterangan: ${complaint.admin_notes || 'Dibatalkan oleh masyarakat'}`;
  }

  if (statusInfo.text === 'PROCESS') {
    return `Status laporan ${complaintId} saat ini adalah PROCESS.`;
  }

  return `Status laporan ${complaintId} saat ini adalah ${statusInfo.text}.`;
}

/**
 * Build natural response for service request status
 * Now includes result file and description from admin
 */
function buildNaturalServiceStatusResponse(serviceRequest: any): string {
  const statusInfo = SERVICE_STATUS_MAP[serviceRequest.status] || { emoji: '📋', text: serviceRequest.status };

  let message = `Baik Pak/Bu, status layanan ${serviceRequest.request_number} saat ini adalah ${statusInfo.text}.`;

  if (statusInfo.text === 'OPEN') {
    message += `\nPermohonan sedang menunggu untuk diproses.`;
  }

  if (statusInfo.text === 'PROCESS') {
    message += `\nPermohonan Anda sedang diproses oleh petugas desa.`;
  }

  if (statusInfo.text === 'DONE') {
    if (serviceRequest.admin_notes) {
      message += `\n\nCatatan dari petugas desa:\n${serviceRequest.admin_notes}`;
    }
  }

  if (statusInfo.text === 'REJECT') {
    message += `\n\nAlasan penolakan:\n${serviceRequest.admin_notes || '-'}`;
  }

  if (statusInfo.text === 'CANCELED') {
    message += `\n\nKeterangan: ${serviceRequest.admin_notes || 'Dibatalkan'}`;
  }

  return message;
}

function maskSensitiveId(value: string, keepStart = 4, keepEnd = 4): string {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= keepStart + keepEnd) return text;
  const masked = '*'.repeat(Math.max(3, text.length - keepStart - keepEnd));
  return `${text.slice(0, keepStart)}${masked}${text.slice(-keepEnd)}`;
}

function toSafeDate(value: any): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function formatDateTimeId(date: Date | null): string {
  if (!date) return '-';
  return date.toISOString().replace('T', ' ').replace('Z', ' UTC');
}

function buildComplaintDetailResponse(complaint: any): string {
  const statusInfo = getStatusInfo(complaint.status);
  const createdAt = toSafeDate(complaint.created_at || complaint.createdAt);
  const updatedAt = toSafeDate(complaint.updated_at || complaint.updatedAt);
  const adminNoteSection = buildAdminNoteSection(complaint.status, complaint.admin_notes);

  let message = `📄 *Detail Laporan*\n\n`;
  message += `🆔 *Nomor:* ${complaint.complaint_id}\n`;
  message += `📌 *Jenis:* ${formatKategori(complaint.kategori)}\n`;
  if (complaint.alamat) message += `📍 *Lokasi:* ${complaint.alamat}\n`;
  if (complaint.rt_rw) message += `🏠 *RT/RW:* ${complaint.rt_rw}\n`;
  if (complaint.deskripsi) message += `\n📝 *Deskripsi:*\n${complaint.deskripsi}\n`;

  message += `\n${statusInfo.emoji} *Status:* ${statusInfo.text}\n`;
  message += `${statusInfo.description}\n`;

  if (adminNoteSection) {
    message += adminNoteSection;
  }

  message += `\n🗓️ *Dibuat:* ${formatDateTimeId(createdAt)}\n`;
  message += `🕐 *Update terakhir:* ${formatDateTimeId(updatedAt)}\n`;

  return message;
}

function buildServiceRequestDetailResponse(serviceRequest: any, requirementDefs: ServiceRequirementDefinition[] = []): string {
  const statusInfo = SERVICE_STATUS_MAP[serviceRequest.status] || { emoji: '📋', text: serviceRequest.status };
  const createdAt = toSafeDate(serviceRequest.created_at || serviceRequest.createdAt);
  const updatedAt = toSafeDate(serviceRequest.updated_at || serviceRequest.updatedAt);
  const adminNoteSection = buildAdminNoteSection(serviceRequest.status, serviceRequest.admin_notes);

  let message = `📄 *Detail Layanan*\n\n`;
  message += `🆔 *Nomor:* ${serviceRequest.request_number}\n`;
  message += `📌 *Layanan:* ${serviceRequest.service?.name || 'Layanan Administrasi'}\n`;
  message += `\n${statusInfo.emoji} *Status:* ${statusInfo.text}\n`;

  if (adminNoteSection) {
    message += adminNoteSection;
  }

  if (serviceRequest.result_description) {
    message += `\n📝 *Hasil:* ${serviceRequest.result_description}\n`;
  }

  if (serviceRequest.result_file_url) {
    const fileName = serviceRequest.result_file_name || 'Dokumen Hasil';
    message += `\n📎 *Dokumen:* ${fileName}\n`;
    message += `🔗 Link download: ${serviceRequest.result_file_url}\n`;
  }

  const citizen = serviceRequest.citizen_data_json || {};
  const reqData = serviceRequest.requirement_data_json || {};
  const reqFilledCount = typeof reqData === 'object' && reqData ? Object.values(reqData).filter(Boolean).length : 0;

  message += `\n👤 *Data pemohon (ringkas):*\n`;
  if (citizen.nama_lengkap) message += `• Nama: ${citizen.nama_lengkap}\n`;
  if (citizen.nik) message += `• NIK: ${maskSensitiveId(String(citizen.nik), 4, 4)}\n`;
  if (citizen.alamat) message += `• Alamat: ${citizen.alamat}\n`;
  if (citizen.wa_user_id) message += `• WA: ${citizen.wa_user_id}\n`;

  const hasDefs = Array.isArray(requirementDefs) && requirementDefs.length > 0;
  if (!hasDefs) {
    message += `• Persyaratan terisi: ${reqFilledCount}\n`;
  }

  if (hasDefs) {
    const defsSorted = [...requirementDefs].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
    const totalRequired = defsSorted.filter(d => d.is_required).length;
    const filledRequired = defsSorted.filter(d => d.is_required && !!(reqData as any)?.[d.id]).length;
    message += `• Persyaratan wajib terisi: ${filledRequired}/${totalRequired}\n`;

    const isProbablyUrl = (value: unknown): boolean => {
      const s = typeof value === 'string' ? value : '';
      return /^https?:\/\//i.test(s) || /\.(pdf|jpg|jpeg|png|doc|docx)(\?|#|$)/i.test(s);
    };

    const safeValueSummary = (def: ServiceRequirementDefinition, rawValue: any): string | null => {
      if (!rawValue) return null;
      if (def.field_type === 'file') return 'Terlampir';
      if (isProbablyUrl(rawValue)) return 'Terlampir';
      const s = String(rawValue);
      const cleaned = s.replace(/\s+/g, ' ').trim();
      if (!cleaned) return null;
      if (cleaned.length > 60) return `${cleaned.slice(0, 57)}...`;
      return cleaned;
    };

    const missingRequired = defsSorted.filter(d => d.is_required && !(reqData as any)?.[d.id]);
    if (missingRequired.length > 0) {
      const missLines = missingRequired.map(d => `❌ ${d.label}`).join('\n');
      message += `\n⚠️ *Persyaratan wajib belum lengkap:*\n${missLines}\n`;
    } else if (totalRequired > 0) {
      message += `\n✅ *Semua persyaratan wajib sudah lengkap.*\n`;
    }

    const filledSummaries = defsSorted
      .map(d => {
        const raw = (reqData as any)?.[d.id];
        const summary = safeValueSummary(d, raw);
        if (!summary) return null;
        return `✅ ${d.label}: ${summary}`;
      })
      .filter(Boolean) as string[];

    // Keep the output compact: show up to 10 filled summaries.
    if (filledSummaries.length > 0) {
      message += `\n📎 *Ringkasan persyaratan terisi:*\n${filledSummaries.slice(0, 10).join('\n')}\n`;
      if (filledSummaries.length > 10) {
        message += `(${filledSummaries.length - 10} item lainnya disembunyikan)\n`;
      }
    }
  }

  message += `\n🗓️ *Dibuat:* ${formatDateTimeId(createdAt)}\n`;
  message += `🕐 *Update terakhir:* ${formatDateTimeId(updatedAt)}\n`;

  return message;
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffMinutes < 1) return 'baru saja';
  if (diffMinutes < 60) return `${diffMinutes} menit yang lalu`;
  if (diffHours < 24) return `${diffHours} jam yang lalu`;
  if (diffDays === 1) return 'kemarin';
  return `${diffDays} hari yang lalu`;
}

/**
 * Format kategori for display. Uses simple title-case transformation
 * since the kategori value itself comes from DB via LLM matching.
 */
function formatKategori(kategori: string): string {
  if (!kategori) return 'Lainnya';
  // Convert snake_case to Title Case
  return kategori
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function getStatusInfo(status: string): { emoji: string; text: string; description: string } {
  return COMPLAINT_STATUS_MAP[status] || { emoji: '📋', text: status, description: 'Silakan tunggu update selanjutnya ya!' };
}

function buildAdminNoteSection(status: string, adminNotes?: string): string {
  const normalized = (status || '').toString().toUpperCase();
  const note = adminNotes ? String(adminNotes).trim() : '';

  if (normalized === 'DONE') {
    return note ? `\n\n💬 *Catatan petugas:*\n${note}\n` : '';
  }

  if (normalized === 'REJECT') {
    return `\n\n📝 *Alasan penolakan:*\n${note || '-'}\n`;
  }

  if (normalized === 'CANCELED') {
    return `\n\n📝 *Keterangan:* ${note || 'Dibatalkan'}\n`;
  }

  return note ? `\n\n💬 *Catatan petugas:*\n${note}\n` : '';
}

function buildCancelSuccessResponse(type: 'laporan' | 'layanan', id: string, reason: string): string {
  const label = type === 'laporan' ? 'Laporan' : 'Layanan';
  const note = reason || 'Dibatalkan oleh masyarakat';
  return `${label} ${id} telah DIBATALKAN.\nKeterangan: ${note}`;
}

function buildCancelErrorResponse(type: 'laporan' | 'layanan', id: string, error?: string, message?: string): string {
  const label = type === 'laporan' ? 'laporan' : 'layanan';
  switch (error) {
    case 'NOT_FOUND':
      return `Mohon maaf Pak/Bu, kami tidak menemukan ${label} dengan nomor *${id}*.`;
    case 'NOT_OWNER':
      return `Mohon maaf Pak/Bu, ${label} *${id}* ini bukan milik Anda, jadi tidak bisa dibatalkan.`;
    case 'ALREADY_COMPLETED':
    case 'LOCKED':
      return `Mohon maaf Pak/Bu, ${label} *${id}* sudah tidak bisa dibatalkan karena statusnya sudah final.`;
    default:
      return `Mohon maaf Pak/Bu, ada kendala saat membatalkan ${label}. ${message || 'Silakan coba lagi.'}`;
  }
}

function buildHistoryResponse(items: HistoryItem[], total: number): string {
  const complaints = items.filter(i => i.type === 'complaint');
  const services = items.filter(i => i.type === 'service');

  if (complaints.length > 0) {
    let message = 'Berikut laporan yang pernah Anda kirimkan:\n\n';
    for (const item of complaints.slice(0, 5)) {
      const statusLabel = getStatusLabel(item.status);
      const desc = (item.description || '').trim() || 'Laporan';
      message += `${item.display_id} – ${desc} – ${statusLabel}\n`;
    }
    return message.trim();
  }

  if (services.length > 0) {
    let message = 'Berikut layanan yang pernah Anda ajukan:\n\n';
    for (const item of services.slice(0, 5)) {
      const statusLabel = getStatusLabel(item.status);
      const desc = (item.description || '').trim() || 'Layanan';
      message += `${item.display_id} – ${desc} – ${statusLabel}\n`;
    }
    return message.trim();
  }

  return `Berikut riwayat Anda (${total}).`;
}

function getStatusLabel(status: string): string {
  const normalized = String(status || '').toUpperCase();
  // Use shared COMPLAINT_STATUS_MAP for consistent status labels
  const entry = COMPLAINT_STATUS_MAP[status] || COMPLAINT_STATUS_MAP[normalized];
  if (entry) return entry.text;
  // Fallback for Indonesian status names
  const fallback: Record<string, string> = {
    BARU: 'OPEN', PENDING: 'OPEN', PROSES: 'PROCESS',
    SELESAI: 'SELESAI', DIBATALKAN: 'DIBATALKAN', DITOLAK: 'DITOLAK',
  };
  return fallback[normalized] || normalized || 'UNKNOWN';
}


// ==================== MAIN PROCESSOR ====================

/**
 * Get pending address confirmation for a user
 */
export function getPendingAddressConfirmation(userId: string) {
  return pendingAddressConfirmation.get(userId);
}

/**
 * Clear pending address confirmation for a user
 */
export function clearPendingAddressConfirmation(userId: string) {
  pendingAddressConfirmation.delete(userId);
}

/**
 * Set pending address confirmation for a user
 */
export function setPendingAddressConfirmation(userId: string, data: {
  alamat: string;
  kategori: string;
  deskripsi: string;
  village_id?: string;
  timestamp: number;
  foto_url?: string;
}) {
  pendingAddressConfirmation.set(userId, data);
}

export function clearPendingCancelConfirmation(userId: string) {
  pendingCancelConfirmation.delete(userId);
}

export function setPendingCancelConfirmation(userId: string, data: {
  type: 'laporan' | 'layanan';
  id: string;
  reason?: string;
  timestamp: number;
}) {
  pendingCancelConfirmation.set(userId, data);
}

export function getPendingServiceFormOffer(userId: string) {
  return pendingServiceFormOffer.get(userId);
}

export function clearPendingServiceFormOffer(userId: string) {
  pendingServiceFormOffer.delete(userId);
}

export function setPendingServiceFormOffer(userId: string, data: {
  service_slug: string;
  village_id?: string;
  timestamp: number;
}) {
  pendingServiceFormOffer.set(userId, data);
}

// Export helpers for pendingAddressRequest (missing required address)
export function getPendingAddressRequest(userId: string) {
  return pendingAddressRequest.get(userId);
}

export function clearPendingAddressRequest(userId: string) {
  pendingAddressRequest.delete(userId);
}

export function setPendingAddressRequest(userId: string, data: {
  kategori: string;
  deskripsi: string;
  village_id?: string;
  timestamp: number;
  foto_url?: string;
}) {
  pendingAddressRequest.set(userId, data);
}

/**
 * Process message from any channel
 * This is the SINGLE SOURCE OF TRUTH for message processing
 * 
 * OPTIMIZATION FLOW:
 * 1. Spam check
 * 2. Pending state check
 * 3. Fast intent classification (NEW)
 * 4. Response cache check (NEW)
 * 5. Entity pre-extraction (NEW)
 * 6. If fast path available → return cached/quick response
 * 7. Otherwise → full LLM processing
 */
export async function processUnifiedMessage(input: ProcessMessageInput): Promise<ProcessMessageResult> {
  _activeProcessingCount++;
  const startTime = Date.now();
  const { userId, message, channel, conversationHistory, mediaUrl, villageId, isEvaluation } = input;
  let resolvedHistory = conversationHistory;
  
  // Generate trace ID for correlating all logs in this request
  const traceId = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  
  const tracker = createProcessingTracker(userId);
  
  logger.info('🎯 [UnifiedProcessor] Processing message', {
    traceId,
    userId,
    channel,
    messageLength: message.length,
    hasHistory: !!conversationHistory,
    hasMedia: !!mediaUrl,
  });
  
  try {
    // Update status: reading message
    tracker.reading();
    
    // Step 1: Spam check
    if (isSpamMessage(message)) {
      logger.warn('🚫 [UnifiedProcessor] Spam detected', { userId, channel });
      return {
        success: false,
        response: '',
        intent: 'SPAM',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        error: 'Spam message detected',
      };
    }

    const resolvedVillageId = villageId;

    // Cumulative timeout budget for micro-NLU classifiers (prevents worst-case stacking)
    const MICRO_NLU_BUDGET_MS = 8000;
    let microNluElapsedMs = 0;
    const hasMicroNluBudget = () => microNluElapsedMs < MICRO_NLU_BUDGET_MS;
    const withMicroNluBudget = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      if (!hasMicroNluBudget()) {
        logger.warn('[UnifiedProcessor] Micro-NLU budget exhausted, skipping classifier', {
          elapsed: microNluElapsedMs, budget: MICRO_NLU_BUDGET_MS,
        });
        return fallback;
      }
      const t0 = Date.now();
      try {
        const remaining = MICRO_NLU_BUDGET_MS - microNluElapsedMs;
        return await Promise.race([
          fn(),
          new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Micro-NLU budget timeout')), remaining)),
        ]);
      } finally {
        microNluElapsedMs += Date.now() - t0;
      }
    };

    // Classify greeting once via micro NLU and cache the result for multiple usage points
    // Uses unified classifier that returns message_type + rag_needed + categories in ONE call
    let unifiedClassifyResult: UnifiedClassifyResult | null = null;
    let unifiedClassified = false;
    const getUnifiedClassification = async (): Promise<UnifiedClassifyResult | null> => {
      if (!unifiedClassified) {
        unifiedClassified = true;
        try {
          unifiedClassifyResult = await withMicroNluBudget(
            () => classifyMessage(message.trim(), {
              village_id: resolvedVillageId,
              wa_user_id: userId,
              session_id: userId,
              channel,
            }),
            null
          );
        } catch (error: any) {
          logger.warn('[UnifiedProcessor] Unified NLU classify failed', { error: error.message });
          unifiedClassifyResult = null;
        }
      }
      return unifiedClassifyResult;
    };

    let greetingClassified = false;
    let isGreetingMessage = false;
    const checkGreeting = async (): Promise<boolean> => {
      if (!greetingClassified) {
        greetingClassified = true;
        const unified = await getUnifiedClassification();
        isGreetingMessage = unified?.message_type === 'GREETING' && unified.confidence >= 0.7;
      }
      return isGreetingMessage;
    };

    if (channel === 'whatsapp' && (!resolvedHistory || resolvedHistory.length === 0)) {
      resolvedHistory = await fetchConversationHistoryFromChannel(userId, resolvedVillageId);
      // Append current user message to cache so subsequent calls see it
      appendToHistoryCache(userId, 'user', message);
      logger.info('📚 [UnifiedProcessor] Loaded WhatsApp history', {
        userId,
        historyCount: resolvedHistory?.length || 0,
      });
    }

    const pendingName = pendingNameConfirmation.get(userId);
    if (pendingName) {
      // Use micro LLM for name confirmation (full NLU, no regex fallback)
      let nameDecision: string;
      try {
        const nameResult = await withMicroNluBudget(
          () => classifyConfirmation(message.trim(), { village_id: resolvedVillageId, wa_user_id: userId, session_id: userId, channel }),
          null
        );
        nameDecision = nameResult?.decision === 'CONFIRM' ? 'yes' : nameResult?.decision === 'REJECT' ? 'no' : 'uncertain';
      } catch {
        nameDecision = 'uncertain';
      }

      if (nameDecision === 'yes') {
        pendingNameConfirmation.delete(userId);
        updateProfile(userId, { nama_lengkap: pendingName.name });
        syncNameToChannelService(userId, pendingName.name, resolvedVillageId, channel);
        return {
          success: true,
          response: `Baik, terima kasih Pak/Bu ${pendingName.name}. Ada yang bisa kami bantu?`,
          intent: 'QUESTION',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }

      if (nameDecision === 'no') {
        pendingNameConfirmation.delete(userId);
        return {
          success: true,
          response: 'Mohon maaf, boleh kami tahu nama yang benar?',
          intent: 'QUESTION',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }

      // uncertain → re-ask
      return {
        success: true,
        response: `Baik, apakah benar ini dengan Bapak/Ibu ${pendingName.name}? Balas YA atau BUKAN ya.`,
        intent: 'QUESTION',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
      };
    }

    const lastPromptedName = extractNameFromAssistantPrompt(getLastAssistantMessage(resolvedHistory));
    if (lastPromptedName) {
      // Use micro LLM for name confirmation via history (full NLU, no regex fallback)
      let histNameDecision: string;
      try {
        const histNameResult = await withMicroNluBudget(
          () => classifyConfirmation(message.trim(), { village_id: resolvedVillageId, wa_user_id: userId, session_id: userId, channel }),
          null
        );
        histNameDecision = histNameResult?.decision === 'CONFIRM' ? 'yes' : histNameResult?.decision === 'REJECT' ? 'no' : 'uncertain';
      } catch {
        histNameDecision = 'uncertain';
      }

      if (histNameDecision === 'yes') {
        logger.info('🧭 [UnifiedProcessor] Name confirmation via history', {
          userId,
          name: lastPromptedName,
          source: 'history_prompt',
        });
        updateProfile(userId, { nama_lengkap: lastPromptedName });
        syncNameToChannelService(userId, lastPromptedName, resolvedVillageId, channel);
        return {
          success: true,
          response: `Baik, terima kasih Pak/Bu ${lastPromptedName}. Ada yang bisa kami bantu?`,
          intent: 'QUESTION',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }

      if (histNameDecision === 'no') {
        return {
          success: true,
          response: 'Mohon maaf, boleh kami tahu nama yang benar?',
          intent: 'QUESTION',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }
      // uncertain → fall through to normal processing
    }

    // Step 2.2: Check pending online service form offer
    const pendingOffer = pendingServiceFormOffer.get(userId);
    if (pendingOffer) {
      const confirmationResult = await withMicroNluBudget(
        () => classifyConfirmation(message, { village_id: resolvedVillageId, wa_user_id: userId, session_id: userId, channel }),
        null
      );
      const isLikelyConfirm = confirmationResult && confirmationResult.decision === 'CONFIRM' && confirmationResult.confidence >= 0.7;
      const isLikelyReject = confirmationResult && confirmationResult.decision === 'REJECT' && confirmationResult.confidence >= 0.7;

      if (isLikelyConfirm) {
        clearPendingServiceFormOffer(userId);
        const llmLike = {
          intent: 'CREATE_SERVICE_REQUEST',
          fields: {
            service_slug: pendingOffer.service_slug,
            ...(pendingOffer.village_id ? { village_id: pendingOffer.village_id } : {}),
          },
          reply_text: '',
        };

        const linkReply = await handleServiceRequestCreation(userId, channel, llmLike);
        return {
          success: true,
          response: linkReply,
          intent: 'CREATE_SERVICE_REQUEST',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }

      if (isLikelyReject) {
        clearPendingServiceFormOffer(userId);
        return {
          success: true,
          response: 'Baik Pak/Bu, siap. Kalau Bapak/Ibu mau proses nanti, kabari kami ya.',
          intent: 'QUESTION',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }

      return {
        success: true,
        response: 'Apakah Bapak/Ibu ingin kami kirim link formulirnya sekarang? Balas *iya* atau *tidak* ya.',
        intent: 'CREATE_SERVICE_REQUEST',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
      };
    }

    // Hard gate: wajib tahu nama sebelum proses apa pun
    const profileName = getProfile(userId).nama_lengkap || null;
    const nluContext = { village_id: resolvedVillageId, wa_user_id: userId, session_id: userId, channel };
    const lastAssistantMsg = getLastAssistantMessage(resolvedHistory);
    const historyName = await extractNameFromHistoryNLU(resolvedHistory, nluContext);
    const knownName = historyName || profileName;
    const currentName = await extractNameFromTextNLU(message, { ...nluContext, last_assistant_message: lastAssistantMsg });

    // If we found a name from chat history but it's not persisted in profile yet,
    // persist it now and sync to Channel Service (fixes livechat showing phone only)
    if (historyName && !profileName) {
      updateProfile(userId, { nama_lengkap: historyName });
      syncNameToChannelService(userId, historyName, resolvedVillageId, channel);
    }
    if (!knownName && !currentName) {
      const askedNameBefore = wasNamePrompted(resolvedHistory);
      if (askedNameBefore) {
        return {
          success: true,
          response: 'Maaf Pak/Bu, saya belum menangkap nama Anda. Mohon tuliskan nama Anda, misalnya: "Nama saya Yoga".',
          intent: 'QUESTION',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }

      if (await checkGreeting()) {
        const profile = await getVillageProfileSummary(resolvedVillageId);
        const villageLabel = profile?.name ? profile.name : 'Desa/Kelurahan';
        return {
          success: true,
          response: `Selamat datang di layanan GovConnect ${villageLabel}.\nBoleh kami tahu nama Bapak/Ibu terlebih dahulu?`,
          intent: 'QUESTION',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }

      return {
        success: true,
        response: 'Baik Pak/Bu, sebelum melanjutkan boleh kami tahu nama Anda terlebih dahulu?',
        intent: 'QUESTION',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
      };
    }

    if (!knownName && currentName) {
      const explicitName = /(nama\s+(saya|aku|gue|gw)|panggil\s+saya)/i.test(message);
      if (explicitName) {
        updateProfile(userId, { nama_lengkap: currentName });
        syncNameToChannelService(userId, currentName, resolvedVillageId, channel);
        return {
          success: true,
          response: `Baik, terima kasih Pak/Bu ${currentName}. Ada yang bisa kami bantu?`,
          intent: 'QUESTION',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }

      pendingNameConfirmation.set(userId, { name: currentName, timestamp: Date.now() });
      return {
        success: true,
        response: `Baik, apakah benar ini dengan Bapak/Ibu ${currentName}?`,
        intent: 'QUESTION',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
      };
    }

    // Step 1.8b: Name update/correction — user already known but mentions a different name
    // Uses micro NLU to distinguish "nama saya X" (klarifikasi) vs mentioning someone else
    if (knownName && currentName && knownName.toLowerCase() !== currentName.toLowerCase()) {
      try {
        const nameUpdateResult = await withMicroNluBudget(
          () => classifyNameUpdate(message, knownName, {
            village_id: resolvedVillageId,
            wa_user_id: userId,
            session_id: userId,
            channel,
          }),
          null
        );
        if (nameUpdateResult?.decision === 'UPDATE_NAME' && nameUpdateResult.confidence >= 0.7) {
          const resolvedNewName = nameUpdateResult.new_name?.trim() || currentName;
          updateProfile(userId, { nama_lengkap: resolvedNewName });
          syncNameToChannelService(userId, resolvedNewName, resolvedVillageId, channel);
          return {
            success: true,
            response: `Baik, nama Anda sudah kami perbarui dari "${knownName}" menjadi "${resolvedNewName}". Ada yang bisa kami bantu lagi?`,
            intent: 'QUESTION',
            metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
          };
        }
        // NO_UPDATE → name mentioned in other context, continue normal processing
      } catch (error: any) {
        logger.warn('[UnifiedProcessor] Name update NLU failed, continuing normal flow', { error: error.message });
      }
    }
    
    // Step 1.9: Farewell detection — uses unified classifier (shares same LLM call as greeting/RAG check)
    if (message.trim().length < 80) {
      try {
        const unified = await getUnifiedClassification();
        if (unified?.message_type === 'FAREWELL' && unified.confidence >= 0.8) {
          const userName = knownName || getProfile(userId).nama_lengkap;
          const nameGreeting = userName ? ` ${userName}` : '';
          tracker.complete();
          return {
            success: true,
            response: `Baik Pak/Bu${nameGreeting}, terima kasih sudah menghubungi layanan GovConnect. Semoga informasinya bermanfaat. Jangan ragu hubungi kami kembali jika ada keperluan lain ya!`,
            intent: 'QUESTION',
            metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
          };
        }
      } catch (error: any) {
        logger.warn('[UnifiedProcessor] Farewell NLU failed, continuing normal flow', { error: error.message });
      }
    }
    
    // Step 1.95: Help/Menu command — quick feature listing
    const helpPattern = /^\s*(bantuan|help|menu|fitur|layanan apa saja|bisa apa|apa saja|panduan)\s*[?.!]*\s*$/i;
    if (helpPattern.test(message.trim())) {
      const userName = knownName || getProfile(userId).nama_lengkap;
      const nameGreeting = userName ? ` ${userName}` : '';
      tracker.complete();
      return {
        success: true,
        response: `Halo Pak/Bu${nameGreeting}! Berikut layanan yang tersedia di GovConnect:\n\n` +
          `📋 *Pengaduan* — Laporkan keluhan infrastruktur, lingkungan, dll\n` +
          `📄 *Layanan Surat* — Ajukan pembuatan surat (SKTM, domisili, dll)\n` +
          `🔍 *Cek Status* — Cek status pengaduan atau permohonan surat\n` +
          `❌ *Batalkan* — Batalkan pengaduan atau permohonan\n` +
          `ℹ️ *Informasi* — Tanya syarat, prosedur, jam layanan, dll\n\n` +
          `Silakan ketik keperluan Bapak/Ibu, misalnya:\n` +
          `• "Saya mau lapor jalan rusak"\n` +
          `• "Syarat buat SKTM apa?"\n` +
          `• "Cek status laporan LAP-xxx"`,
        intent: 'QUESTION',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
      };
    }

    // Step 1.96: Voice/Sticker/GIF fallback — unsupported media types
    if (input.mediaType && ['voice', 'audio', 'sticker', 'gif', 'video_note'].includes(input.mediaType.toLowerCase())) {
      const mediaLabels: Record<string, string> = {
        voice: 'pesan suara', audio: 'audio', sticker: 'sticker',
        gif: 'GIF', video_note: 'video',
      };
      const label = mediaLabels[input.mediaType.toLowerCase()] || input.mediaType;
      tracker.complete();
      return {
        success: true,
        response: `Mohon maaf, saat ini kami belum bisa memproses ${label}. ` +
          `Silakan ketik pesan dalam bentuk teks ya, Pak/Bu.\n\n` +
          `Ketik *bantuan* untuk melihat daftar layanan yang tersedia.`,
        intent: 'QUESTION',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
      };
    }

    // Step 1.97: Emergency detection is now fully DB-driven.
    // No pre-LLM keyword matching — the LLM handles intent classification,
    // and is_urgent comes from complaintTypeConfig in the DB.

    // Step 2: Check pending address confirmation (for vague addresses)
    const pendingConfirm = pendingAddressConfirmation.get(userId);
    if (pendingConfirm) {
      const confirmResult = await handlePendingAddressConfirmation(userId, message, pendingConfirm, channel === 'webchat' ? 'webchat' : 'whatsapp', mediaUrl);
      if (confirmResult) {
        return {
          success: true,
          response: confirmResult,
          intent: 'CREATE_COMPLAINT',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }
    }
    
    // Step 2.05: Check pending address request (for missing required addresses)
    const pendingAddr = pendingAddressRequest.get(userId);
    if (pendingAddr) {
      // Try to extract address from user's message via NLU
      const extractedAddr = await extractAddressFromMessage(message, userId, { village_id: pendingAddr.village_id });
      if (extractedAddr && extractedAddr.length >= 5) {
        pendingAddressRequest.delete(userId);
        
        // Continue with complaint creation using the new address
        const llmLike = {
          fields: {
            village_id: pendingAddr.village_id,
            kategori: pendingAddr.kategori,
            deskripsi: pendingAddr.deskripsi,
            alamat: extractedAddr,
          },
        };
        
        logger.info('Continuing complaint with provided address', { 
          userId, 
          kategori: pendingAddr.kategori,
          alamat: extractedAddr,
        });
        
        // If current message also has a photo, accumulate it
        if (mediaUrl) addPendingPhoto(userId, mediaUrl);
        
        const complaintResult = await handleComplaintCreation(
          userId, 
          channel === 'webchat' ? 'webchat' : 'whatsapp', 
          llmLike, 
          message, 
          undefined // Photos tracked in pendingPhotos cache
        );
        
        return {
          success: true,
          response: complaintResult,
          intent: 'CREATE_COMPLAINT',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      } else if (message.trim().length > 10) {
        // User might have provided address in free text, use their message as address
        pendingAddressRequest.delete(userId);
        
        const llmLike = {
          fields: {
            village_id: pendingAddr.village_id,
            kategori: pendingAddr.kategori,
            deskripsi: pendingAddr.deskripsi,
            alamat: message.trim(),
          },
        };
        
        logger.info('Using user message as address for complaint', { 
          userId, 
          kategori: pendingAddr.kategori,
          alamat: message.trim(),
        });
        
        // If current message also has a photo, accumulate it
        if (mediaUrl) addPendingPhoto(userId, mediaUrl);
        
        const complaintResult = await handleComplaintCreation(
          userId, 
          channel === 'webchat' ? 'webchat' : 'whatsapp', 
          llmLike, 
          message, 
          undefined // Photos tracked in pendingPhotos cache
        );
        
        return {
          success: true,
          response: complaintResult,
          intent: 'CREATE_COMPLAINT',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }
    }

    // Step 2.07: Check pending complaint data (waiting for name/phone)
    const pendingComplaint = pendingComplaintData.get(userId);
    if (pendingComplaint) {
      const userProfile = getProfile(userId);
      
      if (pendingComplaint.waitingFor === 'nama') {
        // Try to extract name from message
        const extractedName = await extractNameFromTextNLU(message, { village_id: resolvedVillageId, wa_user_id: userId, session_id: userId, channel });
        if (extractedName) {
          // Save name to profile + sync to Channel Service sidebar
          updateProfile(userId, { nama_lengkap: extractedName });
          syncNameToChannelService(userId, extractedName, resolvedVillageId, channel);
          
          // Check if webchat still needs phone
          if (pendingComplaint.channel === 'webchat' && !userProfile.no_hp) {
            // Update pending to wait for phone
            pendingComplaintData.set(userId, {
              ...pendingComplaint,
              waitingFor: 'no_hp',
              timestamp: Date.now(),
            });
            
            return {
              success: true,
              response: `Terima kasih Pak/Bu ${extractedName}. Mohon informasikan juga nomor telepon yang dapat dihubungi.`,
              intent: 'CREATE_COMPLAINT',
              metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
            };
          }
          
          // All data complete, proceed with complaint creation
          pendingComplaintData.delete(userId);
          
          const llmLike = {
            fields: {
              village_id: pendingComplaint.village_id,
              kategori: pendingComplaint.kategori,
              deskripsi: pendingComplaint.deskripsi,
              alamat: pendingComplaint.alamat,
              rt_rw: pendingComplaint.rt_rw,
            },
          };
          
          logger.info('Continuing complaint after name received', { 
            userId, 
            nama: extractedName,
            kategori: pendingComplaint.kategori,
          });
          
          const complaintResult = await handleComplaintCreation(
            userId, 
            pendingComplaint.channel, 
            llmLike, 
            message, 
            undefined // Photos tracked in pendingPhotos cache
          );
          
          return {
            success: true,
            response: complaintResult,
            intent: 'CREATE_COMPLAINT',
            metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
          };
        }
        
        // Could not extract name, ask again
        return {
          success: true,
          response: 'Mohon maaf Pak/Bu, boleh tuliskan nama lengkap Anda untuk melanjutkan laporan?',
          intent: 'CREATE_COMPLAINT',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }
      
      if (pendingComplaint.waitingFor === 'no_hp') {
        // Try to extract phone from message
        const phoneMatch = message.match(/\b(0[87]\d{8,11}|62[87]\d{8,11}|\+62[87]\d{8,11})\b/);
        if (phoneMatch) {
          const phone = phoneMatch[1].replace(/^\+/, '');
          
          // Save phone to profile + sync to Channel Service
          updateProfile(userId, { no_hp: phone });
          const channelUpper = (pendingComplaint.channel || 'webchat').toUpperCase() as 'WHATSAPP' | 'WEBCHAT';
          updateConversationUserProfile(userId, { user_phone: phone }, pendingComplaint.village_id, channelUpper)
            .catch(() => { /* non-critical */ });
          
          // All data complete, proceed with complaint creation
          pendingComplaintData.delete(userId);
          
          const llmLike = {
            fields: {
              village_id: pendingComplaint.village_id,
              kategori: pendingComplaint.kategori,
              deskripsi: pendingComplaint.deskripsi,
              alamat: pendingComplaint.alamat,
              rt_rw: pendingComplaint.rt_rw,
            },
          };
          
          logger.info('Continuing complaint after phone received', { 
            userId, 
            phone,
            kategori: pendingComplaint.kategori,
          });
          
          const complaintResult = await handleComplaintCreation(
            userId, 
            pendingComplaint.channel, 
            llmLike, 
            message, 
            undefined // Photos tracked in pendingPhotos cache
          );
          
          return {
            success: true,
            response: complaintResult,
            intent: 'CREATE_COMPLAINT',
            metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
          };
        }
        
        // Could not extract phone, ask again
        return {
          success: true,
          response: 'Mohon maaf Pak/Bu, format nomor telepon sepertinya kurang tepat. Silakan masukkan nomor HP yang valid (contoh: 081234567890).',
          intent: 'CREATE_COMPLAINT',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }
    }

    // Step 2.08: Photo-only message during active complaint flow
    // If user sends a photo with no meaningful text while we're collecting complaint data,
    // accumulate the photo and acknowledge it without disrupting the flow.
    if (mediaUrl && message.trim().length < 5) {
      const hasActiveComplaintFlow = pendingAddressRequest.get(userId) || pendingAddressConfirmation.get(userId) || pendingComplaintData.get(userId);
      if (hasActiveComplaintFlow) {
        const photoCount = getPendingPhotoCount(userId);
        if (photoCount >= MAX_PHOTOS_PER_COMPLAINT) {
          return {
            success: true,
            response: `Maaf Pak/Bu, maksimal ${MAX_PHOTOS_PER_COMPLAINT} foto per laporan. Foto sebelumnya sudah kami simpan. Silakan lanjutkan menjawab pertanyaan kami.`,
            intent: 'CREATE_COMPLAINT',
            metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
          };
        }
        addPendingPhoto(userId, mediaUrl);
        const newCount = getPendingPhotoCount(userId);
        const remaining = MAX_PHOTOS_PER_COMPLAINT - newCount;
        return {
          success: true,
          response: `✅ Foto ke-${newCount} sudah kami terima.${remaining > 0 ? ` Anda masih bisa mengirim ${remaining} foto lagi.` : ' Batas foto sudah tercapai.'} Silakan lanjutkan menjawab pertanyaan sebelumnya ya Pak/Bu.`,
          intent: 'CREATE_COMPLAINT',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }

      // Photo-only message outside any active flow — store and acknowledge
      addPendingPhoto(userId, mediaUrl);
      const userName = knownName || getProfile(userId).nama_lengkap;
      const nameGreeting = userName ? ` ${userName}` : '';
      tracker.complete();
      return {
        success: true,
        response: `Terima kasih Pak/Bu${nameGreeting}, foto sudah kami terima. ` +
          `Jika ingin melaporkan pengaduan, silakan jelaskan masalahnya dan foto akan kami lampirkan otomatis.\n\n` +
          `Contoh: "Jalan rusak di depan kantor kelurahan"`,
        intent: 'QUESTION',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
      };
    }

    // Step 2.1: Check pending cancel confirmation
    const pendingCancel = pendingCancelConfirmation.get(userId);
    if (pendingCancel) {
      // Use micro LLM for confirmation classification (full NLU, no regex fallback)
      let cancelDecision: string;
      try {
        const cancelResult = await withMicroNluBudget(
          () => classifyConfirmation(message.trim(), { village_id: resolvedVillageId, wa_user_id: userId, session_id: userId, channel }),
          null
        );
        cancelDecision = cancelResult?.decision === 'CONFIRM' ? 'yes' : cancelResult?.decision === 'REJECT' ? 'no' : 'uncertain';
      } catch {
        cancelDecision = 'uncertain';
      }

      if (cancelDecision === 'yes') {
        clearPendingCancelConfirmation(userId);
        if (pendingCancel.type === 'laporan') {
          const result = await cancelComplaint(pendingCancel.id, buildChannelParams(channel, userId), pendingCancel.reason);
          return {
            success: true,
            response: result.success
              ? buildCancelSuccessResponse('laporan', pendingCancel.id, result.message)
              : buildCancelErrorResponse('laporan', pendingCancel.id, result.error, result.message),
            intent: 'CANCEL_COMPLAINT',
            metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
          };
        }

        const serviceResult = await cancelServiceRequest(pendingCancel.id, buildChannelParams(channel, userId), pendingCancel.reason);
        return {
          success: true,
          response: serviceResult.success
            ? buildCancelSuccessResponse('layanan', pendingCancel.id, serviceResult.message)
            : buildCancelErrorResponse('layanan', pendingCancel.id, serviceResult.error, serviceResult.message),
          intent: 'CANCEL_SERVICE_REQUEST',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }

      if (cancelDecision === 'no') {
        clearPendingCancelConfirmation(userId);
        return {
          success: true,
          response: 'Baik Pak/Bu, laporan/layanan Anda tidak jadi dibatalkan. Ada yang bisa kami bantu lagi?',
          intent: 'QUESTION',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
        };
      }

      // uncertain — ask again
      return {
        success: true,
        response: 'Mohon konfirmasi ya Pak/Bu. Balas "YA" untuk melanjutkan pembatalan, atau "TIDAK" untuk membatalkan.',
        intent: pendingCancel.type === 'laporan' ? 'CANCEL_COMPLAINT' : 'CANCEL_SERVICE_REQUEST',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
      };
    }

    // Step 2.5: AI Optimization - Pre-process message
    // Step 2.45: Direct LAP/LAY code detection — bypass LLM for direct status check
    const lapMatch = message.match(/\b(LAP-\d{8}-\d{3})\b/i);
    const layMatch = message.match(/\b(LAY-\d{8}-\d{3})\b/i);
    if (lapMatch || layMatch) {
      const code = (lapMatch?.[1] || layMatch?.[1])!.toUpperCase();
      const isLap = code.startsWith('LAP-');
      const directCheckLlm = {
        intent: 'CHECK_STATUS',
        fields: isLap ? { complaint_id: code } : { request_number: code },
        reply_text: '',
      };
      logger.info('[UnifiedProcessor] Direct LAP/LAY code detected, bypassing LLM', { userId, code });
      tracker.preparing();
      const statusReply = await handleStatusCheck(userId, channel, directCheckLlm, message);
      tracker.complete();
      if (channel === 'whatsapp') {
        appendToHistoryCache(userId, 'assistant', statusReply);
      }
      return {
        success: true,
        response: statusReply,
        intent: 'CHECK_STATUS',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false, traceId },
      };
    }

    const historyString = resolvedHistory?.map(m => `${m.role}: ${m.content}`).join('\n') || '';
    let templateContext: { villageName?: string | null; villageShortName?: string | null } | undefined;

    if (await checkGreeting()) {
      const profile = await getVillageProfileSummary(resolvedVillageId);
      if (profile?.name) {
        templateContext = {
          villageName: profile.name,
          villageShortName: profile.short_name || null,
        };
      }
    }

    const optimization = preProcessMessage(message, userId, historyString, templateContext);
    
    // Step 3: Sanitize and correct typos
    let sanitizedMessage = sanitizeUserInput(message);
    sanitizedMessage = normalizeText(sanitizedMessage);
    
    // Step 4: Language detection
    const languageDetection = detectLanguage(sanitizedMessage);
    const languageContext = getLanguageContext(languageDetection);
    
    // Step 5: Sentiment analysis
    const sentiment = analyzeSentiment(sanitizedMessage, userId);
    const sentimentContext = getSentimentContext(sentiment);
    
    // Step 5.5: User Profile & Context Enhancement
    // Learn from message (extract NIK, phone, detect style)
    if (!isEvaluation) {
      learnFromMessage(userId, message);
      recordInteraction(userId, sentiment.score, undefined);
    }
    
    // Get profile context for LLM
    const profileContext = getProfileContext(userId);
    
    // Get enhanced conversation context
    const conversationCtx = getEnhancedContext(userId);
    const conversationContextStr = getContextForLLM(userId);
    
    // Build adaptation context (sentiment + profile + conversation)
    const adaptationContext = buildAdaptationContext(userId, sentiment);
    
    // Check if user needs human escalation
    if (needsHumanEscalation(userId) || conversationCtx.needsHumanHelp) {
      logger.warn('🚨 User needs human escalation', { 
        userId, 
        sentiment: sentiment.level,
        clarificationCount: conversationCtx.clarificationCount,
        isStuck: conversationCtx.isStuck,
      });
    }
    
    // Step 5.8: Response cache check — skip expensive RAG + LLM for repeated questions
    // Only for stateless queries (FAQ, knowledge, greetings) — never for user-specific flows
    const fsmState = conversationCtx.fsmState;
    if (fsmState === 'IDLE' && isCacheable(sanitizedMessage)) {
      const cachedResp = getCachedResponse(sanitizedMessage);
      if (cachedResp) {
        const processingTimeMs = Date.now() - startTime;
        tracker.complete();
        if (channel === 'whatsapp') {
          appendToHistoryCache(userId, 'assistant', cachedResp.response);
        }
        logger.info('⚡ [UnifiedProcessor] Response served from cache', {
          userId, channel, intent: cachedResp.intent, processingTimeMs,
        });
        return {
          success: true,
          response: cachedResp.response,
          guidanceText: cachedResp.guidanceText,
          intent: cachedResp.intent,
          metadata: {
            processingTimeMs,
            hasKnowledge: cachedResp.intent === 'KNOWLEDGE_QUERY',
          },
        };
      }
    }
    
    // Step 6: Pre-fetch RAG context if needed
    // Uses unified NLU classifier result for intelligent RAG skip/fetch decision
    // This avoids a separate shouldRetrieveContext() call that would invoke classifyRAGIntent again
    tracker.searching();
    
    let preloadedRAGContext: RAGContext | string | undefined;
    let graphContext = '';
    const isGreeting = await checkGreeting();
    const unified = await getUnifiedClassification();
    const looksLikeQuestion = unified?.rag_needed ?? await shouldRetrieveContext(sanitizedMessage);
    const nluCategories = unified?.categories || [];
    const prefetchVillageId = resolvedVillageId;
    
    if (isGreeting) {
      try {
        const kelurahanInfo = await getKelurahanInfoContext(prefetchVillageId);
        if (kelurahanInfo) preloadedRAGContext = kelurahanInfo;
      } catch (error: any) {
        logger.warn('[UnifiedProcessor] Failed to fetch kelurahan info', { error: error.message });
      }
    } else if (looksLikeQuestion) {
      try {
        // Pass NLU-inferred categories to RAG for more targeted search
        const ragContext = await getRAGContext(sanitizedMessage, nluCategories.length > 0 ? nluCategories : undefined, prefetchVillageId);
        if (ragContext.totalResults > 0) preloadedRAGContext = ragContext;
      } catch (error: any) {
        logger.warn('[UnifiedProcessor] RAG fetch failed', { error: error.message });
      }
    }
    
    // Step 6.5: Get knowledge graph context for service-related queries
    // Dynamically uses DB-backed knowledge graph (no hardcoded service codes/keywords)
    try {
      
      // Build dynamic service code regex from DB-backed knowledge graph
      const serviceCodes = getAllServiceCodes();
      if (serviceCodes.length > 0) {
        const codesPattern = new RegExp(`\\b(${serviceCodes.join('|')})\\b`, 'i');
        const serviceCodeMatch = sanitizedMessage.match(codesPattern);
        if (serviceCodeMatch) {
          graphContext = await getGraphContextAsync(serviceCodeMatch[1].toUpperCase());
        }
      }
      
      // If no direct code match, try keyword matching from DB-backed nodes
      if (!graphContext) {
        const serviceKeywords = getAllServiceKeywords();
        const lowerMsg = sanitizedMessage.toLowerCase();
        for (const { keyword } of serviceKeywords) {
          if (lowerMsg.includes(keyword)) {
            const node = await findNodeByKeywordAsync(keyword);
            if (node) {
              graphContext = await getGraphContextAsync(node.code);
              break;
            }
          }
        }
      }
    } catch (error: any) {
      logger.warn('[UnifiedProcessor] Knowledge graph lookup failed', { error: error.message });
    }

    // Step 7: Build context
    // Determine prompt focus based on conversation state to reduce token usage
    // Priority: FSM state > previous intent > NLU message_type > emergency > graph > 'full'
    //
    // ADAPTIVE PROMPT SAVINGS (vs full ~5000 tokens):
    //   complaint → ~1400 tokens (core + complaint rules/intents/cases + edge)
    //   service   → ~1800 tokens (core + service rules/intents/cases + edge)
    //   knowledge → ~1600 tokens (core + knowledge rules + PART5 + edge)
    //   status    → ~1200 tokens (core + status rules/cases + edge)
    //   cancel    → ~2000 tokens (core + cancel + complaint/service)
    let promptFocus: PromptFocus = 'full';
    const currentIntent = conversationCtx.currentIntent;
    
    if (fsmState === 'COLLECTING_COMPLAINT_DATA' || fsmState === 'CONFIRMING_COMPLAINT' || fsmState === 'AWAITING_ADDRESS_DETAIL') {
      promptFocus = 'complaint';
    } else if (fsmState === 'COLLECTING_SERVICE_REQUEST_DATA' || fsmState === 'CONFIRMING_SERVICE_REQUEST') {
      promptFocus = 'service';
    } else if (fsmState === 'CANCELLATION_FLOW') {
      promptFocus = 'cancel';
    } else if (fsmState === 'CHECK_STATUS_FLOW') {
      promptFocus = 'status';
    } else if (currentIntent === 'KNOWLEDGE_QUERY') {
      promptFocus = 'knowledge';
    } else if (currentIntent === 'CREATE_COMPLAINT' || currentIntent === 'UPDATE_COMPLAINT') {
      promptFocus = 'complaint';
    } else if (currentIntent === 'SERVICE_INFO' || currentIntent === 'CREATE_SERVICE_REQUEST' || currentIntent === 'UPDATE_SERVICE_REQUEST') {
      promptFocus = 'service';
    } else if (unified?.message_type && unified.confidence >= 0.7) {
      // NLU→PromptFocus bridge: use micro NLU classification for first message / IDLE state
      // This saves ~3000-3500 tokens by loading only relevant rules, intents, and case examples
      switch (unified.message_type) {
        case 'COMPLAINT':
          promptFocus = 'complaint';
          break;
        case 'QUESTION':
          // Questions could be service or knowledge — use RAG categories to decide
          if (nluCategories.some(c => ['layanan', 'prosedur'].includes(c))) {
            promptFocus = 'service';
          } else if (nluCategories.length > 0) {
            promptFocus = 'knowledge';
          }
          // else remains 'full' — ambiguous question
          break;
        // GREETING, FAREWELL, DATA_INPUT, CONFIRMATION, SOCIAL → keep 'full'
      }
    }
    // else 'full' — IDLE state with no prior context or low NLU confidence

    // (Emergency hint removed — no pre-LLM keyword detection, LLM handles intent)

    // Knowledge graph → prompt focus override:
    // If knowledge graph matched a service code, ensure we use 'service' focus
    if (promptFocus === 'full' && graphContext) {
      promptFocus = 'service';
    }
    
    logger.debug('[UnifiedProcessor] Adaptive prompt focus', {
      userId, fsmState, currentIntent, promptFocus,
      nluMessageType: unified?.message_type, nluConfidence: unified?.confidence,
    });

    let systemPrompt: string;
    let messageCount: number;
    
    if (channel === 'webchat' && resolvedHistory) {
      const contextResult = await buildContextWithHistory(userId, sanitizedMessage, resolvedHistory, preloadedRAGContext, resolvedVillageId, promptFocus);
      systemPrompt = contextResult.systemPrompt;
      messageCount = contextResult.messageCount;
    } else {
      // Build complaint categories text for WhatsApp channel too
      const complaintCategoriesText = await buildComplaintCategoriesText(resolvedVillageId);
      const villageName = templateContext?.villageName || (await getVillageProfileSummary(resolvedVillageId))?.name || undefined;
      const contextResult = await buildContext(userId, sanitizedMessage, preloadedRAGContext, complaintCategoriesText, promptFocus, villageName);
      systemPrompt = contextResult.systemPrompt;
      messageCount = contextResult.messageCount;
    }
    
    // Inject language, sentiment, profile, conversation, graph context
    const allContexts = [
      languageContext,
      sentimentContext,
      profileContext,
      conversationContextStr,
      adaptationContext,
      graphContext,
    ].filter(Boolean).join('\n');
    
    if (allContexts) {
      systemPrompt = systemPrompt.replace(
        'PESAN TERAKHIR USER:',
        `${allContexts}\n\nPESAN TERAKHIR USER:`
      );
    }
    
    // Step 8: Call LLM
    // Update status: thinking
    tracker.thinking();
    const llmResult = await callGemini(systemPrompt);
    
    if (!llmResult) {
      throw new Error('LLM call failed - all models exhausted');
    }
    
    const { response: llmResponse, metrics } = llmResult;

    // Record actual token usage for main chat call
    recordTokenUsage({
      model: metrics.model,
      input_tokens: metrics.inputTokens,
      output_tokens: metrics.outputTokens,
      total_tokens: metrics.totalTokens,
      layer_type: 'full_nlu',
      call_type: 'main_chat',
      village_id: input.villageId,
      wa_user_id: userId,
      session_id: userId,
      channel,
      intent: llmResponse.intent,
      success: true,
      duration_ms: metrics.durationMs,
      key_source: metrics.keySource,
      key_id: metrics.keyId,
      key_tier: metrics.keyTier,
    });

    // Anti-hallucination gate — multi-layer approach:
    // 1. Regex detection (fast, free) to identify potential hallucination signals
    // 2. Micro-LLM validation (cheap, ~10x less tokens than full retry) to confirm
    // 3. Full LLM retry only for confirmed fake links (always hallucination)
    const hasKnowledge = hasKnowledgeInPrompt(systemPrompt);
    // Extract knowledge text early for cross-referencing in anti-hallucination
    const knowledgeMatch = systemPrompt.match(/KNOWLEDGE BASE YANG TERSEDIA:\n([\s\S]*?)(?:\n\[CONFIDENCE:|$)/);
    const knowledgeText = knowledgeMatch?.[1] || '';
    const gate = needsAntiHallucinationRetry({
      replyText: llmResponse.reply_text,
      guidanceText: llmResponse.guidance_text,
      hasKnowledge,
      knowledgeText,
    });

    if (gate.shouldRetry) {
      logAntiHallucinationEvent({
        userId,
        channel,
        reason: gate.reason,
        model: metrics.model,
      });

      // For fake links → always sanitize (no LLM needed, regex is sufficient)
      if (gate.reason?.includes('link palsu')) {
        if (llmResult.response.reply_text) {
          llmResult.response.reply_text = sanitizeFakeLinks(llmResult.response.reply_text);
        }
        if (llmResult.response.guidance_text) {
          llmResult.response.guidance_text = sanitizeFakeLinks(llmResult.response.guidance_text);
        }
      } else if (hasKnowledge) {
        // Has knowledge → use micro-LLM to validate against knowledge (cheap check)
        const responseText = [llmResult.response.reply_text, llmResult.response.guidance_text].filter(Boolean).join(' ');
        
        if (knowledgeText) {
          const validation = await validateResponseAgainstKnowledge(responseText, knowledgeText, {
            village_id: input.villageId,
            wa_user_id: userId,
            session_id: userId,
            channel,
          });
          
          if (validation?.has_hallucination) {
            logger.warn('[UnifiedProcessor] Micro-LLM confirmed hallucination', {
              userId, issues: validation.issues,
            });
            // Only do full retry if micro-LLM confirms hallucination
            const retryPrompt = appendAntiHallucinationInstruction(systemPrompt);
            const retryResult = await callGemini(retryPrompt);
            if (retryResult?.response?.reply_text) {
              recordTokenUsage({
                model: retryResult.metrics.model,
                input_tokens: retryResult.metrics.inputTokens,
                output_tokens: retryResult.metrics.outputTokens,
                total_tokens: retryResult.metrics.totalTokens,
                layer_type: 'full_nlu',
                call_type: 'anti_hallucination_retry',
                village_id: input.villageId,
                wa_user_id: userId,
                session_id: userId,
                channel,
                intent: retryResult.response.intent,
                success: true,
                duration_ms: retryResult.metrics.durationMs,
                key_source: retryResult.metrics.keySource,
                key_id: retryResult.metrics.keyId,
                key_tier: retryResult.metrics.keyTier,
              });
              llmResult.response = retryResult.response;
            }
          }
          // else: micro-LLM says no hallucination → skip expensive full retry (saves ~5000 tokens)
        }
      } else {
        // No knowledge context + hallucination signals → full retry with anti-hallucination instruction
        const retryPrompt = appendAntiHallucinationInstruction(systemPrompt);
        const retryResult = await callGemini(retryPrompt);
        if (retryResult?.response?.reply_text) {
          recordTokenUsage({
            model: retryResult.metrics.model,
            input_tokens: retryResult.metrics.inputTokens,
            output_tokens: retryResult.metrics.outputTokens,
            total_tokens: retryResult.metrics.totalTokens,
            layer_type: 'full_nlu',
            call_type: 'anti_hallucination_retry',
            village_id: input.villageId,
            wa_user_id: userId,
            session_id: userId,
            channel,
            intent: retryResult.response.intent,
            success: true,
            duration_ms: retryResult.metrics.durationMs,
            key_source: retryResult.metrics.keySource,
            key_id: retryResult.metrics.keyId,
            key_tier: retryResult.metrics.keyTier,
          });
          llmResult.response = retryResult.response;
        }
      }
    }

    // ── Post-processing sanitization pipeline ──
    // Runs on EVERY final response to catch hallucinations that slipped through.
    if (llmResult.response.reply_text) {
      llmResult.response.reply_text = sanitizeFakeLinks(llmResult.response.reply_text);
    }
    if (llmResult.response.guidance_text) {
      llmResult.response.guidance_text = sanitizeFakeLinks(llmResult.response.guidance_text);
    }
    // Remove fabricated phone numbers when no knowledge context is present
    if (!hasKnowledge) {
      const FAKE_PHONE_PATTERN = /\b0\d{2,3}[-.\s]?\d{4,8}\b/g;
      if (llmResult.response.reply_text && FAKE_PHONE_PATTERN.test(llmResult.response.reply_text)) {
        llmResult.response.reply_text = llmResult.response.reply_text.replace(FAKE_PHONE_PATTERN, '[nomor telepon tersedia di kantor]');
        logger.warn('[UnifiedProcessor] Sanitized fabricated phone number from reply');
      }
    }
    
    // Track analytics (skip during evaluation)
    if (!isEvaluation) {
      aiAnalyticsService.recordIntent(
        userId,
        llmResult.response.intent,
        metrics.durationMs,
        systemPrompt.length,
        llmResult.response.reply_text.length,
        metrics.model
      );
    }
    
    logger.info('[UnifiedProcessor] LLM response received', {
      userId,
      channel,
      intent: llmResult.response.intent,
      durationMs: metrics.durationMs,
    });
    
    // Update status: preparing response
    tracker.preparing();
    
    // Step 9: Handle intent
    const effectiveLlmResponse = llmResult.response;

    // If webhook already resolved tenant, enforce it deterministically.
    if (input.villageId) {
      effectiveLlmResponse.fields = {
        ...(effectiveLlmResponse.fields || {}),
        village_id: input.villageId,
      } as any;
    }

    effectiveLlmResponse.fields = {
      ...(effectiveLlmResponse.fields || {}),
      _original_message: message,
    } as any;

    let finalReplyText = effectiveLlmResponse.reply_text;
    let guidanceText = effectiveLlmResponse.guidance_text || '';

    // Emergency auto-category removed — LLM handles intent and category classification.
    // is_urgent flag comes from DB complaintTypeConfig after LLM determines kategori.

    // ── Confidence-based intent validation ──
    // If LLM reports low confidence (<0.4), fall back to QUESTION to ask for clarification
    // rather than risk processing a wrong intent (e.g., creating a complaint for a question).
    const llmConfidence = typeof effectiveLlmResponse.confidence === 'number' ? effectiveLlmResponse.confidence : 0.8;
    if (llmConfidence < 0.4 && effectiveLlmResponse.intent !== 'QUESTION' && effectiveLlmResponse.intent !== 'UNKNOWN') {
      logger.info('[UnifiedProcessor] Low LLM confidence, demoting to QUESTION', {
        userId, originalIntent: effectiveLlmResponse.intent, confidence: llmConfidence,
      });
      // Keep the reply_text (LLM already generated a clarification) but override intent
      effectiveLlmResponse.intent = 'QUESTION' as any;
    }

    // Service slug resolution: when LLM detected SERVICE_INFO/CREATE_SERVICE_REQUEST
    // but didn't extract the specific service_slug, try to resolve it from the message
    // using micro-LLM semantic search (NOT pattern matching)
    if (['SERVICE_INFO', 'CREATE_SERVICE_REQUEST'].includes(effectiveLlmResponse.intent)) {
      const hasServiceRef = !!(effectiveLlmResponse.fields?.service_slug || effectiveLlmResponse.fields?.service_id);
      if (!hasServiceRef) {
        const resolved = await resolveServiceSlugFromSearch(message, resolvedVillageId);
        if (resolved?.slug) {
          const existingServiceName = (effectiveLlmResponse.fields as any)?.service_name;
          effectiveLlmResponse.fields = {
            ...(effectiveLlmResponse.fields || {}),
            service_slug: resolved.slug,
            service_name: resolved.name || existingServiceName,
          } as any;
        }
      }
    }
    
    switch (effectiveLlmResponse.intent) {
      case 'CREATE_COMPLAINT':
        const rateLimitCheck = rateLimiterService.checkRateLimit(userId);
        if (!rateLimitCheck.allowed) {
          finalReplyText = rateLimitCheck.message || 'Anda telah mencapai batas laporan hari ini.';
        } else {
          finalReplyText = await handleComplaintCreation(userId, channel, effectiveLlmResponse, message, mediaUrl);
        }
        break;
      
      case 'SERVICE_INFO':
        {
          const serviceInfoResult = normalizeHandlerResult(await handleServiceInfo(userId, effectiveLlmResponse, channel));
          finalReplyText = serviceInfoResult.replyText;
          if (serviceInfoResult.guidanceText && !guidanceText) {
            guidanceText = serviceInfoResult.guidanceText;
          }
        }
        break;
      
      case 'CREATE_SERVICE_REQUEST':
        finalReplyText = await handleServiceRequestCreation(userId, channel, effectiveLlmResponse);
        break;

      case 'UPDATE_COMPLAINT':
        finalReplyText = await handleComplaintUpdate(userId, channel, effectiveLlmResponse, message);
        break;

      case 'UPDATE_SERVICE_REQUEST':
        finalReplyText = await handleServiceRequestEditLink(userId, channel, effectiveLlmResponse);
        break;
      
      case 'CHECK_STATUS':
        finalReplyText = await handleStatusCheck(userId, channel, effectiveLlmResponse, message);
        break;
      
      case 'CANCEL_COMPLAINT':
        finalReplyText = await handleCancellationRequest(userId, 'laporan', effectiveLlmResponse);
        break;

      case 'CANCEL_SERVICE_REQUEST':
        finalReplyText = await handleCancellationRequest(userId, 'layanan', effectiveLlmResponse);
        break;
      
      case 'HISTORY':
        finalReplyText = await handleHistory(userId, channel);
        break;
      
      case 'KNOWLEDGE_QUERY':
        if (preloadedRAGContext && typeof preloadedRAGContext === 'object' && preloadedRAGContext.contextString) {
          effectiveLlmResponse.fields = {
            ...(effectiveLlmResponse.fields || {}),
            _preloaded_knowledge_context: preloadedRAGContext.contextString,
          } as any;
        }
        finalReplyText = await handleKnowledgeQuery(userId, message, effectiveLlmResponse, finalReplyText, channel);
        break;
      
      case 'QUESTION':
        // If LLM explicitly says needs_knowledge=true, or if RAG context was preloaded,
        // route through knowledge handler for a more informed answer
        if (effectiveLlmResponse.needs_knowledge && preloadedRAGContext && typeof preloadedRAGContext === 'object' && preloadedRAGContext.contextString) {
          effectiveLlmResponse.fields = {
            ...(effectiveLlmResponse.fields || {}),
            _preloaded_knowledge_context: preloadedRAGContext.contextString,
          } as any;
          finalReplyText = await handleKnowledgeQuery(userId, message, effectiveLlmResponse, finalReplyText, channel);
        }
        // else: use LLM reply as-is (greeting, chitchat, etc.)
        break;

      case 'UNKNOWN':
      default:
        // GREETING and other intents - use LLM reply as-is
        break;
    }
    
    // Step 9.5: Track knowledge hit/miss for analytics
    // Records whether the knowledge base had relevant content for this query
    if (!isEvaluation) {
      const knowledgeIntent = effectiveLlmResponse.intent;
      const isKnowledgeSeeking = ['KNOWLEDGE_QUERY', 'QUESTION', 'SERVICE_INFO'].includes(knowledgeIntent);
      if (isKnowledgeSeeking || effectiveLlmResponse.needs_knowledge) {
        const ragConf = typeof preloadedRAGContext === 'object' ? preloadedRAGContext.confidence?.level : undefined;
        const confLevel = (ragConf as any) || 'none';
        aiAnalyticsService.recordKnowledge({
          query: message.substring(0, 200),
          intent: knowledgeIntent,
          confidence: confLevel,
          channel,
          villageId: resolvedVillageId,
          hasKnowledge: !!(preloadedRAGContext && typeof preloadedRAGContext === 'object' && preloadedRAGContext.contextString),
        });

        // Persist knowledge gaps to Dashboard DB (fire-and-forget) for admin visibility
        if (confLevel === 'none' || confLevel === 'low') {
          reportKnowledgeGap({
            query: message.substring(0, 500),
            intent: knowledgeIntent,
            confidence: confLevel,
            channel,
            villageId: resolvedVillageId,
          });
        }
      }
    }

    // Step 10: Validate response
    const validatedReply = validateResponse(finalReplyText);
    const validatedGuidance = guidanceText ? validateResponse(guidanceText) : undefined;
    
    // Step 10.5: Adapt response based on sentiment, profile, and context
    const adaptedResult = adaptResponse(validatedReply, userId, sentiment, validatedGuidance);
    const finalResponse = adaptedResult.response;
    const finalGuidance = adaptedResult.guidanceText;
    
    // Step 10.6: Update conversation context
    updateContext(userId, {
      currentIntent: effectiveLlmResponse.intent,
      intentConfidence: 0.8, // Default confidence since Micro NLU handles intent now
      collectedData: effectiveLlmResponse.fields,
      missingFields: effectiveLlmResponse.fields?.missing_info || [],
    });
    
    const processingTimeMs = Date.now() - startTime;
    
    // Update status: complete
    tracker.complete();
    
    // Append AI response to conversation history cache (keeps cache fresh for next message)
    if (channel === 'whatsapp') {
      appendToHistoryCache(userId, 'assistant', finalResponse);
    }
    
    logger.info('✅ [UnifiedProcessor] Message processed', {
      userId,
      channel,
      intent: effectiveLlmResponse.intent,
      processingTimeMs,
    });
    
    // Save cacheable responses for future use (FAQ, knowledge, greetings) — skip during eval
    if (!isEvaluation) {
      setCachedResponse(message, finalResponse, effectiveLlmResponse.intent, finalGuidance);
    }
    
    return {
      success: true,
      response: finalResponse,
      guidanceText: finalGuidance,
      intent: llmResponse.intent,
      fields: llmResponse.fields,
      metadata: {
        processingTimeMs,
        model: metrics.model,
        hasKnowledge: !!preloadedRAGContext,
        knowledgeConfidence: typeof preloadedRAGContext === 'object' ? preloadedRAGContext.confidence?.level : undefined,
        sentiment: sentiment.level !== 'neutral' ? sentiment.level : undefined,
        language: languageDetection.primary !== 'indonesian' ? languageDetection.primary : undefined,
        traceId,
      },
    };
    
  } catch (error: any) {
    const processingTimeMs = Date.now() - startTime;
    
    // Update status: error
    tracker.error(error.message);
    
    logger.error('❌ [UnifiedProcessor] Processing failed', {
      traceId,
      userId,
      channel,
      error: error.message,
      processingTimeMs,
    });
    
    // Use smart fallback based on context
    
    // Determine error type for better fallback
    let errorType: string | undefined;
    if (error.message?.includes('timeout') || error.message?.includes('ETIMEDOUT')) {
      errorType = 'TIMEOUT';
    } else if (error.message?.includes('rate limit') || error.message?.includes('429')) {
      errorType = 'RATE_LIMIT';
    } else if (error.message?.includes('ECONNREFUSED') || error.message?.includes('503')) {
      errorType = 'SERVICE_DOWN';
    }
    
    // Get smart fallback - tries to continue conversation flow if possible
    const fallbackResponse = errorType 
      ? getErrorFallback(errorType)
      : getSmartFallback(userId, undefined, message);
    
    return {
      success: false,
      response: fallbackResponse,
      intent: 'ERROR',
      metadata: { processingTimeMs, hasKnowledge: false, traceId },
      error: error.message,
    };
  } finally {
    _activeProcessingCount--;
  }
}

/**
 * Handle pending address confirmation
 */
async function handlePendingAddressConfirmation(
  userId: string,
  message: string,
  pendingConfirm: { alamat: string; kategori: string; deskripsi: string; village_id?: string; timestamp: number; foto_url?: string },
  channel: 'whatsapp' | 'webchat',
  mediaUrl?: string
): Promise<string | null> {
  // Use micro LLM for confirmation classification (full NLU, no regex fallback)
  let addrDecision: string;
  try {
    const addrResult = await classifyConfirmation(message.trim(), { village_id: pendingConfirm.village_id, wa_user_id: userId, session_id: userId, channel });
    addrDecision = addrResult?.decision === 'CONFIRM' ? 'yes' : addrResult?.decision === 'REJECT' ? 'no' : 'uncertain';
  } catch {
    addrDecision = 'uncertain';
  }

  if (addrDecision === 'yes') {
    logger.info('User confirmed vague address, creating complaint', { userId, alamat: pendingConfirm.alamat });
    
    pendingAddressConfirmation.delete(userId);
    // If current message also has a photo, accumulate it
    if (mediaUrl) addPendingPhoto(userId, mediaUrl);
    const combinedFotoUrl = consumePendingPhotos(userId);
    
    // Resolve complaint type for category_id, type_id, is_urgent
    const complaintTypeConfig = await resolveComplaintTypeConfig(pendingConfirm.kategori, pendingConfirm.village_id);
    const isEmergency = typeof complaintTypeConfig?.is_urgent === 'boolean' ? complaintTypeConfig.is_urgent : false;
    const userProfile = getProfile(userId);
    
    const complaintId = await createComplaint({
      wa_user_id: channel === 'webchat' ? undefined : userId,
      channel: channel === 'webchat' ? 'WEBCHAT' : 'WHATSAPP',
      channel_identifier: userId,
      kategori: pendingConfirm.kategori,
      deskripsi: pendingConfirm.deskripsi,
      village_id: pendingConfirm.village_id,
      alamat: pendingConfirm.alamat,
      rt_rw: '',
      foto_url: combinedFotoUrl,
      category_id: complaintTypeConfig?.category_id,
      type_id: complaintTypeConfig?.id,
      is_urgent: isEmergency,
      reporter_name: userProfile.nama_lengkap,
      reporter_phone: channel === 'webchat' ? userProfile.no_hp : userId,
    });
    
    if (!complaintId) {
      throw new Error('Failed to create complaint after address confirmation');
    }
    
    // Post-creation analytics
    rateLimiterService.recordReport(userId);
    aiAnalyticsService.recordSuccess('CREATE_COMPLAINT');
    saveDefaultAddress(userId, pendingConfirm.alamat, '');
    recordServiceUsage(userId, pendingConfirm.kategori);
    recordCompletedAction(userId, 'CREATE_COMPLAINT', complaintId);
    
    const photoCount = combinedFotoUrl ? (combinedFotoUrl.startsWith('[') ? JSON.parse(combinedFotoUrl).length : 1) : 0;
    const withPhotoNote = photoCount > 0 ? `\n${photoCount > 1 ? photoCount + ' foto' : 'Foto'} pendukung sudah kami terima.` : '';
    return `Terima kasih.\nLaporan telah kami terima dengan nomor ${complaintId}.${withPhotoNote}`;
  }
  
  if (addrDecision === 'no') {
    logger.info('User rejected vague address, asking for specific address', { userId });
    pendingAddressConfirmation.delete(userId);
    return 'Baik Pak/Bu, silakan berikan alamat yang lebih spesifik (contoh: Jl. Merdeka No. 5 RT 02/RW 03), atau ketik "batal" jika ingin membatalkan laporan.';
  }

  // Check if user provides more specific address via NLU
  const addressCheck = await analyzeAddress(message, {
    village_id: pendingConfirm.village_id, wa_user_id: userId, session_id: userId, channel, kategori: pendingConfirm.kategori,
  });
  const looksLikeAddress = addressCheck && addressCheck.has_address && addressCheck.quality === 'specific';
  
  if (looksLikeAddress) {
    logger.info('User provided more specific address', { userId, newAlamat: message });
    
    pendingAddressConfirmation.delete(userId);
    // If current message also has a photo, accumulate it
    if (mediaUrl) addPendingPhoto(userId, mediaUrl);
    const combinedFotoUrl = consumePendingPhotos(userId);
    
    // Resolve complaint type for category_id, type_id, is_urgent
    const typeConfig = await resolveComplaintTypeConfig(pendingConfirm.kategori, pendingConfirm.village_id);
    const isUrgent = typeof typeConfig?.is_urgent === 'boolean' ? typeConfig.is_urgent : false;
    const profile = getProfile(userId);
    
    const complaintId = await createComplaint({
      wa_user_id: channel === 'webchat' ? undefined : userId,
      channel: channel === 'webchat' ? 'WEBCHAT' : 'WHATSAPP',
      channel_identifier: userId,
      kategori: pendingConfirm.kategori,
      deskripsi: pendingConfirm.deskripsi,
      village_id: pendingConfirm.village_id,
      alamat: message.trim(),
      rt_rw: '',
      foto_url: combinedFotoUrl,
      category_id: typeConfig?.category_id,
      type_id: typeConfig?.id,
      is_urgent: isUrgent,
      reporter_name: profile.nama_lengkap,
      reporter_phone: channel === 'webchat' ? profile.no_hp : userId,
    });
    
    if (!complaintId) {
      throw new Error('Failed to create complaint with updated address');
    }
    
    // Post-creation analytics
    rateLimiterService.recordReport(userId);
    aiAnalyticsService.recordSuccess('CREATE_COMPLAINT');
    saveDefaultAddress(userId, message.trim(), '');
    recordServiceUsage(userId, pendingConfirm.kategori);
    recordCompletedAction(userId, 'CREATE_COMPLAINT', complaintId);
    
    const photoCount2 = combinedFotoUrl ? (combinedFotoUrl.startsWith('[') ? JSON.parse(combinedFotoUrl).length : 1) : 0;
    const withPhotoNote = photoCount2 > 0 ? `\n${photoCount2 > 1 ? photoCount2 + ' foto' : 'Foto'} pendukung sudah kami terima.` : '';
    return `Terima kasih.\nLaporan telah kami terima dengan nomor ${complaintId}.${withPhotoNote}`;
  }
  
  // User said something else, clear pending and continue normal flow
  logger.info('User response not confirmation, clearing pending and processing normally', { userId });
  pendingAddressConfirmation.delete(userId);
  return null;
}

/**
 * Build context with provided conversation history (for webchat)
 */
async function buildContextWithHistory(
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
      knowledgeSection = `\n\nKNOWLEDGE BASE YANG TERSEDIA:\n${ragContext.contextString}${confidenceInstruction}`;
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

/**
 * Fallback responses when AI is unavailable
 * Uses centralized intent-patterns for emergency fallback detection (LLM-down only)
 */
function getFallbackResponse(message: string): string {
  // Import dynamically to avoid circular dependency
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getFallbackByIntent } = require('./fallback-response.service');
  const { detectIntentFromPatterns } = require('../constants/intent-patterns');
  
  const detected = detectIntentFromPatterns(message);
  if (detected) {
    return getFallbackByIntent(detected);
  }
  
  return getFallbackByIntent('UNKNOWN');
}

export default {
  processUnifiedMessage,
  handleComplaintCreation,
  handleComplaintUpdate,
  handleServiceInfo,
  handleServiceRequestCreation,
  handleStatusCheck,
  handleCancellationRequest,
  handleHistory,
  handleKnowledgeQuery,
  validateResponse,
  isVagueAddress,
  getPendingAddressConfirmation,
  clearPendingAddressConfirmation,
  setPendingAddressConfirmation,
};
