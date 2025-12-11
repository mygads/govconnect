/**
 * Query Cache Service
 * 
 * Caches common queries and their embeddings for faster retrieval.
 * Pre-warms cache with frequently asked questions.
 * 
 * Benefits:
 * - Zero latency for common queries
 * - Reduced embedding API costs
 * - Better user experience
 */

import crypto from 'crypto';
import logger from '../utils/logger';

// ==================== TYPES ====================

interface CachedQuery {
  query: string;
  normalizedQuery: string;
  embedding?: number[];
  response?: string;
  intent?: string;
  hitCount: number;
  lastHit: number;
  createdAt: number;
}

// ==================== CONFIGURATION ====================

const MAX_CACHE_SIZE = 1000;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MIN_HITS_FOR_PERSIST = 3; // Minimum hits to keep in cache

// ==================== STORAGE ====================

const queryCache = new Map<string, CachedQuery>();

// ==================== COMMON QUERIES ====================

// Pre-defined common queries to warm cache
const COMMON_QUERIES = [
  // Greetings
  'halo', 'hai', 'hi', 'hello', 'selamat pagi', 'selamat siang', 'selamat sore', 'selamat malam',
  'assalamualaikum', 'permisi',
  
  // Jam buka
  'jam buka', 'jam operasional', 'jam kerja', 'buka jam berapa', 'kapan buka', 'kapan tutup',
  'hari apa buka', 'hari libur',
  
  // Lokasi
  'dimana kantor', 'alamat kantor', 'lokasi kantor', 'kantor dimana',
  
  // Layanan
  'layanan apa saja', 'jenis layanan', 'bisa urus apa', 'surat apa saja',
  
  // Syarat
  'syarat skd', 'syarat sktm', 'syarat sku', 'syarat ktp', 'syarat kk',
  'dokumen apa saja', 'perlu bawa apa',
  
  // Biaya
  'biaya', 'tarif', 'harga', 'berapa biaya', 'gratis atau bayar',
  
  // Status
  'cek status', 'status laporan', 'status reservasi',
  
  // Laporan
  'mau lapor', 'lapor masalah', 'ada masalah', 'jalan rusak', 'lampu mati', 'sampah menumpuk',
  
  // Reservasi
  'mau reservasi', 'buat reservasi', 'daftar antrian', 'booking',
];

// ==================== CORE FUNCTIONS ====================

/**
 * Normalize query for cache lookup
 */
export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Generate cache key
 */
function getCacheKey(normalizedQuery: string): string {
  return crypto.createHash('md5').update(normalizedQuery).digest('hex');
}

/**
 * Get cached query
 */
export function getCachedQuery(query: string): CachedQuery | null {
  const normalized = normalizeQuery(query);
  const key = getCacheKey(normalized);
  
  const cached = queryCache.get(key);
  if (!cached) return null;
  
  // Check TTL
  if (Date.now() - cached.createdAt > CACHE_TTL_MS) {
    // Keep if frequently used
    if (cached.hitCount < MIN_HITS_FOR_PERSIST) {
      queryCache.delete(key);
      return null;
    }
  }
  
  // Update hit count
  cached.hitCount++;
  cached.lastHit = Date.now();
  
  return cached;
}

/**
 * Cache a query
 */
export function cacheQuery(
  query: string,
  data: {
    embedding?: number[];
    response?: string;
    intent?: string;
  }
): void {
  const normalized = normalizeQuery(query);
  const key = getCacheKey(normalized);
  
  // Check cache size
  if (queryCache.size >= MAX_CACHE_SIZE) {
    evictLeastUsed();
  }
  
  const existing = queryCache.get(key);
  
  queryCache.set(key, {
    query,
    normalizedQuery: normalized,
    embedding: data.embedding || existing?.embedding,
    response: data.response || existing?.response,
    intent: data.intent || existing?.intent,
    hitCount: existing ? existing.hitCount + 1 : 1,
    lastHit: Date.now(),
    createdAt: existing?.createdAt || Date.now(),
  });
}

/**
 * Check if query is similar to cached query
 */
export function findSimilarCachedQuery(query: string): CachedQuery | null {
  const normalized = normalizeQuery(query);
  
  // Exact match first
  const exactKey = getCacheKey(normalized);
  const exact = queryCache.get(exactKey);
  if (exact) {
    exact.hitCount++;
    exact.lastHit = Date.now();
    return exact;
  }
  
  // Fuzzy match - check if query contains common query
  for (const [, cached] of queryCache) {
    if (normalized.includes(cached.normalizedQuery) || 
        cached.normalizedQuery.includes(normalized)) {
      // Only return if similarity is high enough
      const similarity = calculateSimilarity(normalized, cached.normalizedQuery);
      if (similarity > 0.8) {
        cached.hitCount++;
        cached.lastHit = Date.now();
        return cached;
      }
    }
  }
  
  return null;
}

/**
 * Calculate simple word-based similarity
 */
function calculateSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.split(' '));
  const words2 = new Set(text2.split(' '));
  
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}

/**
 * Evict least used entries
 */
function evictLeastUsed(): void {
  const entries = Array.from(queryCache.entries());
  
  // Sort by hit count and last hit time
  entries.sort((a, b) => {
    const scoreA = a[1].hitCount * 0.7 + (a[1].lastHit / Date.now()) * 0.3;
    const scoreB = b[1].hitCount * 0.7 + (b[1].lastHit / Date.now()) * 0.3;
    return scoreA - scoreB;
  });
  
  // Remove bottom 10%
  const toRemove = Math.ceil(entries.length * 0.1);
  for (let i = 0; i < toRemove; i++) {
    queryCache.delete(entries[i][0]);
  }
  
  logger.debug('[QueryCache] Evicted entries', { count: toRemove });
}

/**
 * Warm cache with common queries
 */
export function warmCache(): void {
  for (const query of COMMON_QUERIES) {
    const normalized = normalizeQuery(query);
    const key = getCacheKey(normalized);
    
    if (!queryCache.has(key)) {
      queryCache.set(key, {
        query,
        normalizedQuery: normalized,
        hitCount: 0,
        lastHit: 0,
        createdAt: Date.now(),
      });
    }
  }
  
  logger.info('[QueryCache] Cache warmed', { entries: COMMON_QUERIES.length });
}

/**
 * Get cache statistics
 */
export function getCacheStats(): {
  size: number;
  maxSize: number;
  topQueries: Array<{ query: string; hits: number }>;
} {
  const entries = Array.from(queryCache.values());
  const topQueries = entries
    .sort((a, b) => b.hitCount - a.hitCount)
    .slice(0, 10)
    .map(e => ({ query: e.query, hits: e.hitCount }));
  
  return {
    size: queryCache.size,
    maxSize: MAX_CACHE_SIZE,
    topQueries,
  };
}

// ==================== INITIALIZATION ====================

// Warm cache on module load
warmCache();

// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [key, cached] of queryCache.entries()) {
    if (now - cached.createdAt > CACHE_TTL_MS && cached.hitCount < MIN_HITS_FOR_PERSIST) {
      queryCache.delete(key);
    }
  }
}, 15 * 60 * 1000); // Every 15 minutes

// ==================== EXPORTS ====================

export default {
  normalizeQuery,
  getCachedQuery,
  cacheQuery,
  findSimilarCachedQuery,
  warmCache,
  getCacheStats,
};
