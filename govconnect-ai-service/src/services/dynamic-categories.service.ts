/**
 * Dynamic Knowledge Category Service
 *
 * Fetches knowledge categories from Dashboard DB via internal API.
 * Categories are cached per village with a configurable TTL.
 *
 * This replaces ALL hardcoded category lists throughout the AI service:
 *   - UNIFIED_CLASSIFY_PROMPT categories
 *   - ai-chunking.service.ts VALID_CATEGORIES
 *   - document-category.service.ts VALID_CATEGORIES
 *   - rag.service.ts inferCategories() keyword map
 *
 * The Dashboard DB `knowledge_categories` table is the single source of truth.
 * Admin can add/remove categories per village, and the AI service adapts automatically.
 */

import axios from 'axios';
import logger from '../utils/logger';
import { config } from '../config/env';
import { LRUCache } from '../utils/lru-cache';

// ==================== Types ====================

export interface KnowledgeCategory {
  id: string;
  name: string;       // Human-readable: "Profil Desa", "FAQ", etc.
  slug: string;       // NLU-friendly: "profil_desa", "faq", etc.
  is_default: boolean;
}

interface CachedCategories {
  categories: KnowledgeCategory[];
  fetchedAt: number;
}

// ==================== Cache ====================

/** Cache TTL: 10 minutes (same as service catalog refresh) */
const CACHE_TTL_MS = 10 * 60 * 1000;

/** Per-village cache — bounded LRU to prevent memory leaks */
const categoryCache = new LRUCache<string, CachedCategories>({
  maxSize: 200,
  ttlMs: CACHE_TTL_MS,
  name: 'dynamicCategoryCache',
});

/**
 * Hardcoded fallback — used ONLY when Dashboard API is unreachable.
 * These match the default seed categories in the Dashboard DB.
 */
const FALLBACK_CATEGORIES: KnowledgeCategory[] = [
  { id: 'fb-1', name: 'Profil Desa', slug: 'profil_desa', is_default: true },
  { id: 'fb-2', name: 'FAQ', slug: 'faq', is_default: true },
  { id: 'fb-3', name: 'Struktur Desa', slug: 'struktur_desa', is_default: true },
  { id: 'fb-4', name: 'Data RT/RW', slug: 'data_rt-rw', is_default: true },
  { id: 'fb-5', name: 'Layanan Administrasi', slug: 'layanan_administrasi', is_default: true },
  { id: 'fb-6', name: 'Panduan/SOP', slug: 'panduan-sop', is_default: true },
  { id: 'fb-7', name: 'Custom', slug: 'custom', is_default: true },
];

/**
 * Fallback category slugs — exported for DRY reuse in ai-chunking and document-category.
 * Other services should call getCategorySlugs() for dynamic categories.
 */
export const FALLBACK_CATEGORY_SLUGS: readonly string[] = FALLBACK_CATEGORIES.map(c => c.slug);

// ==================== Fetch ====================

/**
 * Get knowledge categories for a village. Cached with TTL.
 * Falls back to hardcoded defaults if API is unreachable.
 */
export async function getKnowledgeCategories(villageId?: string): Promise<KnowledgeCategory[]> {
  const cacheKey = villageId || '__default__';

  // Check cache (LRU handles TTL-based expiry automatically)
  const cached = categoryCache.get(cacheKey);
  if (cached) {
    return cached.categories;
  }

  // Fetch from Dashboard
  if (!villageId) {
    logger.debug('[DynCategories] No village_id, using fallback categories');
    return FALLBACK_CATEGORIES;
  }

  try {
    const dashboardUrl = config.dashboardServiceUrl || 'http://dashboard:3000';
    const response = await axios.get(`${dashboardUrl}/api/internal/knowledge/categories`, {
      params: { village_id: villageId },
      headers: {
        'x-internal-api-key': config.internalApiKey,
      },
      timeout: 5000,
    });

    const data: KnowledgeCategory[] = response.data?.data || [];
    if (data.length === 0) {
      logger.warn('[DynCategories] No categories returned for village, using fallback', { villageId });
      categoryCache.set(cacheKey, { categories: FALLBACK_CATEGORIES, fetchedAt: Date.now() });
      return FALLBACK_CATEGORIES;
    }

    logger.info('[DynCategories] Fetched categories from Dashboard', {
      villageId,
      count: data.length,
      categories: data.map(c => c.slug).join(', '),
    });

    categoryCache.set(cacheKey, { categories: data, fetchedAt: Date.now() });
    return data;
  } catch (error: any) {
    logger.warn('[DynCategories] Failed to fetch categories, using fallback', {
      villageId,
      error: error.message,
    });

    // Try to re-read from cache (another concurrent request may have populated it)
    const stale = categoryCache.get(cacheKey);
    if (stale) return stale.categories;
    return FALLBACK_CATEGORIES;
  }
}

// ==================== Helpers ====================

/**
 * Get category slugs for LLM prompts.
 * Returns an array like: ["profil_desa", "faq", "struktur_desa", ...]
 */
export async function getCategorySlugs(villageId?: string): Promise<string[]> {
  const categories = await getKnowledgeCategories(villageId);
  return categories.map(c => c.slug);
}

/**
 * Get category names for LLM prompts (human-readable).
 * Returns an array like: ["Profil Desa", "FAQ", "Struktur Desa", ...]
 */
export async function getCategoryNames(villageId?: string): Promise<string[]> {
  const categories = await getKnowledgeCategories(villageId);
  return categories.map(c => c.name);
}

/**
 * Get categories formatted for LLM prompt injection.
 * Returns a string like: "profil_desa, faq, struktur_desa, layanan_administrasi, panduan-sop, custom"
 */
export async function getCategoryListForPrompt(villageId?: string): Promise<string> {
  const slugs = await getCategorySlugs(villageId);
  return slugs.map(s => `"${s}"`).join(', ');
}

/**
 * Get categories formatted as bullet list for chunking/inference prompts.
 * Returns a string like:
 *   - profil_desa
 *   - faq
 *   - struktur_desa
 */
export async function getCategoryBulletList(villageId?: string): Promise<string> {
  const slugs = await getCategorySlugs(villageId);
  return slugs.map(s => `- ${s}`).join('\n');
}

/**
 * Check if a category string matches any known category (exact match only).
 * Handles both slug and human-readable name matching.
 */
export async function isValidCategory(category: string, villageId?: string): Promise<boolean> {
  const categories = await getKnowledgeCategories(villageId);
  const lower = category.toLowerCase().trim();
  return categories.some(c =>
    c.slug === lower ||
    c.name.toLowerCase() === lower
  );
}

/**
 * Normalize a raw category string to its canonical slug.
 * Returns the slug if an exact match is found, or the original string if not.
 */
export async function normalizeCategoryToSlug(raw: string, villageId?: string): Promise<string> {
  const categories = await getKnowledgeCategories(villageId);
  const lower = raw.toLowerCase().trim();

  // Exact slug match
  const exactSlug = categories.find(c => c.slug === lower);
  if (exactSlug) return exactSlug.slug;

  // Exact name match
  const exactName = categories.find(c => c.name.toLowerCase() === lower);
  if (exactName) return exactName.slug;

  // No match — return as-is (category is display-only, LLM handles chunk categorization)
  return lower;
}

/**
 * Clear the category cache (useful for testing or forced refresh).
 */
export function clearCategoryCache(): void {
  categoryCache.clear();
  logger.info('[DynCategories] Category cache cleared');
}
