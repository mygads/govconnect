/**
 * Request deduplication utility
 * Prevents duplicate API calls for the same resource within a short time window
 */

interface CacheEntry<T> {
  promise: Promise<T>
  timestamp: number
}

class ApiCache {
  private cache = new Map<string, CacheEntry<any>>()
  private readonly DEFAULT_TTL_MS = 1000 // 1 second default

  /**
   * Deduplicate API calls by caching in-flight requests
   * If the same key is requested while a request is pending, return the existing promise
   * If a recent result exists (within TTL), return cached promise
   */
  async dedupe<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlMs: number = this.DEFAULT_TTL_MS
  ): Promise<T> {
    const now = Date.now()
    const cached = this.cache.get(key)

    // Return cached promise if still valid
    if (cached && now - cached.timestamp < ttlMs) {
      return cached.promise
    }

    // Create new request
    const promise = fetcher()
      .then((result) => {
        // Keep successful result in cache for TTL duration
        return result
      })
      .catch((error) => {
        // Remove failed requests immediately
        this.cache.delete(key)
        throw error
      })

    this.cache.set(key, { promise, timestamp: now })

    // Auto-cleanup after TTL
    setTimeout(() => {
      const entry = this.cache.get(key)
      if (entry && entry.timestamp === now) {
        this.cache.delete(key)
      }
    }, ttlMs)

    return promise
  }

  /**
   * Clear specific cache entry
   */
  invalidate(key: string): void {
    this.cache.delete(key)
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size
  }
}

// Singleton instance
export const apiCache = new ApiCache()

/**
 * Helper to create cache keys from request parameters
 */
export function createCacheKey(endpoint: string, params?: Record<string, any>): string {
  if (!params) return endpoint

  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${key}=${JSON.stringify(params[key])}`)
    .join('&')

  return `${endpoint}?${sortedParams}`
}

/**
 * Example usage:
 *
 * import { apiCache, createCacheKey } from '@/lib/api-cache'
 *
 * // Deduplicate API calls
 * const data = await apiCache.dedupe(
 *   createCacheKey('/api/laporan', { status: 'open', limit: 20 }),
 *   () => fetch('/api/laporan?status=open&limit=20').then(r => r.json()),
 *   2000 // 2 second TTL
 * )
 *
 * // Invalidate cache when data changes
 * apiCache.invalidate(createCacheKey('/api/laporan', { status: 'open' }))
 *
 * // Clear all cache
 * apiCache.clear()
 */
