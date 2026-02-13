/**
 * RAG (Retrieval Augmented Generation) Service for GovConnect AI
 * 
 * Combines semantic search with LLM to provide accurate, grounded responses
 * 
 * Features:
 * - Semantic search using embeddings
 * - Context building for LLM prompts
 * - Re-ranking of search results
 * - Source attribution
 * - Query expansion with Indonesian synonyms
 */

import logger from '../utils/logger';
import {
  RAGContext,
  RAGConfidence,
  RAGConflictInfo,
  VectorSearchResult,
  VectorSearchOptions,
} from '../types/embedding.types';
import { generateEmbedding } from './embedding.service';
import { searchVectors, recordBatchRetrievals } from './vector-db.service';
import { hybridSearch, HybridSearchResult } from './hybrid-search.service';

/**
 * Default RAG configuration
 */
const DEFAULT_TOP_K = 8;            // Fetch more so dedup still leaves enough useful results
const DEFAULT_MIN_SCORE = 0.65;
const MIN_EFFECTIVE_SCORE = 0.45; // Floor to prevent noise from cascading threshold reductions
const MAX_CONTEXT_LENGTH = 5000; // Increased from 4000 — dedup removes waste, so we can include more

/**
 * ==================== QUERY INTENT CLASSIFICATION ====================
 * Uses micro NLU (LLM) to intelligently decide if RAG is needed.
 * Fast regex pre-filter only for trivial cases to save LLM calls.
 */

import { classifyRAGIntent } from './micro-llm-matcher.service';

// Fast pre-filter: ONLY for trivially obvious non-RAG messages (saves LLM call)
// These are so clearly non-informational that LLM classification is wasteful
const OBVIOUS_SKIP_PATTERNS = [
  /^(halo|hai|hi|hello|hey)\s*[.!?]*$/i,
  /^(selamat\s+(pagi|siang|sore|malam))\s*[.!?]*$/i,
  /^(assalamualaikum|permisi)\s*[.!?]*$/i,
  /^(ya|tidak|iya|ok|oke|baik|siap|lanjut)\s*[.!?]*$/i,
  /^(terima\s*kasih|makasih|thanks?)\s*[.!?]*$/i,
];

// Spam/malicious content patterns - skip processing entirely
const SPAM_PATTERNS = [
  /(.)\1{30,}/,                         // 30+ repeated single characters (was 25+, now more lenient)
  /^[^\w\s]+$/,                         // Only symbols (no letters/numbers/spaces)
  /(http|https|www\.|bit\.ly|t\.co|tinyurl)/i,  // URLs (potential spam/phishing)
  /\b(viagra|casino|poker|judi|togel|slot|xxx|porn)\b/i, // Adult/gambling content (added word boundaries)
  /\b(click\s+here|klik\s+disini|download\s+now|claim\s+now)\b/i, // Spam call-to-action (added word boundaries)
  /\b(menang\s+jutaan|hadiah\s+milyar|transfer\s+sekarang|bonus\s+besar)\b/i, // Scam phrases (added word boundaries)
];

/**
 * Check if message is spam or malicious
 */
export function isSpamMessage(message: string): boolean {
  if (!message || message.length < 2) return true;
  if (message.length > 3000) return true; // Increased from 2000 to 3000 (more lenient)
  
  for (const pattern of SPAM_PATTERNS) {
    if (pattern.test(message)) {
      return true;
    }
  }
  return false;
}

/**
 * Result from query intent classification
 */
interface QueryIntentResult {
  intent: 'skip' | 'required' | 'optional';
  nluCategories?: string[];
}

/**
 * Classify query intent to determine RAG necessity.
 * Uses micro NLU (LLM) for intelligent classification.
 * Also returns NLU-inferred categories for smarter retrieval.
 * Falls back to 'optional' if LLM is unavailable.
 */
