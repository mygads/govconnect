import axios from 'axios';
import logger from '../utils/logger';
import { config } from '../config/env';
import { isAIGatewayEnabledAsync } from './ai-gateway.service';
import { aiAnalyticsService } from './ai-analytics.service';
import {
  retrieveContext,
  classifyQueryIntent,
} from './rag.service';
import { searchKnowledgeByKeywordsDirect, countKnowledgeDocs } from './vector-db.service';
import { perfSpan, perfMeasure, perfCount } from '../pipeline/perf-timer';
import { RAGContext, RAGQualityAssessment } from '../types/embedding.types';
import { classifyProfileQuery } from './micro-llm-matcher.service';
import type { QueryRewriteContext } from './query-rewrite.service';

interface SearchContext {
  villageId?: string;
  waUserId?: string;
  sessionId?: string;
  channel?: string;
  /**
   * Konteks percakapan untuk query rewriting sebelum RAG retrieval
   * (query-rewrite.service.ts). Opsional — tanpa ini rewrite tidak jalan.
   */
  rewriteContext?: QueryRewriteContext;
}

function normalizeSearchContext(
  villageOrContext?: string | SearchContext,
  channel: string = 'system',
): Required<Pick<SearchContext, 'channel'>> & Omit<SearchContext, 'channel'> {
  if (typeof villageOrContext === 'object' && villageOrContext !== null) {
    return {
      villageId: villageOrContext.villageId,
      waUserId: villageOrContext.waUserId,
      sessionId: villageOrContext.sessionId,
      channel: villageOrContext.channel || channel,
      rewriteContext: villageOrContext.rewriteContext,
    };
  }

  return {
    villageId: villageOrContext,
    channel,
  };
}

interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  category: string;
  keywords: string[];
  source_type?: 'knowledge' | 'document';
  section_title?: string | null;
  trust_level?: 'trusted_fact' | 'untrusted_retrieval';
}

interface KnowledgeSearchResult {
  data: KnowledgeItem[];
  total: number;
  context: string;
  confidenceLevel?: 'none' | 'low' | 'medium' | 'high';
  retrievalMode?: 'rag' | 'keyword' | 'document_rag' | 'external_rerank' | 'heuristic_rerank' | 'raw_no_rerank';
  searchTimeMs?: number;
  topScore?: number | null;
  avgTopScore?: number | null;
  sourceTitles?: string[];
  candidateDebug?: NonNullable<RAGContext['retrievalDebug']>['candidates'];
  /**
   * W6: true when the post-retrieval fail-closed assertion discarded the
   * results (top score below trust threshold). Treat as "no relevant
   * knowledge" — do NOT let the LLM answer from these results.
   */
  ragUnreliable?: boolean;
  /** W9: live quality-gate assessment for this retrieval. */
  ragQuality?: RAGQualityAssessment;
}

function resolveKnowledgeRetrievalMode(
  ragContext: Pick<RAGContext, 'retrievalDebug'>,
  fallback: 'rag' | 'document_rag',
): KnowledgeSearchResult['retrievalMode'] {
  return ragContext.retrievalDebug?.retrievalMode || fallback;
}

interface VillageProfileSummary {
  id?: string;
  name?: string | null;
  slug?: string | null;
  short_name?: string | null;
  address?: string | null;
  gmaps_url?: string | null;
  timezone?: string | null;
  operating_hours?: any | null;
}

async function isRAGSearchEnabled(villageId?: string): Promise<boolean> {
  // [FIX] RAG only needs embed lane. The 'rag' (rewrite) lane is optional
  // for query rewriting, not required for basic vector search.
  const embedEnabled = await isAIGatewayEnabledAsync('embed', villageId ?? null);
  return embedEnabled;
}

/**
 * Search knowledge base for relevant information.
 * This lane is intentionally limited to curated knowledge items only.
 * Uploaded documents must use searchDocuments() so the retrieval plane stays explicit.
 */
