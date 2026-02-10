/**
 * Response Cache Service
 * 
 * Caching untuk response AI yang sering ditanyakan.
 * Mengurangi latency dan cost untuk pertanyaan berulang.
 * 
 * Features:
 * - Query normalization untuk matching yang lebih baik
 * - TTL-based expiration
 * - Hit rate tracking untuk analytics
 * - LRU eviction untuk memory management
 */

import logger from '../utils/logger';

// ==================== TYPES ====================

interface CachedResponse {
  response: string;
  guidanceText?: string;
  intent: string;
  timestamp: number;
  hitCount: number;
  lastHit: number;
}

interface CacheStats {
  totalHits: number;
  totalMisses: number;
  hitRate: number;
  cacheSize: number;
  avgHitCount: number;
}

// ==================== CONFIGURATION ====================

const CACHE_CONFIG = {
  maxSize: 500,                    // Maximum cached responses
  defaultTTL: 30 * 60 * 1000,      // 30 minutes default TTL
  knowledgeTTL: 60 * 60 * 1000,    // 1 hour for knowledge queries
  greetingTTL: 24 * 60 * 60 * 1000, // 24 hours for greetings
  cleanupInterval: 5 * 60 * 1000,  // Cleanup every 5 minutes
};

// ==================== CACHE STORAGE ====================

const responseCache = new Map<string, CachedResponse>();
let totalHits = 0;
let totalMisses = 0;

// ==================== QUERY NORMALIZATION ====================

/**
 * Normalize query for cache key generation
 * Removes variations that don't change the meaning
 */