async function classifyQueryIntent(
  query: string,
  context?: { village_id?: string; wa_user_id?: string; session_id?: string; channel?: string }
): Promise<QueryIntentResult> {
  const normalizedQuery = query.trim().toLowerCase();

  // Fast pre-filter: trivially obvious skips (saves an LLM call)
  for (const pattern of OBVIOUS_SKIP_PATTERNS) {
    if (pattern.test(normalizedQuery)) {
      return { intent: 'skip' };
    }
  }

  // Use micro NLU for intelligent classification
  try {
    const result = await classifyRAGIntent(query, context);
    if (result && result.confidence >= 0.6) {
      if (result.decision === 'RAG_REQUIRED') return { intent: 'required', nluCategories: result.categories };
      if (result.decision === 'RAG_SKIP') return { intent: 'skip', nluCategories: result.categories };
    }
    // Low confidence → treat as optional (still search, lower threshold)
    if (result) return { intent: 'optional', nluCategories: result.categories };
  } catch (err: any) {
    logger.warn('RAG intent NLU failed, falling back to optional', { error: err.message });
  }

  // Fallback: if LLM unavailable, default to optional (still searches RAG)
  return { intent: 'optional' };
}

/**
 * ==================== QUERY EXPANSION (Micro LLM) ====================
 * Uses a lightweight Gemini model to expand user queries with relevant
 * Indonesian synonyms/terms for better document retrieval.
 *
 * Unlike a static synonym map, the LLM understands context, slang,
 * regional words, and abbreviations naturally.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/env';
import { extractAndRecord } from './token-usage.service';
import { apiKeyManager, MAX_RETRIES_PER_MODEL, isRateLimitError } from './api-key-manager.service';

const EXPAND_MODELS = (() => {
  const raw = (process.env.MICRO_NLU_MODELS || '').trim();
  if (!raw) return ['gemini-2.0-flash-lite', 'gemini-2.5-flash-lite'];
  const models = raw.split(',').map(m => m.trim()).filter(Boolean);
  return models.length ? models : ['gemini-2.0-flash-lite', 'gemini-2.5-flash-lite'];
})();

const EXPAND_PROMPT = `Kamu adalah query expander untuk pencarian dokumen layanan pemerintah Indonesia.

TUGAS:
Diberikan QUERY dari warga, tambahkan 3-5 kata/frasa sinonim yang relevan untuk memperluas pencarian dokumen.

ATURAN:
- Pahami konteks dan maksud query (singkatan, slang, bahasa daerah).
- Tambahkan sinonim yang relevan dalam bahasa Indonesia.
- JANGAN ubah query asli, hanya tambahkan kata-kata relevan di akhir.
- Output langsung teks query yang sudah di-expand (BUKAN JSON).

CONTOH:
Input: "cara bikin KTP"
Output: cara bikin KTP kartu tanda penduduk identitas pembuatan prosedur persyaratan

Input: "jam buka kelurahan"
Output: jam buka kelurahan waktu operasional jadwal kerja pelayanan kantor

QUERY:
{query}`;

// ── Query expansion cache ──
const expansionCache = new Map<string, { expanded: string; ts: number }>();
const EXPANSION_CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const MAX_EXPANSION_CACHE = 200;

function normalizeForExpansionCache(q: string): string {
  return q.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[^\w\s]/g, '');
}

/**
 * Expand query using micro LLM for better retrieval recall.
 * Results are cached for 15 minutes to avoid redundant LLM calls.
 * Falls back to original query if LLM fails.
 * Skips expansion for very short queries (≤3 words) — direct keyword match is sufficient.
 */
