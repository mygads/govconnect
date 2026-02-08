/**
 * Simple LRU (Least Recently Used) Cache
 * 
 * A bounded Map-like cache that automatically evicts the least-recently-used
 * entries when the maximum size is reached. Prevents unbounded memory growth.
 * 
 * Features:
 * - O(1) get/set/delete via Map
 * - Automatic eviction when maxSize reached
 * - Optional TTL (time-to-live) per entry
 * - Built-in stats (hits, misses, evictions)
 * - clearAll() for admin cache management
 * 
 * Usage:
 *   const cache = new LRUCache<string, MyData>({ maxSize: 500, ttlMs: 10 * 60 * 1000 });
 *   cache.set('key', value);
 *   const val = cache.get('key'); // moves to most-recent
 */

export interface LRUCacheOptions {
  /** Maximum number of entries. When exceeded, least-recently-used is evicted. */
  maxSize: number;
  /** Optional TTL in milliseconds. Entries older than this are treated as expired. 0 = no TTL. */
  ttlMs?: number;
  /** Optional name for logging/stats */
  name?: string;
}

interface CacheEntry<V> {
  value: V;
  timestamp: number;
}

export interface LRUCacheStats {
  name: string;
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRate: string;
}

export class LRUCache<K, V> {
  private cache: Map<K, CacheEntry<V>>;
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private readonly name: string;

  // Stats
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(options: LRUCacheOptions) {
    this.maxSize = options.maxSize;
    this.ttlMs = options.ttlMs || 0;
    this.name = options.name || 'unnamed';
    this.cache = new Map();
  }

  /**
   * Get a value by key. Returns undefined if not found or expired.
   * Moves the entry to most-recent position.
   */
  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Check TTL
    if (this.ttlMs > 0 && Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }

    // Move to most-recent by re-inserting
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.hits++;
    return entry.value;
  }

  /**
   * Set a value. Evicts oldest entry if at capacity.
   */
  set(key: K, value: V): void {
    // Delete existing to update position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict LRU if at capacity
    while (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
        this.evictions++;
      } else {
        break;
      }
    }

    this.cache.set(key, { value, timestamp: Date.now() });
  }

  /**
   * Check if key exists (and is not expired).
   */
  has(key: K): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (this.ttlMs > 0 && Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Delete a specific key.
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get current size.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Iterate over entries (for cleanup loops, etc.)
   */
  entries(): IterableIterator<[K, CacheEntry<V>]> {
    return this.cache.entries();
  }

  /**
   * Get raw entry with timestamp (for TTL checks in cleanup loops)
   */
  getRaw(key: K): { value: V; timestamp: number } | undefined {
    return this.cache.get(key);
  }

  /**
   * Get cache statistics.
   */
  getStats(): LRUCacheStats {
    const total = this.hits + this.misses;
    return {
      name: this.name,
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRate: total > 0 ? `${((this.hits / total) * 100).toFixed(1)}%` : '0%',
    };
  }

  /**
   * Reset stats counters.
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  /**
   * Purge expired entries (useful for periodic cleanup).
   */
  purgeExpired(): number {
    if (this.ttlMs <= 0) return 0;
    let purged = 0;
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttlMs) {
        this.cache.delete(key);
        purged++;
      }
    }
    return purged;
  }
}