function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .trim()
    // Remove punctuation
    .replace(/[.,!?;:'"()[\]{}]/g, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    // Remove common filler words
    .replace(/\b(dong|deh|sih|nih|ya|yah|kak|pak|bu|mas|mbak)\b/g, '')
    // Normalize common variations
    .replace(/\bgimana\b/g, 'bagaimana')
    .replace(/\bgak\b/g, 'tidak')
    .replace(/\bga\b/g, 'tidak')
    .replace(/\bnggak\b/g, 'tidak')
    .replace(/\budah\b/g, 'sudah')
    .replace(/\baja\b/g, 'saja')
    .replace(/\bbikin\b/g, 'buat')
    // Sort words for order-independent matching
    .split(' ')
    .filter(w => w.length > 1)
    .sort()
    .join(' ')
    .trim();
}

/**
 * Generate cache key from normalized query.
 * Includes village_id so different villages never share cached answers.
 */
function generateCacheKey(query: string, intent?: string, villageId?: string): string {
  const normalized = normalizeQuery(query);
  const village = villageId || '_default';
  // Include intent and village in key for tenant-safe caching
  return intent ? `${village}:${intent}:${normalized}` : `${village}:${normalized}`;
}

// ==================== CACHEABLE PATTERNS ====================

/**
 * Patterns for queries that are safe to cache
 * These are typically FAQ-style questions with static answers
 */
const CACHEABLE_PATTERNS = [
  // Schedule/time questions
  /\b(jam|waktu)\s+(buka|tutup|operasional|kerja)\b/i,
  /\b(buka|tutup)\s+(jam\s+)?berapa\b/i,
  /\b(hari)\s+(libur|kerja)\b/i,
  
  // Location questions
  /\b(dimana|di\s+mana|lokasi|alamat)\s+(kantor|kelurahan)\b/i,
  
  // Requirement questions (generic)
  /\b(syarat|persyaratan)\s+(buat|bikin|urus)\s+(skd|sktm|sku|surat)\b/i,
  /\b(biaya|tarif)\s+(skd|sktm|sku|surat)\b/i,
  
  // Process questions (generic)
  /\b(cara|proses)\s+(buat|bikin|urus)\s+(skd|sktm|sku|surat)\b/i,
  /\b(berapa\s+lama)\s+(proses|buat|bikin)\b/i,
  
  // Contact questions
  /\b(nomor|no)\s+(telepon|telp|hp|wa|whatsapp)\b/i,
  /\b(kontak|hubungi)\s+(kelurahan|kantor)\b/i,
  
  // Greetings (very cacheable)
  /^(halo|hai|hi|hello|selamat\s+(pagi|siang|sore|malam))[\s!.,]*$/i,
];

/**
 * Patterns for queries that should NOT be cached
 * These involve user-specific data or dynamic content
 */
const NON_CACHEABLE_PATTERNS = [
  // Status checks (user-specific)
  /\b(cek|status)\s+(laporan|layanan|permohonan)\b/i,
  /\bLAP-\d+/i,
  /\bLAY-\d+/i,
  
  // User data (contains personal info)
  /\b\d{16}\b/,  // NIK
  /\b08\d{8,12}\b/,  // Phone
  
  // History (user-specific)
  /\b(riwayat|history)\s+(saya|ku)\b/i,
  
  // Complaints with specific locations
  /\b(lapor|ada\s+masalah).{20,}/i,
];

/**
 * Check if a query is cacheable
 */
export function isCacheable(query: string, intent?: string): boolean {
  // Check non-cacheable patterns first
  for (const pattern of NON_CACHEABLE_PATTERNS) {
    if (pattern.test(query)) {
      return false;
    }
  }
  
  // Check if matches cacheable patterns
  for (const pattern of CACHEABLE_PATTERNS) {
    if (pattern.test(query)) {
      return true;
    }
  }
  
  // Cache knowledge queries and greetings by intent
  if (intent === 'KNOWLEDGE_QUERY' || intent === 'GREETING') {
    return true;
  }
  
  return false;
}

// ==================== CACHE OPERATIONS ====================

/**
 * Get cached response for a query
 */
export function getCachedResponse(query: string, intent?: string, villageId?: string): CachedResponse | null {
  const key = generateCacheKey(query, intent, villageId);
  const cached = responseCache.get(key);
  
  if (!cached) {
    totalMisses++;
    return null;
  }
  
  // Check TTL
  const ttl = getTTLForIntent(cached.intent);
  if (Date.now() - cached.timestamp > ttl) {
    responseCache.delete(key);
    totalMisses++;
    logger.debug('[ResponseCache] Cache expired', { key: key.substring(0, 50) });
    return null;
  }
  
  // Update hit stats
  cached.hitCount++;
  cached.lastHit = Date.now();
  totalHits++;
  
  logger.info('[ResponseCache] Cache HIT', {
    key: key.substring(0, 50),
    intent: cached.intent,
    hitCount: cached.hitCount,
  });
  
  return cached;
}

/**
 * Store response in cache
 */
export function setCachedResponse(
  query: string,
  response: string,
  intent: string,
  guidanceText?: string,
  villageId?: string
): void {
  // Check if cacheable
  if (!isCacheable(query, intent)) {
    logger.debug('[ResponseCache] Query not cacheable', { 
      queryPreview: query.substring(0, 50),
      intent,
    });
    return;
  }
  
  const key = generateCacheKey(query, intent, villageId);
  
  // Check cache size and evict if needed
  if (responseCache.size >= CACHE_CONFIG.maxSize) {
    evictLRU();
  }
  
  responseCache.set(key, {
    response,
    guidanceText,
    intent,
    timestamp: Date.now(),
    hitCount: 0,
    lastHit: Date.now(),
  });
  
  logger.debug('[ResponseCache] Response cached', {
    key: key.substring(0, 50),
    intent,
    responseLength: response.length,
  });
}

/**
 * Get TTL based on intent type
 */
function getTTLForIntent(intent: string): number {
  switch (intent) {
    case 'GREETING':
    case 'THANKS':
      return CACHE_CONFIG.greetingTTL;
    case 'KNOWLEDGE_QUERY':
      return CACHE_CONFIG.knowledgeTTL;
    default:
      return CACHE_CONFIG.defaultTTL;
  }
}

/**
 * Evict least recently used entries
 */
function evictLRU(): void {
  // Find entries to evict (oldest lastHit)
  const entries = Array.from(responseCache.entries())
    .sort((a, b) => a[1].lastHit - b[1].lastHit);
  
  // Remove 10% of cache
  const toRemove = Math.ceil(CACHE_CONFIG.maxSize * 0.1);
  for (let i = 0; i < toRemove && i < entries.length; i++) {
    responseCache.delete(entries[i][0]);
  }
  
  logger.info('[ResponseCache] LRU eviction completed', {
    removed: toRemove,
    remaining: responseCache.size,
  });
}

/**
 * Cleanup expired entries
 */
function cleanupExpired(): void {
  const now = Date.now();
  let removed = 0;
  
  for (const [key, value] of responseCache.entries()) {
    const ttl = getTTLForIntent(value.intent);
    if (now - value.timestamp > ttl) {
      responseCache.delete(key);
      removed++;
    }
  }
  
  if (removed > 0) {
    logger.info('[ResponseCache] Cleanup completed', {
      removed,
      remaining: responseCache.size,
    });
  }
}

// Start cleanup interval
import { registerInterval } from '../utils/timer-registry';
registerInterval(cleanupExpired, CACHE_CONFIG.cleanupInterval, 'response-cache-cleanup');

// ==================== STATS & MONITORING ====================

/**
 * Get cache statistics
 */
export function getCacheStats(): CacheStats {
  const total = totalHits + totalMisses;
  const hitRate = total > 0 ? totalHits / total : 0;
  
  let totalHitCount = 0;
  for (const value of responseCache.values()) {
    totalHitCount += value.hitCount;
  }
  const avgHitCount = responseCache.size > 0 ? totalHitCount / responseCache.size : 0;
  
  return {
    totalHits,
    totalMisses,
    hitRate,
    cacheSize: responseCache.size,
    avgHitCount,
  };
}

/**
 * Clear all cache (for testing or manual reset)
 */
export function clearCache(): void {
  responseCache.clear();
  totalHits = 0;
  totalMisses = 0;
  logger.info('[ResponseCache] Cache cleared');
}

/**
 * Get top cached queries (for analytics)
 */
export function getTopCachedQueries(limit: number = 10): Array<{ key: string; hitCount: number; intent: string }> {
  return Array.from(responseCache.entries())
    .map(([key, value]) => ({
      key: key.substring(0, 100),
      hitCount: value.hitCount,
      intent: value.intent,
    }))
    .sort((a, b) => b.hitCount - a.hitCount)
    .slice(0, limit);
}

export default {
  getCachedResponse,
  setCachedResponse,
  isCacheable,
  getCacheStats,
  clearCache,
  getTopCachedQueries,
};