export async function expandQuery(query: string): Promise<string> {
  if (!query.trim()) return query;
  if (!config.geminiApiKey && apiKeyManager.getByokKeys().length === 0) return query;

  // Skip expansion for very short queries — LLM overhead not worth it
  const wordCount = query.trim().split(/\s+/).length;
  if (wordCount <= 2) {
    logger.debug('Query expansion skipped (≤2 words)', { query: query.substring(0, 40) });
    return query;
  }

  // Check expansion cache first
  const cacheKey = normalizeForExpansionCache(query);
  const cached = expansionCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < EXPANSION_CACHE_TTL) {
    logger.debug('Query expansion cache hit', { query: query.substring(0, 40) });
    return cached.expanded;
  }

  const prompt = EXPAND_PROMPT.replace('{query}', query);

  // Build call plan using BYOK keys + fallback
  const callPlan = apiKeyManager.getCallPlan(EXPAND_MODELS, EXPAND_MODELS);

  for (const { key, model: modelName } of callPlan) {
    for (let retry = 0; retry < MAX_RETRIES_PER_MODEL; retry++) {
      try {
        const model = key.genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 150,
          },
        });

        const startMs = Date.now();
        const result = await model.generateContent(prompt);
        const durationMs = Date.now() - startMs;
        const expanded = result.response.text().trim();

        // Record BYOK usage
        if (key.isByok && key.keyId) {
          const usage = result.response.usageMetadata;
          apiKeyManager.recordSuccess(key.keyId);
          apiKeyManager.recordUsage(key.keyId, modelName, usage?.promptTokenCount ?? 0, usage?.totalTokenCount ?? 0);
        }

        extractAndRecord(result, modelName, 'rag_expand', 'rag_query_expand', {
          success: true,
          duration_ms: durationMs,
          key_source: key.isByok ? 'byok' : 'env',
          key_id: key.keyId,
          key_tier: key.tier,
        });

        if (expanded && expanded.length > query.length) {
          logger.debug('Query expanded via micro LLM', {
            original: query,
            expanded: expanded.substring(0, 100),
            model: modelName,
          });
          // Cache the expansion result
          if (expansionCache.size >= MAX_EXPANSION_CACHE) {
            const oldest = expansionCache.keys().next().value;
            if (oldest) expansionCache.delete(oldest);
          }
          expansionCache.set(cacheKey, { expanded, ts: Date.now() });
          return expanded;
        }
      } catch (error: any) {
        logger.warn('Query expansion failed', {
          keyName: key.keyName,
          model: modelName,
          retry: retry + 1,
          error: error.message,
        });
        if (key.isByok && key.keyId) {
          apiKeyManager.recordFailure(key.keyId, error.message);
        }
        // 429 / rate limit → mark model at capacity, skip to next model
        if (isRateLimitError(error.message || '')) {
          if (key.isByok && key.keyId) {
            apiKeyManager.recordRateLimit(key.keyId, modelName, key.tier);
          }
          break;
        }
        if (error.message?.includes('API_KEY_INVALID') || error.message?.includes('401') ||
            error.message?.includes('404') || error.message?.includes('not found')) break;
      }
    }
  }

  // Fallback: return original query if all models fail
  return query;
}

/**
 * Retrieve relevant context for a user query
 * This is the main entry point for RAG retrieval
 * 
 * @param query - User's question or query
 * @param options - Search options
 * @returns RAG context with relevant chunks and formatted string
 * 
 * @example
 * const context = await retrieveContext("jam buka kelurahan kapan?");
 * // Use context.contextString in LLM prompt
 */
