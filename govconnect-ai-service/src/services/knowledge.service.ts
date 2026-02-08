import axios from 'axios';
import logger from '../utils/logger';
import { config } from '../config/env';
import {
  retrieveContext,
  inferCategories,
} from './rag.service';
import { RAGContext } from '../types/embedding.types';

interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  category: string;
  keywords: string[];
}

interface KnowledgeSearchResult {
  data: KnowledgeItem[];
  total: number;
  context: string;
}

interface VillageProfileSummary {
  id?: string;
  name?: string | null;
  short_name?: string | null;
  address?: string | null;
  gmaps_url?: string | null;
  operating_hours?: any | null;
}

// Feature flag for RAG-based search
const USE_RAG_SEARCH = process.env.USE_RAG_SEARCH !== 'false'; // Default: true

/**
 * Search knowledge base for relevant information
 * Uses RAG (semantic search) when enabled, falls back to keyword search
 */
export async function searchKnowledge(query: string, categories?: string[], villageId?: string): Promise<KnowledgeSearchResult> {
  try {
    logger.info('Searching knowledge base', {
      query: query.substring(0, 100),
      categories,
      villageId,
      useRAG: USE_RAG_SEARCH,
    });

    // Try RAG-based semantic search first
    if (USE_RAG_SEARCH) {
      try {
        const ragResult = await searchKnowledgeWithRAG(query, categories, villageId);
        if (ragResult.total > 0) {
          // If RAG returns results but misses key terms, augment with keyword search for higher precision.
          // This helps for glossary/command-style queries (e.g., 5W1H, embedding, "cek status").
          if (shouldAugmentRagWithKeywordSearch(query, ragResult.context)) {
            const keywordResult = await searchKnowledgeWithKeywords(query, undefined, villageId);
            if (keywordResult.total > 0) {
              return mergeKnowledgeResults(ragResult, keywordResult);
            }
          }

          return ragResult;
        }
        // If RAG returns no results, fall back to keyword search
        logger.debug('RAG search returned no results, falling back to keyword search');
      } catch (ragError: any) {
        logger.warn('RAG search failed, falling back to keyword search', {
          error: ragError.message,
        });
      }
    }

    // Keyword-based search (fallback or when RAG is disabled)
    return await searchKnowledgeWithKeywords(query, categories, villageId);
  } catch (error: any) {
    logger.error('Failed to search knowledge base', {
      error: error.message,
    });

    // Return empty result on error
    return {
      data: [],
      total: 0,
      context: '',
    };
  }
}

/**
 * Keyword-only knowledge search (bypasses RAG).
 * Useful for exact-term queries where the answer is explicitly present in KB (e.g., glossary/commands)
 * and we want deterministic extraction.
 */
export async function searchKnowledgeKeywordsOnly(query: string, categories?: string[], villageId?: string): Promise<KnowledgeSearchResult> {
  try {
    return await searchKnowledgeWithKeywords(query, categories, villageId);
  } catch (error: any) {
    logger.warn('Keyword-only knowledge search failed', {
      error: error?.message,
    });
    return { data: [], total: 0, context: '' };
  }
}

function shouldAugmentRagWithKeywordSearch(query: string, ragContext: string): boolean {
  const q = (query || '').toLowerCase();
  const ctx = (ragContext || '').toLowerCase();

  if (q.includes('5w1h') && !(ctx.includes('5w1h') || ctx.includes('what:') || ctx.includes('where:') || ctx.includes('when:'))) {
    return true;
  }

  if (q.includes('prioritas') && !(ctx.includes('tinggi') || ctx.includes('sedang') || ctx.includes('rendah'))) {
    return true;
  }

  if (q.includes('embedding') && !(ctx.includes('embedding') || ctx.includes('vektor') || ctx.includes('vector'))) {
    return true;
  }

  if (q.includes('cek status') && !ctx.includes('cek status')) {
    return true;
  }

  if (
    (q.includes('data') && (q.includes('digunakan') || q.includes('tujuan'))) &&
    !(ctx.includes('proses layanan') || ctx.includes('pengaduan') || ctx.includes('diakses'))
  ) {
    return true;
  }

  return false;
}

