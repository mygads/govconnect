import axios from 'axios';
import logger from '../utils/logger';
import { config } from '../config/env';
import {
  retrieveContext,
} from './rag.service';
import { RAGContext } from '../types/embedding.types';
import { classifyProfileQuery } from './micro-llm-matcher.service';

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

/**
 * Determine whether RAG results should be augmented with keyword search.
 * Uses a confidence-threshold approach instead of hardcoded keyword checks.
 *
 * If the RAG context is too short or sparse relative to the query, we supplement
 * with keyword search for better coverage — no fixed vocabulary needed.
 */
function shouldAugmentRagWithKeywordSearch(query: string, ragContext: string): boolean {
  const q = (query || '').trim();
  const ctx = (ragContext || '').trim();

  // If query is substantial but RAG returned very little context, augment
  if (q.length > 10 && ctx.length < 100) {
    return true;
  }

  // If query contains a technical term / abbreviation (2-6 uppercase chars) that
  // doesn't appear in the context, keyword search may find an exact match
  const techTerms = q.match(/\b[A-Z]{2,6}\b/g);
  if (techTerms && techTerms.some(t => !ctx.toUpperCase().includes(t))) {
    return true;
  }

  // If query asks for a specific numbered/coded item not found in context
  const codedRef = q.match(/\b\d{3,}\b/);
  if (codedRef && !ctx.includes(codedRef[0])) {
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
  // Let retrieveContext() handle category inference via its internal NLU (classifyQueryIntent).
  // Only pass explicit categories if the caller already knows them (e.g. from a prior NLU call).
  const effectiveCategories = categories && categories.length > 0 ? categories : undefined;

  // First attempt: use NLU-inferred categories (better precision when correct)
  let ragContext = await retrieveContext(query, {
    topK: 5,
    minScore: 0.55, // Lowered from 0.65 for better recall with Indonesian queries
    categories: effectiveCategories,
    sourceTypes: ['knowledge', 'document'], // Search both knowledge and documents
    villageId,
  });

  // Fallback: if NLU category filtering is too strict, retry WITHOUT category filter.
  // This improves recall for generic KB (e.g., glossary/5W1H) that may not match NLU categories.
  if (ragContext.totalResults === 0 && effectiveCategories && effectiveCategories.length > 0) {
    logger.debug('RAG search fallback: retrying without category filter', {
      effectiveCategories,
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
 * DB-FIRST PRIORITY: If the query relates to village profile data (jam buka,
 * nama desa, alamat, kepala desa, etc.), the authoritative DB data is fetched
 * and prepended to the context string as [SUMBER: DATABASE RESMI].
 * LLM is instructed to prioritize DB data over RAG results.
 * 
 * NOTE: minScore tuned to 0.55 for better recall with Indonesian language
 */
export async function getRAGContext(query: string, categories?: string[], villageId?: string): Promise<RAGContext> {
  // Let retrieveContext() handle category inference via its internal NLU (classifyQueryIntent).
  // Only pass explicit categories if the caller already knows them.
  const effectiveCategories = categories && categories.length > 0 ? categories : undefined;
  
  // Fetch RAG context
  const ragContext = await retrieveContext(query, {
    topK: 5,
    minScore: 0.55,
    categories: effectiveCategories,
    sourceTypes: ['knowledge', 'document'],
    villageId,
  });

  // Track whether DB data was injected for auto-resolution
  let dbDataInjected = false;

  // DB-FIRST: Use micro-LLM to determine if query needs DB profile data
  // Replaces keyword-based isProfileRelatedQuery with semantic NLU classifier
  if (villageId) {
    let needsDbProfile = false;
    try {
      const profileResult = await classifyProfileQuery(query, { village_id: villageId });
      needsDbProfile = !!(profileResult?.needs_db_profile && profileResult.confidence >= 0.7);
    } catch (error: any) {
      logger.warn('Profile query classifier failed, skipping DB-first', { error: error.message });
    }

    if (needsDbProfile) {
      try {
        const profile = await getVillageProfileSummary(villageId);
        if (profile?.name) {
          const dbContext = formatProfileAsContext(profile);
          
          // Prepend DB data BEFORE RAG results so LLM sees it first
          if (ragContext.contextString) {
            ragContext.contextString = `${dbContext}\n\n${ragContext.contextString}`;
          } else {
            ragContext.contextString = dbContext;
            ragContext.totalResults = Math.max(ragContext.totalResults, 1);
          }
          
          dbDataInjected = true;
          logger.info('DB-first: Prepended village profile to RAG context', {
            villageId, query: query.substring(0, 50),
          });
        }
      } catch (error: any) {
        logger.warn('DB-first: Failed to fetch village profile', { error: error.message });
      }
    }
  }

  // CONFLICT HANDLING: Report conflicts to dashboard + auto-resolve when DB data is authoritative
  if (ragContext.conflicts && ragContext.conflicts.length > 0) {
    const isAutoResolved = dbDataInjected;

    // Report each conflict to the Dashboard (fire-and-forget)
    for (const conflict of ragContext.conflicts) {
      reportKnowledgeConflict({
        source1Title: conflict.source1,
        source2Title: conflict.source2,
        contentSummary: `Sumber 1: ${conflict.contentSnippet1}\n---\nSumber 2: ${conflict.contentSnippet2}`,
        similarityScore: conflict.similarityScore,
        query: query,
        channel: 'system',
        villageId,
        autoResolved: isAutoResolved,
      }).catch(() => {}); // fire-and-forget
    }

    // AUTO-RESOLUTION: If DB data was injected, strip conflict warnings from context
    // because DB data is authoritative — no need to confuse user with conflicts
    if (isAutoResolved) {
      const resolvedCount = ragContext.conflicts?.length || 0;
      ragContext.contextString = autoResolveConflicts(ragContext.contextString);
      ragContext.conflicts = undefined; // Clear conflicts since they're resolved
      logger.info('Auto-resolved conflicts: DB data is authoritative', {
        conflictCount: resolvedCount,
        villageId,
        query: query.substring(0, 50),
      });
    }
  }

  return ragContext;
}

/**
 * Strip conflict warning markers from context string when auto-resolving.
 * Keeps the content but removes ⚠️ KONFLIK markers so LLM treats all data normally,
 * with DB data (already prepended) taking priority.
 */
function autoResolveConflicts(contextString: string): string {
  let resolved = contextString;
  // Remove the conflict PERHATIAN header
  resolved = resolved.replace(/⚠️ PERHATIAN: Ditemukan \d+ kelompok data yang BERBEDA dari sumber berbeda\.\n.*?\n\n/g, '');
  // Remove per-item conflict markers
  resolved = resolved.replace(/⚠️ \[KONFLIK DATA - Ada \d+ sumber berbeda tentang topik ini\]\n/g, '');
  // Remove [SUMBER: ...] labels that were added for conflicts
  resolved = resolved.replace(/\[SUMBER: [^\]]+\] /g, '');
  return resolved;
}


/**
 * Format village profile DB data as authoritative context block.
 * Marked with [SUMBER: DATABASE RESMI] so LLM knows to prioritize it.
 *
 * IMPORTANT: Only claims authority over fields that are actually present.
 * If a field is not available in the DB, it is NOT listed — this lets
 * the RAG knowledge base fill in the gap without conflict.
 */
function formatProfileAsContext(profile: VillageProfileSummary): string {
  const dataFields: string[] = [];
  
  if (profile.name) dataFields.push(`Nama Desa/Kelurahan: ${profile.name}`);
  if (profile.short_name) dataFields.push(`Nama Singkat: ${profile.short_name}`);
  if (profile.address) dataFields.push(`Alamat: ${profile.address}`);
  if (profile.gmaps_url) dataFields.push(`Google Maps: ${profile.gmaps_url}`);
  if (profile.operating_hours) {
    dataFields.push(`Jam Operasional: ${typeof profile.operating_hours === 'string' ? profile.operating_hours : JSON.stringify(profile.operating_hours)}`);
  }
  
  // If no meaningful data, don't generate DB context block
  if (dataFields.length === 0) return '';

  const fieldList = dataFields.map(f => f.split(':')[0]).join(', ');
  const lines = [
    '=== DATA RESMI DARI DATABASE ===',
    `[SUMBER: DATABASE RESMI - Data berikut (${fieldList}) bersifat otoritatif. Untuk informasi LAIN yang tidak tercantum di sini, gunakan data dari knowledge base/dokumen.]`,
    '',
    ...dataFields,
    '=== AKHIR DATA DATABASE ===',
  ];
  return lines.join('\n');
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
 * Get village profile cache stats (for admin dashboard).
 */
export function getVillageProfileCacheStats() {
  const now = Date.now();
  let activeEntries = 0;
  for (const [, v] of _villageProfileCache) {
    if (now - v.ts < VILLAGE_PROFILE_TTL) activeEntries++;
  }
  return {
    name: 'villageProfileCache',
    size: activeEntries,
    maxSize: -1,
    ttlMs: VILLAGE_PROFILE_TTL,
    total: _villageProfileCache.size,
  };
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
      const profileLines = [
        `Nama Desa/Kelurahan: ${profile.name || '-'}`,
        `Nama Singkat: ${profile.short_name || '-'}`,
      ];
      profileLines.push(
        `Alamat: ${profile.address || '-'}`,
        `Google Maps: ${profile.gmaps_url || '-'}`,
        `Jam Operasional: ${profile.operating_hours ? JSON.stringify(profile.operating_hours) : '-'}`,
      );
      const profileContext = profileLines.join('\n');

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
      categories: ['profil_desa', 'kontak'],
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
          category: 'profil_desa',
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

/**
 * Report a knowledge gap to the Dashboard for admin visibility.
 * Fire-and-forget: errors are logged but never bubble up.
 */
export async function reportKnowledgeGap(opts: {
  query: string;
  intent: string;
  confidence: string;
  channel: string;
  villageId?: string;
}): Promise<void> {
  try {
    await axios.post(
      `${config.dashboardServiceUrl}/api/internal/knowledge/gaps`,
      {
        query_text: opts.query.substring(0, 500),
        intent: opts.intent,
        confidence_level: opts.confidence,
        channel: opts.channel,
        village_id: opts.villageId,
      },
      {
        headers: { 'x-internal-api-key': config.internalApiKey },
        timeout: 3000,
      },
    );
  } catch (error: any) {
    // Fire-and-forget — don't disrupt the main flow
    logger.debug('Failed to report knowledge gap to dashboard', { error: error.message });
  }
}

/**
 * Report a knowledge conflict to the Dashboard for admin visibility.
 * Fire-and-forget: errors are logged but never bubble up.
 * Called when RAG detects conflicting data from different sources.
 */
export async function reportKnowledgeConflict(opts: {
  source1Title: string;
  source2Title: string;
  contentSummary: string;
  similarityScore: number;
  query?: string;
  channel?: string;
  villageId?: string;
  autoResolved?: boolean;
}): Promise<void> {
  try {
    await axios.post(
      `${config.dashboardServiceUrl}/api/internal/knowledge/conflicts`,
      {
        source1_title: opts.source1Title.substring(0, 255),
        source2_title: opts.source2Title.substring(0, 255),
        content_summary: opts.contentSummary.substring(0, 2000),
        similarity_score: opts.similarityScore,
        query_text: opts.query?.substring(0, 500),
        channel: opts.channel || 'system',
        village_id: opts.villageId,
        auto_resolved: opts.autoResolved || false,
      },
      {
        headers: { 'x-internal-api-key': config.internalApiKey },
        timeout: 3000,
      },
    );
    logger.info('Reported knowledge conflict to dashboard', {
      source1: opts.source1Title,
      source2: opts.source2Title,
      autoResolved: opts.autoResolved,
    });
  } catch (error: any) {
    // Fire-and-forget — don't disrupt the main flow
    logger.debug('Failed to report knowledge conflict to dashboard', { error: error.message });
  }
}