export async function retrieveContext(
  query: string,
  options: VectorSearchOptions = {}
): Promise<RAGContext> {
  const startTime = Date.now();
  const {
    topK = DEFAULT_TOP_K,
    minScore = DEFAULT_MIN_SCORE,
    categories,
    sourceTypes = ['knowledge', 'document'],
    villageId,
    useQueryExpansion = true,  // Enable query expansion by default
    useHybridSearch = true,    // Enable hybrid search by default
  } = options as VectorSearchOptions & { useQueryExpansion?: boolean; useHybridSearch?: boolean };

  // Step 0: Check query intent - skip RAG for greetings/simple responses
  const queryIntentResult = await classifyQueryIntent(query);
  const queryIntent = queryIntentResult.intent;
  
  if (queryIntent === 'skip') {
    logger.debug('Skipping RAG for simple query', { 
      query: query.substring(0, 30),
      intent: queryIntent 
    });
    return {
      relevantChunks: [],
      contextString: '',
      totalResults: 0,
      searchTimeMs: Date.now() - startTime,
    };
  }

  // Adjust threshold based on intent, but enforce a minimum floor
  const adjustedMinScore = Math.max(
    queryIntent === 'required' ? minScore : minScore * 0.9,
    MIN_EFFECTIVE_SCORE
  );

  // Use NLU-inferred categories if caller didn't provide any
  const effectiveCategories = categories && categories.length > 0
    ? categories
    : queryIntentResult.nluCategories && queryIntentResult.nluCategories.length > 0
      ? queryIntentResult.nluCategories
      : undefined;

  logger.info('Starting RAG retrieval', {
    queryLength: query.length,
    queryIntent,
    topK,
    minScore: adjustedMinScore,
    categories: effectiveCategories,
    nluCategories: queryIntentResult.nluCategories,
    useQueryExpansion,
    useHybridSearch,
  });

  try {
    // Step 1: Expand query with synonyms for better recall
    const expandedQuery = useQueryExpansion ? await expandQuery(query) : query;
    
    let filteredResults: VectorSearchResult[];
    
    // Step 2-4: Use Hybrid Search (Vector + Keyword) or pure Vector search
    if (useHybridSearch) {
      // NEW: Hybrid search combines vector + keyword for better accuracy
      const hybridResults = await hybridSearch(expandedQuery, {
        topK,
        minScore: adjustedMinScore,
        categories: effectiveCategories,
        sourceTypes,
        villageId,
        useQueryExpansion: false, // Already expanded
      });
      
      filteredResults = hybridResults;
      
      logger.debug('Hybrid search completed', {
        query: query.substring(0, 50),
        resultCount: hybridResults.length,
        matchTypes: hybridResults.map(r => (r as HybridSearchResult).matchType),
      });
    } else {
      // Fallback: Pure vector search
      const queryEmbedding = await generateEmbedding(expandedQuery, {
        taskType: 'RETRIEVAL_QUERY',
        outputDimensionality: 768,
        useCache: true,
      });

      const searchResults = await searchVectors(queryEmbedding.values, {
        topK: topK * 2,
        minScore: adjustedMinScore * 0.8,
        categories,
        sourceTypes,
        villageId,
      });

      if (searchResults.length === 0) {
        logger.info('No relevant results found for query', {
          query: query.substring(0, 50),
          expandedQuery: expandedQuery !== query ? expandedQuery.substring(0, 100) : undefined,
        });

        return {
          relevantChunks: [],
          contextString: '',
          totalResults: 0,
          searchTimeMs: Date.now() - startTime,
        };
      }

      // Re-rank and filter
      const rerankedResults = rerankResults(searchResults, query, topK);
      filteredResults = rerankedResults.filter(r => r.score >= adjustedMinScore);
    }

    if (filteredResults.length === 0) {
      return {
        relevantChunks: [],
        contextString: '',
        totalResults: 0,
        searchTimeMs: Date.now() - startTime,
      };
    }

    // Step 5: Record retrievals for analytics (fire and forget)
    const knowledgeIds = filteredResults
      .filter(r => r.sourceType === 'knowledge')
      .map(r => r.id);
    if (knowledgeIds.length > 0) {
      recordBatchRetrievals(knowledgeIds).catch(() => {});
    }

    // Step 6: Build context string for LLM
    const { context: contextString, conflicts } = buildContextString(filteredResults);

    // Step 7: Calculate confidence score
    const confidence = calculateConfidence(filteredResults, query);

    const endTime = Date.now();

    logger.info('RAG retrieval completed', {
      query: query.substring(0, 50),
      intent: queryIntent,
      expanded: expandedQuery !== query,
      hybrid: useHybridSearch,
      totalResults: filteredResults.length,
      topScore: filteredResults[0]?.score.toFixed(4),
      confidence: confidence.level,
      searchTimeMs: endTime - startTime,
    });

    return {
      relevantChunks: filteredResults,
      contextString,
      totalResults: filteredResults.length,
      searchTimeMs: endTime - startTime,
      confidence,
      conflicts: conflicts.length > 0 ? conflicts : undefined,
    };
  } catch (error: any) {
    logger.error('RAG retrieval failed', {
      query: query.substring(0, 50),
      error: error.message,
    });

    return {
      relevantChunks: [],
      contextString: '',
      totalResults: 0,
      searchTimeMs: Date.now() - startTime,
      confidence: {
        level: 'none',
        score: 0,
        reason: 'RAG retrieval failed',
        suggestFallback: true,
      },
    };
  }
}

/**
 * Calculate confidence score for RAG results
 * Based on multiple factors: top score, result count, score variance
 */