function mergeKnowledgeResults(a: KnowledgeSearchResult, b: KnowledgeSearchResult): KnowledgeSearchResult {
  const byId = new Map<string, KnowledgeItem>();
  for (const item of a.data || []) byId.set(item.id, item);
  for (const item of b.data || []) byId.set(item.id, item);

  const contextParts = [a.context, b.context].filter(Boolean);
  const mergedContext = contextParts.join('\n\n---\n\n');

  return {
    data: Array.from(byId.values()),
    total: byId.size,
    context: mergedContext,
  };
}

/**
 * Search knowledge base using RAG (semantic search with embeddings)
 * 
 * NOTE: minScore tuned to 0.55 for better recall with Indonesian language
 * Higher scores (0.65+) were too strict and missed relevant results
 */
async function searchKnowledgeWithRAG(query: string, categories?: string[], villageId?: string): Promise<KnowledgeSearchResult> {
  const inferredCategories = categories || inferCategories(query);

  // First attempt: use inferred categories (better precision when correct)
  let ragContext = await retrieveContext(query, {
    topK: 5,
    minScore: 0.55, // Lowered from 0.65 for better recall with Indonesian queries
    categories: inferredCategories.length > 0 ? inferredCategories : undefined,
    sourceTypes: ['knowledge', 'document'], // Search both knowledge and documents
    villageId,
  });

  // Fallback: if category inference is wrong, do a second attempt WITHOUT category filtering.
  // This improves recall for generic KB (e.g., glossary/5W1H) that may not match inferred categories.
  if (ragContext.totalResults === 0 && inferredCategories.length > 0) {
    logger.debug('RAG search fallback: retrying without category filter', {
      inferredCategories,
    });

    ragContext = await retrieveContext(query, {
      topK: 5,
      minScore: 0.55,
      categories: undefined,
      sourceTypes: ['knowledge', 'document'],
      villageId,
    });
  }

  if (ragContext.totalResults === 0) {
    return {
      data: [],
      total: 0,
      context: '',
    };
  }

  // Convert RAG results to KnowledgeItem format
  const items: KnowledgeItem[] = ragContext.relevantChunks.map(chunk => ({
    id: chunk.id,
    title: chunk.source,
    content: chunk.content,
    category: chunk.metadata?.category || 'general',
    keywords: chunk.metadata?.keywords || [],
  }));

  logger.info('RAG knowledge search completed', {
    resultsFound: ragContext.totalResults,
    topScore: ragContext.relevantChunks[0]?.score.toFixed(4),
    searchTimeMs: ragContext.searchTimeMs,
  });

  return {
    data: items,
    total: ragContext.totalResults,
    context: ragContext.contextString,
  };
}

/**
 * Search knowledge base using keyword-based API (fallback)
 */
async function searchKnowledgeWithKeywords(query: string, categories?: string[], villageId?: string): Promise<KnowledgeSearchResult> {
  const response = await axios.post<KnowledgeSearchResult>(
    `${config.dashboardServiceUrl}/api/internal/knowledge`,
    {
      query,
      categories,
      village_id: villageId,
      limit: 5,
    },
    {
      headers: {
        'x-internal-api-key': config.internalApiKey,
      },
      timeout: 5000,
    }
  );

  logger.info('Keyword knowledge search completed', {
    resultsFound: response.data.total,
  });

  return response.data;
}

/**
 * Get all active knowledge for building context
 */
export async function getAllKnowledge(villageId?: string): Promise<KnowledgeItem[]> {
  try {
    const response = await axios.get<{ data: KnowledgeItem[] }>(
      `${config.dashboardServiceUrl}/api/internal/knowledge`,
      {
        params: { limit: 50, village_id: villageId },
        headers: {
          'x-internal-api-key': config.internalApiKey,
        },
        timeout: 5000,
      }
    );

    return response.data.data;
  } catch (error: any) {
    logger.error('Failed to get all knowledge', {
      error: error.message,
    });

    return [];
  }
}

/**
 * Get RAG context directly for a query
 * Use this when you need the full RAG context object
 * 
 * NOTE: minScore tuned to 0.55 for better recall with Indonesian language
 */