export async function searchKnowledge(
  query: string,
  categories?: string[],
  villageOrContext?: string | SearchContext,
  channel: string = 'system',
): Promise<KnowledgeSearchResult> {
  const searchContext = normalizeSearchContext(villageOrContext, channel);
  const { villageId } = searchContext;
  try {
    const ragSearchEnabled = await perfMeasure('kb.rag_enabled_check', () => isRAGSearchEnabled(villageId));

    logger.info('Searching knowledge base', {
      query: query.substring(0, 100),
      categories,
      villageId,
      useRAG: ragSearchEnabled,
    });

    // Try RAG-based semantic search first
    if (ragSearchEnabled) {
      try {
        const ragResult = await searchKnowledgeWithRAG(query, categories, searchContext);
        if (ragResult.total > 0) {
          // If RAG returns results but misses key terms, augment with keyword search for higher precision.
          // This helps for glossary/command-style queries (e.g., 5W1H, embedding, "cek status").
          if (shouldAugmentRagWithKeywordSearch(query, ragResult.context)) {
            const keywordResult = await searchKnowledgeWithKeywords(query, undefined, villageId);
            if (keywordResult.total > 0) {
              const merged = mergeKnowledgeResults(ragResult, keywordResult);
              trackKnowledgeSearch(query, villageId, merged, searchContext.channel);
              return merged;
            }
          }

          trackKnowledgeSearch(query, villageId, ragResult, searchContext.channel);
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
    const keywordResult = await searchKnowledgeWithKeywords(query, categories, villageId);
    if (keywordResult.total > 0) {
      trackKnowledgeSearch(query, villageId, keywordResult, searchContext.channel);
      return keywordResult;
    }

    // Last resort: direct keyword ILIKE on knowledge_vectors (bypasses dashboard).
    // (Fix D6/K2/K3: RAG + dashboard keyword both missed existing KB docs.)
    try {
      const directHits = await searchKnowledgeByKeywordsDirect(query, villageId, 3);
      if (directHits.length > 0) {
        const directResult: KnowledgeSearchResult = {
          data: directHits.map((h) => ({
            id: h.id,
            title: h.title,
            content: h.content,
            category: h.category,
            keywords: [],
            source_type: 'knowledge' as const,
          })),
          total: directHits.length,
          context: directHits.map((h) => `${h.title}: ${h.content}`).join('\n\n'),
          confidenceLevel: 'medium',
          retrievalMode: 'keyword',
          sourceTitles: directHits.map((h) => h.title),
        };
        trackKnowledgeSearch(query, villageId, directResult, searchContext.channel);
        return directResult;
      }
    } catch (directError: any) {
      logger.warn('Direct keyword search fallback failed', { error: directError.message });
    }

    trackKnowledgeSearch(query, villageId, keywordResult, searchContext.channel);
    return keywordResult;
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
 * Search uploaded/ingested documents only.
 * This is intentionally separate from general knowledge search so the agent
 * can choose the narrower retrieval tool when the answer is likely in PDFs/Word docs.
 */
export async function searchDocuments(
  query: string,
  categories?: string[],
  villageOrContext?: string | SearchContext,
  channel: string = 'system',
): Promise<KnowledgeSearchResult> {
  const searchContext = normalizeSearchContext(villageOrContext, channel);
  const { villageId } = searchContext;
  try {
    const ragSearchEnabled = await perfMeasure('kb.rag_enabled_check', () => isRAGSearchEnabled(villageId));
    if (!ragSearchEnabled) {
      const empty = {
        data: [],
        total: 0,
        context: '',
        confidenceLevel: 'none' as const,
        retrievalMode: 'document_rag' as const,
      };
      trackKnowledgeSearch(query, villageId, empty, searchContext.channel);
      return empty;
    }

    const ragContext = await retrieveContext(query, {
      topK: 5,
      minScore: 0.45,
      categories: categories && categories.length > 0 ? categories : undefined,
      villageId,
      waUserId: searchContext.waUserId,
      sessionId: searchContext.sessionId,
      channel: searchContext.channel,
      queryRewriteContext: searchContext.rewriteContext,
    });

    if (ragContext.totalResults === 0) {
      const empty = {
        data: [],
        total: 0,
        context: '',
        confidenceLevel: ragContext.confidence?.level || 'none',
        retrievalMode: resolveKnowledgeRetrievalMode(ragContext, 'document_rag'),
        searchTimeMs: ragContext.searchTimeMs,
      };
      trackKnowledgeSearch(query, villageId, empty, searchContext.channel);
      return empty;
    }

    const result: KnowledgeSearchResult = {
      data: ragContext.relevantChunks.map((chunk) => ({
        id: chunk.id,
        title: chunk.source,
        content: chunk.content,
        category: chunk.metadata?.category || 'document',
        keywords: chunk.metadata?.keywords || [],
        source_type: 'document' as const,
        section_title: chunk.metadata?.sectionTitle || null,
        trust_level: 'untrusted_retrieval' as const,
      })),
      total: ragContext.totalResults,
      context: ragContext.contextString,
      confidenceLevel: ragContext.confidence?.level || 'medium',
      retrievalMode: resolveKnowledgeRetrievalMode(ragContext, 'document_rag'),
      searchTimeMs: ragContext.searchTimeMs,
      topScore: ragContext.relevantChunks[0]?.score ?? null,
      avgTopScore: calculateAverageTopScore(ragContext),
      sourceTitles: ragContext.relevantChunks.map((chunk) => chunk.source).filter(Boolean).slice(0, 5),
      candidateDebug: ragContext.retrievalDebug?.candidates,
    };
    trackKnowledgeSearch(query, villageId, result, searchContext.channel);
    return result;
  } catch (error: any) {
    logger.warn('Document search failed', {
      query: query.substring(0, 100),
      villageId,
      error: error.message,
    });

    const empty = {
      data: [],
      total: 0,
      context: '',
      confidenceLevel: 'none' as const,
      retrievalMode: 'document_rag' as const,
    };
    trackKnowledgeSearch(query, villageId, empty, channel);
    return empty;
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
    confidenceLevel: a.confidenceLevel === 'high' ? 'high' : (a.confidenceLevel || b.confidenceLevel || 'medium'),
    retrievalMode: a.retrievalMode || b.retrievalMode,
    searchTimeMs: (a.searchTimeMs || 0) + (b.searchTimeMs || 0),
    topScore: [a.topScore, b.topScore].filter((score): score is number => typeof score === 'number').sort((x, y) => y - x)[0] ?? null,
    avgTopScore: (() => {
      const scores = [a.avgTopScore, b.avgTopScore].filter((score): score is number => typeof score === 'number');
      return scores.length > 0
        ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 1000) / 1000
        : null;
    })(),
    sourceTitles: Array.from(
      new Set([...(a.sourceTitles || []), ...(b.sourceTitles || [])].filter(Boolean))
    ).slice(0, 5),
    candidateDebug: a.candidateDebug || b.candidateDebug,
  };
}

function trackKnowledgeSearch(
  query: string,
  villageId: string | undefined,
  result: KnowledgeSearchResult,
  channel: string,
): void {
  const confidence = result.confidenceLevel || (result.total > 0 ? 'medium' : 'none');
  const hasKnowledge = result.total > 0;

  aiAnalyticsService.recordKnowledge({
    query,
    intent: result.retrievalMode === 'document_rag' ? 'DOCUMENT_SEARCH' : 'KNOWLEDGE_QUERY',
    confidence,
    channel,
    villageId,
    hasKnowledge,
  });

  aiAnalyticsService.recordRetrievalTrace({
    query,
    retrievalMode: result.retrievalMode || 'keyword',
    confidence,
    hasKnowledge,
    resultCount: result.total,
    searchTimeMs: result.searchTimeMs,
    topScore: result.topScore,
    avgTopScore: result.avgTopScore,
    sourceTitles: result.sourceTitles,
    candidateDebug: result.candidateDebug,
    channel,
    villageId,
  });

  if (!hasKnowledge || confidence === 'low' || confidence === 'none') {
    reportKnowledgeGap({
      query,
      intent: result.retrievalMode === 'document_rag' ? 'DOCUMENT_SEARCH' : 'KNOWLEDGE_QUERY',
      confidence,
      channel,
      villageId,
    }).catch(() => {});
  }
}

// P0-1 FIX: cache positive KB doc counts (TTL 5 min) to avoid a COUNT(*) query
// on every KB search. Only positive counts are cached (fail-open); a 0 result
// is never cached so newly uploaded docs are visible immediately.
const KB_COUNT_CACHE = new Map<string, { count: number; expiresAt: number }>();
const KB_COUNT_CACHE_TTL_MS = 5 * 60 * 1000;

export function clearKnowledgeDocCountCache(villageId?: string): void {
  if (villageId) {
    KB_COUNT_CACHE.delete(villageId);
  } else {
    KB_COUNT_CACHE.clear();
  }
}

async function countKnowledgeDocsCached(villageId?: string): Promise<number> {
  const cacheKey = villageId ?? '__global__';
  const cached = KB_COUNT_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.count;
  }
  const count = await countKnowledgeDocs(villageId);
  if (count > 0) {
    KB_COUNT_CACHE.set(cacheKey, { count, expiresAt: Date.now() + KB_COUNT_CACHE_TTL_MS });
  }
  return count;
}

/**
 * Search curated knowledge using RAG (semantic search with embeddings)
 * 
 * NOTE: minScore tuned to 0.55 for better recall with Indonesian language
 * Higher scores (0.65+) were too strict and missed relevant results
 */
async function searchKnowledgeWithRAG(query: string, categories?: string[], context?: string | SearchContext): Promise<KnowledgeSearchResult> {
  const searchContext = normalizeSearchContext(context);
  const { villageId } = searchContext;
  
  // P0-1 FIX: Early-exit if village has 0 KB docs (avoids wasted RAG retrieval + LLM intent classification)
  try {
    const kbCount = await perfMeasure('kb.count_docs', () => countKnowledgeDocsCached(villageId));
    if (kbCount === 0) {
      logger.debug('KB early-exit: village has 0 documents, skipping RAG', { villageId });
      return { data: [], total: 0, context: '' };
    }
  } catch (e) {
    // If count fails, proceed with normal RAG (fail-open for safety)
  }
  // Let retrieveContext() handle category inference via its internal NLU (classifyQueryIntent).
  // Only pass explicit categories if the caller already knows them (e.g. from a prior NLU call).
  const effectiveCategories = categories && categories.length > 0 ? categories : undefined;

  // Perf optimization: compute query intent ONCE and reuse across retries
  // (avoids 4x redundant LLM calls when KB is empty or no results found)
  let precomputedIntent = null;
  try {
    precomputedIntent = await perfMeasure('kb.intent_classify', () => classifyQueryIntent(query, {
      village_id: villageId,
      wa_user_id: searchContext.waUserId,
      session_id: searchContext.sessionId,
      channel: searchContext.channel,
    }));
  } catch (e) {
    // If intent classification fails, let retrieveContext handle it per-call
  }

  // Perf (P0-1): collapsed recall-first single pass.
  // The old 4-attempt chain only differed in minScore (0.55/0.45/0.35/0.35)
  // and a +0.02 category soft-boost; W6 fail-closed (top1 < 0.65 -> discard)
  // dominates, so a higher threshold can never produce a passing hit that the
  // lower threshold would miss. One call at minScore 0.35 preserves recall
  // with ~1/4 of the embedding + DB round-trips on the miss path.
  const ragContext = await perfMeasure('kb.retrieve_attempt:1', () => retrieveContext(query, {
    topK: 5,
    minScore: 0.35,
    categories: effectiveCategories,
    sourceTypes: ['knowledge'],
    villageId,
    waUserId: searchContext.waUserId,
    sessionId: searchContext.sessionId,
    channel: searchContext.channel,
    precomputedIntent,
    queryRewriteContext: searchContext.rewriteContext,
    useQueryExpansion: false,  // Perf: skip LLM query expansion for fallback searches
    useHybridSearch: false,    // Perf: skip hybrid rerank for fallback searches
  }));


  if (ragContext.totalResults === 0) {
    return {
      data: [],
      total: 0,
      context: '',
      // W6: propagate fail-closed flag so callers know this is "unreliable",
      // not merely "no results".
      ragUnreliable: ragContext.ragUnreliable,
      ragQuality: ragContext.ragQuality,
    };
  }

  // Convert RAG results to KnowledgeItem format
  const items: KnowledgeItem[] = ragContext.relevantChunks.map(chunk => ({
    id: chunk.id,
    title: chunk.source,
    content: chunk.content,
    category: chunk.metadata?.category || 'general',
    keywords: chunk.metadata?.keywords || [],
    source_type: chunk.sourceType,
    section_title: chunk.metadata?.sectionTitle || null,
    trust_level: 'untrusted_retrieval',
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
    confidenceLevel: ragContext.confidence?.level || 'medium',
    retrievalMode: resolveKnowledgeRetrievalMode(ragContext, 'rag'),
    searchTimeMs: ragContext.searchTimeMs,
    topScore: ragContext.relevantChunks[0]?.score ?? null,
    avgTopScore: calculateAverageTopScore(ragContext),
    sourceTitles: items.map((item) => item.title).filter(Boolean).slice(0, 5),
    candidateDebug: ragContext.retrievalDebug?.candidates,
    ragUnreliable: ragContext.ragUnreliable,
    ragQuality: ragContext.ragQuality,
  };
}

/**
 * Search knowledge base using keyword-based API (fallback)
 */
async function searchKnowledgeWithKeywords(query: string, categories?: string[], villageId?: string): Promise<KnowledgeSearchResult> {
  const startTime = Date.now();
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

  return {
    ...response.data,
    confidenceLevel: response.data.total > 0 ? 'medium' : 'none',
    retrievalMode: 'keyword',
    searchTimeMs: response.data.searchTimeMs ?? (Date.now() - startTime),
    sourceTitles: (response.data.data || []).map((item) => item.title).filter(Boolean).slice(0, 5),
    candidateDebug: (response.data.data || []).slice(0, 10).map((item, index) => ({
      id: item.id,
      title: item.title,
      sourceType: item.source_type || 'knowledge',
      finalScore: Math.max(0.1, 1 - index * 0.08),
      vectorScore: null,
      keywordScore: null,
      vectorRank: null,
      keywordRank: index + 1,
      rrfScore: null,
      rerankScore: null,
      matchType: 'keyword' as const,
      selected: true,
    })),
  };
}

function calculateAverageTopScore(ragContext: RAGContext): number | null {
  const scores = ragContext.relevantChunks
    .slice(0, 3)
    .map((chunk) => chunk.score)
    .filter((score) => Number.isFinite(score));

  if (scores.length === 0) {
    return null;
  }

  return Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 1000) / 1000;
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
 * Get knowledge-only RAG context directly for a query.
 * Legacy callers should use this only for curated knowledge; document retrieval
 * must go through searchDocuments() or retrieveContext(..., { sourceTypes: ['document'] }).
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
    sourceTypes: ['knowledge'],
    villageId,
    // getRAGContext tidak punya konteks percakapan caller (standalone
    // convenience fn): rewrite tidak jalan di sini (fail-safe).
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
    const hours = profile.operating_hours;
    if (typeof hours === 'string') {
      dataFields.push(`Jam Operasional: ${hours}`);
    } else if (typeof hours === 'object') {
      const DAY_LABELS: Record<string, string> = {
        senin: 'Senin', selasa: 'Selasa', rabu: 'Rabu', kamis: 'Kamis',
        jumat: 'Jumat', sabtu: 'Sabtu', minggu: 'Minggu',
      };
      const ORDER = ['senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu'];
      const lines = ORDER
        .filter((day) => (hours as any)[day])
        .map((day) => {
          const h = (hours as any)[day];
          if (!h?.open && !h?.close) return `  ${DAY_LABELS[day] || day}: Tutup`;
          return `  ${DAY_LABELS[day] || day}: ${h.open || '?'} - ${h.close || '?'}`;
        });
      dataFields.push(`Jam Operasional:\n${lines.join('\n')}`);
    }
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
const VILLAGE_PROFILE_TTL = 5 * 60 * 1000; // 5 minutes (reduced from 15 to minimize stale data)

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