function calculateConfidence(
  results: VectorSearchResult[],
  query: string
): RAGConfidence {
  if (results.length === 0) {
    return {
      level: 'none',
      score: 0,
      reason: 'No relevant knowledge found',
      suggestFallback: true,
    };
  }

  const topScore = results[0].score;
  const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;
  const resultCount = results.length;

  // Calculate variance (consistency of results)
  const variance = results.reduce((sum, r) => sum + Math.pow(r.score - avgScore, 2), 0) / results.length;
  const consistency = 1 - Math.min(variance * 2, 1); // 0-1, higher is more consistent

  // Weighted confidence score
  let score = 0;
  score += topScore * 0.5;           // 50% from top result
  score += avgScore * 0.25;          // 25% from average
  score += Math.min(resultCount / 3, 1) * 0.15;  // 15% from having multiple results
  score += consistency * 0.1;        // 10% from consistency

  // Determine level and reason
  let level: RAGConfidence['level'];
  let reason: string;
  let suggestFallback: boolean;

  if (score >= 0.8 && topScore >= 0.85) {
    level = 'high';
    reason = `Strong match found (${(topScore * 100).toFixed(0)}% relevance)`;
    suggestFallback = false;
  } else if (score >= 0.6 && topScore >= 0.7) {
    level = 'medium';
    reason = `Relevant knowledge found (${(topScore * 100).toFixed(0)}% relevance)`;
    suggestFallback = false;
  } else if (score >= 0.4 || topScore >= 0.6) {
    level = 'low';
    reason = `Partial match found (${(topScore * 100).toFixed(0)}% relevance)`;
    suggestFallback = true;
  } else {
    level = 'none';
    reason = `No strong matches (best: ${(topScore * 100).toFixed(0)}%)`;
    suggestFallback = true;
  }

  return { level, score, reason, suggestFallback };
}

/**
 * Re-rank search results using Reciprocal Rank Fusion (RRF)
 * Combines vector similarity with keyword/BM25-style scoring
 * 
 * RRF Formula: score = Σ 1/(k + rank_i) for each ranking
 * 
 * @param results - Initial search results
 * @param query - Original query for additional matching
 * @param topK - Number of results to return
 * @returns Re-ranked and truncated results
 */
/**
 * Escape special regex characters to prevent RegExp errors
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rerankResults(
  results: VectorSearchResult[],
  query: string,
  topK: number
): VectorSearchResult[] {
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
  const k = 60; // RRF constant (60 is commonly used)

  // Step 1: Get vector rank (already sorted by vector similarity)
  const vectorRanks = new Map<string, number>();
  results.forEach((r, idx) => vectorRanks.set(r.id, idx + 1));

  // Step 2: Calculate keyword/BM25-style scores and rank
  const keywordScores = results.map(result => {
    const contentLower = result.content.toLowerCase();
    let keywordScore = 0;

    // Term frequency scoring
    for (const word of queryWords) {
      try {
        // Escape regex special characters to prevent errors
        const escapedWord = escapeRegExp(word);
        const regex = new RegExp(escapedWord, 'gi');
        const matches = contentLower.match(regex);
        if (matches) {
          // TF-IDF inspired: log(1 + tf)
          keywordScore += Math.log(1 + matches.length);
        }
      } catch (regexError) {
        // If regex still fails somehow, skip this word silently
      }
    }

    // Exact phrase match bonus
    if (contentLower.includes(queryLower)) {
      keywordScore += 3.0;
    }

    // Partial phrase match (consecutive words)
    for (let i = 0; i < queryWords.length - 1; i++) {
      const phrase = queryWords.slice(i, i + 2).join(' ');
      if (contentLower.includes(phrase)) {
        keywordScore += 1.5;
      }
    }

    return { id: result.id, keywordScore };
  });

  // Sort by keyword score to get keyword ranks
  const sortedByKeyword = [...keywordScores].sort((a, b) => b.keywordScore - a.keywordScore);
  const keywordRanks = new Map<string, number>();
  sortedByKeyword.forEach((r, idx) => keywordRanks.set(r.id, idx + 1));

  // Step 3: Apply RRF fusion
  const rrfScores = results.map(result => {
    const vectorRank = vectorRanks.get(result.id) || results.length;
    const keywordRank = keywordRanks.get(result.id) || results.length;

    // RRF score (weight vector higher since it's semantic)
    const vectorRRF = 1 / (k + vectorRank);
    const keywordRRF = 1 / (k + keywordRank);
    
    // Weighted combination: 70% vector, 30% keyword
    let rrfScore = (vectorRRF * 0.7) + (keywordRRF * 0.3);

    // Normalize to 0-1 range based on original vector score
    // This preserves the semantic similarity meaning
    const normalizedScore = result.score * (1 + rrfScore * 0.2);

    // Slight boost for knowledge items (more authoritative)
    const sourceBoost = result.sourceType === 'knowledge' ? 0.02 : 0;

    // Cap at 1.0
    const finalScore = Math.min(1.0, normalizedScore + sourceBoost);

    return {
      ...result,
      score: finalScore,
    };
  });

  // Sort by final score and return top K
  return rrfScores
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * Build context string from search results for LLM prompt
 * Uses contextual compression to prioritize most relevant sentences.
 * DEDUPLICATES near-identical content to avoid wasting context window.
 * DETECTS CONFLICTS and adds warnings when different sources disagree.
 * 
 * @param results - Search results to include in context
 * @returns Object with formatted context string and detected conflicts
 */