export async function getRAGContext(query: string, categories?: string[], villageId?: string): Promise<RAGContext> {
  const inferredCategories = categories || inferCategories(query);
  
  return retrieveContext(query, {
    topK: 5,
    minScore: 0.55, // Lowered from 0.65 for better recall with Indonesian queries
    categories: inferredCategories.length > 0 ? inferredCategories : undefined,
    sourceTypes: ['knowledge', 'document'],
    villageId,
  });
}

/**
 * Get village profile summary directly from Dashboard DB
 * Use for greeting personalization (no embedding needed)
 * Cached for 15 minutes — village profile rarely changes.
 */

// In-memory cache for village profiles (M4 optimization)
const _villageProfileCache = new Map<string, { data: VillageProfileSummary | null; ts: number }>();
const VILLAGE_PROFILE_TTL = 15 * 60 * 1000; // 15 minutes

export async function getVillageProfileSummary(villageId?: string): Promise<VillageProfileSummary | null> {
  if (!villageId) return null;

  // Check cache
  const cached = _villageProfileCache.get(villageId);
  if (cached && Date.now() - cached.ts < VILLAGE_PROFILE_TTL) {
    return cached.data;
  }

  try {
    const response = await axios.get<{ data: VillageProfileSummary | null }>(
      `${config.dashboardServiceUrl}/api/internal/village-profile`,
      {
        params: { village_id: villageId },
        headers: {
          'x-internal-api-key': config.internalApiKey,
        },
        timeout: 5000,
      }
    );

    const profile = response.data.data || null;
    _villageProfileCache.set(villageId, { data: profile, ts: Date.now() });
    return profile;
  } catch (error: any) {
    logger.warn('Failed to get village profile summary', {
      error: error.message,
      villageId,
    });
    return null;
  }
}

/**
 * Clear the village profile cache (for admin cache management).
 */
export function clearVillageProfileCache(): number {
  const count = _villageProfileCache.size;
  _villageProfileCache.clear();
  return count;
}

/**
 * Get kelurahan information context for greetings
 * This fetches basic kelurahan info (nama, alamat) to personalize welcome message
 */
export async function getKelurahanInfoContext(villageId?: string): Promise<string> {
  try {
    logger.debug('Fetching kelurahan info for greeting');

    const profile = await getVillageProfileSummary(villageId);
    if (profile?.name) {
      const profileContext = [
        `Nama Desa/Kelurahan: ${profile.name || '-'}`,
        `Nama Singkat: ${profile.short_name || '-'}`,
        `Alamat: ${profile.address || '-'}`,
        `Google Maps: ${profile.gmaps_url || '-'}`,
        `Jam Operasional: ${profile.operating_hours ? JSON.stringify(profile.operating_hours) : '-'}`,
      ].join('\n');

      logger.info('Using village profile for greeting context', {
        villageId,
        name: profile.name,
      });

      return `PROFIL DESA (DATABASE)\n${profileContext}`;
    }
    
    // Try RAG-based search with specific query for kelurahan info
    const ragContext = await retrieveContext('informasi kelurahan nama alamat', {
      topK: 3,
      minScore: 0.5, // Lower threshold to get basic info
      categories: ['informasi_umum', 'kontak'],
      sourceTypes: ['knowledge'],
      villageId,
    });

    if (ragContext.totalResults > 0 && ragContext.contextString) {
      logger.info('Found kelurahan info from RAG', {
        resultsFound: ragContext.totalResults,
      });
      return ragContext.contextString;
    }

    // Fallback: try to get from knowledge API
    const response = await axios.get<{ data: KnowledgeItem[] }>(
      `${config.dashboardServiceUrl}/api/internal/knowledge`,
      {
        params: { 
          category: 'informasi_umum',
          limit: 5,
          village_id: villageId,
        },
        headers: {
          'x-internal-api-key': config.internalApiKey,
        },
        timeout: 5000,
      }
    );

    const items = response.data.data || [];
    if (items.length > 0) {
      const contextParts = items.map(item => 
        `[${item.category.toUpperCase()}] ${item.title}\n${item.content}`
      );
      logger.info('Found kelurahan info from knowledge API', {
        itemsFound: items.length,
      });
      return contextParts.join('\n\n');
    }

    logger.debug('No kelurahan info found');
    return '';
  } catch (error: any) {
    logger.warn('Failed to get kelurahan info', {
      error: error.message,
    });
    return '';
  }
}