function buildContextString(results: VectorSearchResult[]): { context: string; conflicts: RAGConflictInfo[] } {
  if (results.length === 0) {
    return { context: '', conflicts: [] };
  }

  // DEDUP + CONFLICT DETECTION: Remove true duplicates, flag potential conflicts
  const dedupedResults = deduplicateResults(results);

  // Collect conflict groups for warning injection
  const conflictGroups = new Map<number, DedupResult[]>();
  for (const r of dedupedResults) {
    if (r._conflictGroup) {
      if (!conflictGroups.has(r._conflictGroup)) {
        conflictGroups.set(r._conflictGroup, []);
      }
      conflictGroups.get(r._conflictGroup)!.push(r);
    }
  }

  // Extract conflict metadata for reporting
  const conflicts: RAGConflictInfo[] = [];
  for (const [, groupItems] of conflictGroups) {
    if (groupItems.length >= 2) {
      conflicts.push({
        source1: groupItems[0].source || 'tidak diketahui',
        source2: groupItems[1].source || 'tidak diketahui',
        similarityScore: 0, // Will be filled by dedup caller if needed
        contentSnippet1: groupItems[0].content.substring(0, 200),
        contentSnippet2: groupItems[1].content.substring(0, 200),
      });
    }
  }

  let context = 'RELEVANT KNOWLEDGE:\n\n';

  // If conflicts exist, prepend a conflict warning header
  if (conflictGroups.size > 0) {
    context += `⚠️ PERHATIAN: Ditemukan ${conflictGroups.size} kelompok data yang BERBEDA dari sumber berbeda.\n`;
    context += `Jika ada perbedaan data, tampilkan SEMUA versi dan beri tahu user bahwa ada perbedaan.\n\n`;
  }

  let totalLength = context.length;
  let entryIndex = 0;
  const renderedConflictGroups = new Set<number>();

  for (let i = 0; i < dedupedResults.length; i++) {
    const result = dedupedResults[i];
    const sourceLabel = result.sourceType === 'knowledge' 
      ? `[${result.metadata?.category?.toUpperCase() || 'INFO'}]`
      : `[DOC: ${result.metadata?.sectionTitle || result.source}]`;

    // Add conflict marker if this result is part of a conflict group
    let conflictMarker = '';
    if (result._conflictGroup) {
      // Only show the conflict intro once per group
      if (!renderedConflictGroups.has(result._conflictGroup)) {
        renderedConflictGroups.add(result._conflictGroup);
        conflictMarker = `⚠️ [KONFLIK DATA - Ada ${conflictGroups.get(result._conflictGroup)!.length} sumber berbeda tentang topik ini]\n`;
      }
      // Mark each conflicting item with its source
      conflictMarker += `[SUMBER: ${result.source || 'tidak diketahui'}] `;
    }

    // Compress long content by keeping first N sentences
    const compressedContent = compressContent(result.content, 600);

    entryIndex++;
    const entry = `${conflictMarker}${entryIndex}. ${sourceLabel}\n${compressedContent}\n\n`;

    // Check if adding this entry exceeds max length
    if (totalLength + entry.length > MAX_CONTEXT_LENGTH) {
      context += `... (${dedupedResults.length - i} more results truncated)\n`;
      break;
    }

    context += entry;
    totalLength += entry.length;
  }

  return { context: context.trim(), conflicts };
}

/**
 * Deduplicate search results by content similarity AND detect conflicts.
 * 
 * Three tiers of similarity:
 * - Jaccard >= 0.70 → TRUE DUPLICATE: same info repeated. Remove the lower-scored one.
 * - Jaccard 0.35–0.69 → POTENTIAL CONFLICT: similar topic but different data.
 *   Keep BOTH and mark them with _conflictGroup so buildContextString can warn the user.
 * - Jaccard < 0.35 → UNRELATED: different topics. Keep both as-is.
 * 
 * This prevents duplicate noise while ensuring conflicting data (e.g., different
 * kepala desa names across two files) is shown to the user with a disclaimer.
 */
interface DedupResult extends VectorSearchResult {
  /** If set, results sharing the same _conflictGroup discuss the same topic but contain different data */
  _conflictGroup?: number;
}

function deduplicateResults(results: VectorSearchResult[]): DedupResult[] {
  if (results.length <= 1) return results;

  const DUPLICATE_THRESHOLD = 0.70;  // ≥70% overlap = true duplicate (remove)
  const CONFLICT_THRESHOLD = 0.35;   // 35-69% overlap = potential conflict (keep + flag)
  const deduped: DedupResult[] = [];
  const wordSets: Set<string>[] = [];
  let nextConflictGroup = 1;

  for (const result of results) {
    const words = new Set(
      result.content.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2)
    );

    // Check against all already-accepted results
    let isDuplicate = false;
    let conflictIndex = -1;
    let maxJaccard = 0;

    for (let j = 0; j < wordSets.length; j++) {
      const existingWords = wordSets[j];
      const intersection = new Set([...words].filter(w => existingWords.has(w)));
      const union = new Set([...words, ...existingWords]);
      const jaccard = union.size > 0 ? intersection.size / union.size : 0;

      if (jaccard >= DUPLICATE_THRESHOLD) {
        // True duplicate — skip this result entirely
        isDuplicate = true;
        break;
      }

      if (jaccard >= CONFLICT_THRESHOLD && jaccard > maxJaccard) {
        // Potential conflict — same topic, different data
        conflictIndex = j;
        maxJaccard = jaccard;
      }
    }

    if (isDuplicate) continue;

    // If conflict detected with an existing result, assign them the same conflict group
    if (conflictIndex >= 0) {
      const existingResult = deduped[conflictIndex];
      if (!existingResult._conflictGroup) {
        existingResult._conflictGroup = nextConflictGroup++;
      }
      const conflictResult: DedupResult = { ...result, _conflictGroup: existingResult._conflictGroup };
      deduped.push(conflictResult);
      wordSets.push(words);

      logger.info('Conflict detected between RAG results', {
        group: existingResult._conflictGroup,
        source1: existingResult.source,
        source2: result.source,
        jaccard: maxJaccard.toFixed(2),
      });
    } else {
      deduped.push(result);
      wordSets.push(words);
    }
  }

  const removed = results.length - deduped.length;
  const conflicts = deduped.filter(r => r._conflictGroup).length;
  if (removed > 0 || conflicts > 0) {
    logger.debug('Dedup + conflict detection complete', {
      before: results.length,
      after: deduped.length,
      removed,
      conflictingItems: conflicts,
    });
  }

  return deduped;
}

/**
 * Compress content to max length while preserving sentence boundaries
 * Prioritizes first sentences (usually most important in knowledge base)
 */
function compressContent(content: string, maxLength: number): string {
  if (content.length <= maxLength) {
    return content;
  }

  // Split by sentence endings
  const sentences = content.split(/(?<=[.!?。])\s+/);
  
  let compressed = '';
  for (const sentence of sentences) {
    if (compressed.length + sentence.length + 1 > maxLength) {
      // Add ellipsis if we're truncating
      if (compressed.length > 0) {
        compressed = compressed.trim() + '...';
      }
      break;
    }
    compressed += (compressed ? ' ' : '') + sentence;
  }

  return compressed || content.substring(0, maxLength - 3) + '...';
}

/**
 * Check if a query likely needs knowledge base lookup
 * Combines pattern matching for both pre-fetch decision and RAG skip logic
 * 
 * @param query - User's message
 * @returns Whether the query likely needs knowledge lookup
 */
export async function shouldRetrieveContext(query: string): Promise<boolean> {
  // Use classifyQueryIntent internally for consistency
  const result = await classifyQueryIntent(query);
  return result.intent !== 'skip';
}

// Export classifyQueryIntent for external use (e.g., analytics, debugging)
export { classifyQueryIntent };

