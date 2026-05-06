/**
 * Hybrid Search Service
 * 
 * Combines Vector Search (semantic) + Keyword Search (BM25-style) using
 * Reciprocal Rank Fusion (RRF) for better retrieval accuracy.
 * 
 * Benefits:
 * - Vector search: Captures semantic meaning
 * - Keyword search: Exact matches, acronyms, specific terms
 * - RRF: Combines both rankings fairly
 * 
 * This improves retrieval for:
 * - Exact term matches (SKD, SKTM, NIK)
 * - Acronyms and abbreviations
 * - Specific names and locations
 */

import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import logger from '../utils/logger';
import { VectorSearchResult, VectorSearchOptions } from '../types/embedding.types';
import { generateEmbedding } from './embedding.service';
import { searchVectors } from './vector-db.service';

// ==================== TYPES ====================

export interface HybridSearchOptions extends VectorSearchOptions {
  vectorWeight?: number;    // Weight for vector results (default 0.6)
  keywordWeight?: number;   // Weight for keyword results (default 0.4)
  useQueryExpansion?: boolean;
}

export interface HybridSearchResult extends VectorSearchResult {
  vectorRank?: number;
  keywordRank?: number;
  rrfScore: number;
  matchType: 'vector' | 'keyword' | 'both';
  vectorScore?: number;
  keywordScore?: number;
}

// ==================== KEYWORD SEARCH ====================

/**
 * Full-text keyword search using PostgreSQL ts_vector
 * Falls back to ILIKE if ts_vector not available
 */
export async function searchKeywords(
  query: string,
  options: VectorSearchOptions = {}
): Promise<VectorSearchResult[]> {
  const {
    topK = 15, // Fase 1.2: bigger candidate pool
    categories,
    sourceTypes = ['knowledge', 'document'],
    villageId,
  } = options;

  const results: VectorSearchResult[] = [];
  const knowledgeScopeFilter = villageId
    ? Prisma.sql`((village_id = ${villageId} AND scope = 'village' AND is_global = FALSE) OR (scope = 'global' AND is_global = TRUE))`
    : Prisma.sql`(scope = 'global' AND is_global = TRUE)`;
  const documentScopeFilter = knowledgeScopeFilter;
  
  // Prepare search terms
  const searchTerms = prepareSearchTerms(query);
  const tsQuery = searchTerms.join(' | '); // OR search
  // Build individual term ILIKE patterns for better partial matching
  // instead of matching the entire query string at once
  const ilikeTerms = searchTerms.length > 0 ? searchTerms.map(t => `%${t}%`) : [`%${query.toLowerCase()}%`];
  const ilikeTerm = `%${query.toLowerCase()}%`;

  try {
    // Search knowledge base with full-text search
    if (sourceTypes.includes('knowledge')) {
      // Build dynamic ILIKE conditions for individual search terms
      const termConditions = ilikeTerms.map(term => 
        Prisma.sql`LOWER(content) LIKE ${term} OR LOWER(title) LIKE ${term}`
      );
      const combinedTermCondition = termConditions.length > 0
        ? Prisma.sql`(${Prisma.join(termConditions, ' OR ')})`
        : Prisma.sql`FALSE`;

      const knowledgeResults = await prisma.$queryRaw<any[]>`
        SELECT 
          id,
          title,
          content,
          category,
          keywords,
          'knowledge' as source_type,
          quality_score,
          -- Fase 1.3: Enhanced relevance scoring with trigram similarity
          (
            CASE WHEN LOWER(title) LIKE ${ilikeTerm} THEN 3.0 ELSE 0 END +
            CASE WHEN LOWER(content) LIKE ${ilikeTerm} THEN 2.0 ELSE 0 END +
            CASE WHEN ${query.toLowerCase()} = ANY(LOWER(keywords::text)::text[]) THEN 2.5 ELSE 0 END +
            COALESCE(similarity(LOWER(title), ${query.toLowerCase()}), 0) * 2.0 +
            COALESCE(similarity(LOWER(content), ${query.toLowerCase()}), 0) * 1.0 +
            COALESCE(
              ts_rank(
                to_tsvector('simple', COALESCE(title, '') || ' ' || COALESCE(content, '')),
                plainto_tsquery('simple', ${query})
              ),
              0
            )
          ) as relevance_score
        FROM ai.knowledge_vectors
        WHERE
          (${combinedTermCondition}
          OR to_tsvector('simple', COALESCE(title, '') || ' ' || COALESCE(content, ''))
             @@ plainto_tsquery('simple', ${query})
          OR similarity(LOWER(title || ' ' || content), ${query.toLowerCase()}) > 0.1)
          AND ${knowledgeScopeFilter}
        ORDER BY relevance_score DESC
        LIMIT ${topK}
      `;

      for (const row of knowledgeResults) {
        // village_id is already filtered in SQL WHERE clause
        // Categories are NOT used for filtering — NLU category names (e.g. "informasi_umum")
        // often don't match stored categories (e.g. "umum", "general"), causing false negatives.
        // Vector/keyword similarity is the primary relevance signal.

        results.push({
          id: row.id,
          content: row.content,
          score: Math.min(1, row.relevance_score / 5), // Normalize to 0-1
          source: row.title,
          sourceType: 'knowledge',
          metadata: {
            category: row.category,
            keywords: row.keywords,
            qualityScore: row.quality_score,
          },
        });
      }
    }

    // Search document chunks
    if (sourceTypes.includes('document')) {
      // Build dynamic ILIKE conditions for individual search terms
      const docTermConditions = ilikeTerms.map(term =>
        Prisma.sql`LOWER(content) LIKE ${term} OR LOWER(COALESCE(section_title, '')) LIKE ${term} OR LOWER(COALESCE(document_title, '')) LIKE ${term}`
      );
      const combinedDocTermCondition = docTermConditions.length > 0
        ? Prisma.sql`(${Prisma.join(docTermConditions, ' OR ')})`
        : Prisma.sql`FALSE`;

      const documentResults = await prisma.$queryRaw<any[]>`
        SELECT
          id,
          document_id,
          chunk_index,
          content,
          document_title,
          category,
          section_title,
          provenance_json,
          'document' as source_type,
          -- Fase 1.3: Enhanced relevance scoring with trigram similarity
          (
            CASE WHEN LOWER(content) LIKE ${ilikeTerm} THEN 2.0 ELSE 0 END +
            CASE WHEN LOWER(document_title) LIKE ${ilikeTerm} THEN 1.5 ELSE 0 END +
            CASE WHEN LOWER(COALESCE(section_title, '')) LIKE ${ilikeTerm} THEN 2.5 ELSE 0 END +
            COALESCE(similarity(LOWER(COALESCE(section_title, '') || ' ' || content), ${query.toLowerCase()}), 0) * 1.5 +
            COALESCE(
              ts_rank(
                to_tsvector('simple', COALESCE(section_title, '') || ' ' || COALESCE(content, '')),
                plainto_tsquery('simple', ${query})
              ),
              0
            )
          ) as relevance_score
        FROM ai.document_vectors
        WHERE
          (${combinedDocTermCondition}
          OR to_tsvector('simple', COALESCE(section_title, '') || ' ' || COALESCE(content, ''))
             @@ plainto_tsquery('simple', ${query})
          OR similarity(LOWER(COALESCE(section_title, '') || ' ' || content), ${query.toLowerCase()}) > 0.1)
          AND ${documentScopeFilter}
        ORDER BY relevance_score DESC
        LIMIT ${topK}
      `;

      for (const row of documentResults) {
        // village_id is already filtered in SQL WHERE clause
        // Categories NOT used for filtering — see knowledge search comment above.

        results.push({
          id: row.id,
          content: row.content,
          score: Math.min(1, row.relevance_score / 3),
          source: row.document_title || row.document_id,
          sourceType: 'document',
          metadata: {
            documentId: row.document_id,
            chunkIndex: row.chunk_index,
            category: row.category,
            sectionTitle: row.section_title,
            provenance: row.provenance_json,
          },
        });
      }
    }

    logger.debug('[HybridSearch] Keyword search completed', {
      query: query.substring(0, 50),
      resultCount: results.length,
    });

    return results;
  } catch (error: any) {
    logger.error('[HybridSearch] Keyword search failed', { error: error.message });
    return [];
  }
}

/**
 * Prepare search terms from query
 * Handles Indonesian language specifics with expanded stopwords and basic stemming
 */
function prepareSearchTerms(query: string): string[] {
  const normalizedQuery = query.toLowerCase();

  // Expanded Indonesian stop words (Fase 1.3)
  const stopWords = new Set([
    'di', 'ke', 'ya', 'yg', 'apa', 'ini', 'itu', 'dan', 'atau', 'yang', 'dari',
    'untuk', 'dengan', 'pada', 'adalah', 'akan', 'juga', 'sudah', 'belum', 'bisa',
    'ada', 'tidak', 'saya', 'kami', 'kita', 'mereka', 'dia', 'anda', 'bapak', 'ibu',
    'pak', 'bu', 'mas', 'mbak', 'mau', 'minta', 'tolong', 'mohon', 'dong', 'deh',
    'kok', 'sih', 'kan', 'lah', 'nih', 'tuh', 'gak', 'ga', 'nggak', 'enggak',
    'gimana', 'gimna', 'bgmn', 'bagaimana', 'apakah', 'boleh', 'biar', 'supaya',
    'kalau', 'kalo', 'jika', 'bila', 'tapi', 'tetapi', 'namun', 'sedang', 'lagi',
    'sedangkan', 'serta', 'maupun', 'baik', 'terima', 'kasih', 'makasih', 'terimakasih',
  ]);

  const terms = query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !stopWords.has(t));

  // Basic Indonesian stemming: strip common prefixes/suffixes for broader matching
  const expanded: string[] = [...terms];

  const phraseExpansions: Array<{ pattern: RegExp; terms: string[] }> = [
    {
      pattern: /\b(alamat|lokasi|letak|dimana|di mana|maps|gmaps|peta|kantornya dimana)\b/,
      terms: ['alamat', 'lokasi', 'kantor', 'maps', 'gmaps'],
    },
    {
      pattern: /\b(jam|buka|tutup|operasional|hari kerja|sabtu|minggu)\b/,
      terms: ['jam', 'operasional', 'buka', 'tutup', 'hari', 'kerja'],
    },
    {
      pattern: /\b(biaya|tarif|gratis|bayar|pembayaran|retribusi)\b/,
      terms: ['biaya', 'tarif', 'gratis', 'bayar'],
    },
    {
      pattern: /\b(syarat|persyaratan|dokumen|berkas|formulir)\b/,
      terms: ['syarat', 'persyaratan', 'dokumen', 'berkas', 'formulir'],
    },
    {
      pattern: /\b(kontak|telepon|telp|nomor|wa|whatsapp|hotline|hubungi)\b/,
      terms: ['kontak', 'telepon', 'nomor', 'hubungi'],
    },
  ];

  for (const expansion of phraseExpansions) {
    if (expansion.pattern.test(normalizedQuery)) {
      expanded.push(...expansion.terms);
    }
  }

  const acronymExpansions: Record<string, string[]> = {
    ktp: ['ktp', 'kartu', 'tanda', 'penduduk'],
    kk: ['kk', 'kartu', 'keluarga'],
    skck: ['skck', 'surat', 'catatan', 'kepolisian'],
    sktm: ['sktm', 'surat', 'tidak', 'mampu'],
    nik: ['nik', 'kependudukan'],
    bpjs: ['bpjs', 'jaminan', 'kesehatan'],
    umkm: ['umkm', 'usaha', 'mikro'],
  };

  for (const term of terms) {
    if (acronymExpansions[term]) {
      expanded.push(...acronymExpansions[term]);
    }
  }

  for (const term of terms) {
    // Strip common prefixes: ber-, me-, men-, mem-, meng-, meny-, pe-, pen-, pem-, peng-, peny-, per-, se-, di-, ke-, ter-
    let stem = term;
    const prefixes = ['meny', 'meng', 'mem', 'men', 'me', 'ber', 'peny', 'peng', 'pem', 'pen', 'pe', 'per', 'se', 'ter', 'di', 'ke'];
    for (const prefix of prefixes) {
      if (stem.startsWith(prefix) && stem.length > prefix.length + 2) {
        const stripped = stem.slice(prefix.length);
        if (stripped.length >= 3) {
          expanded.push(stripped);
          break;
        }
      }
    }
    // Strip common suffixes: -kan, -an, -i, -nya
    const suffixes = ['kan', 'nya', 'an'];
    for (const suffix of suffixes) {
      if (stem.endsWith(suffix) && stem.length > suffix.length + 2) {
        const stripped = stem.slice(0, -suffix.length);
        if (stripped.length >= 3) {
          expanded.push(stripped);
          break;
        }
      }
    }
  }

  return [...new Set(expanded)];
}

// ==================== RECIPROCAL RANK FUSION ====================

/**
 * Combine vector and keyword results using RRF
 * RRF Score = Σ 1/(k + rank_i) for each ranking
 * 
 * @param vectorResults - Results from vector search
 * @param keywordResults - Results from keyword search
 * @param vectorWeight - Weight for vector ranking (default 0.6)
 * @param keywordWeight - Weight for keyword ranking (default 0.4)
 * @param k - RRF constant (default 60)
 */
export function reciprocalRankFusion(
  vectorResults: VectorSearchResult[],
  keywordResults: VectorSearchResult[],
  vectorWeight: number = 0.6,
  keywordWeight: number = 0.4,
  k: number = 60
): HybridSearchResult[] {
  // Create maps for quick lookup
  const vectorRanks = new Map<string, number>();
  const keywordRanks = new Map<string, number>();
  const allResults = new Map<string, VectorSearchResult>();
  const vectorScores = new Map<string, number>();
  const keywordScores = new Map<string, number>();

  // Assign vector ranks
  vectorResults.forEach((result, index) => {
    vectorRanks.set(result.id, index + 1);
    vectorScores.set(result.id, result.score);
    allResults.set(result.id, result);
  });

  // Assign keyword ranks
  keywordResults.forEach((result, index) => {
    keywordRanks.set(result.id, index + 1);
    keywordScores.set(result.id, result.score);
    if (!allResults.has(result.id)) {
      allResults.set(result.id, result);
    }
  });

  // Calculate RRF scores
  const hybridResults: HybridSearchResult[] = [];
  const maxRank = Math.max(vectorResults.length, keywordResults.length) + 1;

  for (const [id, result] of allResults) {
    const vectorRank = vectorRanks.get(id) || maxRank;
    const keywordRank = keywordRanks.get(id) || maxRank;

    // RRF formula with weights
    const vectorRRF = vectorWeight / (k + vectorRank);
    const keywordRRF = keywordWeight / (k + keywordRank);
    const rrfScore = vectorRRF + keywordRRF;

    // Determine match type
    let matchType: 'vector' | 'keyword' | 'both';
    if (vectorRanks.has(id) && keywordRanks.has(id)) {
      matchType = 'both';
    } else if (vectorRanks.has(id)) {
      matchType = 'vector';
    } else {
      matchType = 'keyword';
    }

    // Combine scores - use original score weighted by RRF
    const originalScore = result.score;
    const combinedScore = Math.min(1, originalScore * (1 + rrfScore * 10));

    hybridResults.push({
      ...result,
      score: combinedScore,
      vectorRank: vectorRanks.get(id),
      keywordRank: keywordRanks.get(id),
      rrfScore,
      matchType,
      vectorScore: vectorScores.get(id),
      keywordScore: keywordScores.get(id),
    });
  }

  // Sort by combined score
  hybridResults.sort((a, b) => b.score - a.score);

  return hybridResults;
}

// ==================== MAIN HYBRID SEARCH ====================

/**
 * Perform hybrid search combining vector and keyword search
 */
export async function hybridSearch(
  query: string,
  options: HybridSearchOptions = {}
): Promise<HybridSearchResult[]> {
  const {
    topK = 5,
    minScore = 0.65,
    categories,
    sourceTypes = ['knowledge', 'document'],
    villageId,
    vectorWeight = 0.6,
    keywordWeight = 0.4,
    useQueryExpansion = true,
  } = options;

  const startTime = Date.now();

  try {
    // Generate embedding for vector search
    const embedding = await generateEmbedding(query, {
      taskType: 'RETRIEVAL_QUERY',
      outputDimensionality: 768,
      useCache: true,
      context: {
        village_id: villageId || null,
      },
    });

    // Run both searches in parallel
    const [vectorResults, keywordResults] = await Promise.all([
      searchVectors(embedding.values, {
        topK: topK * 2, // Get more for fusion
        minScore: Math.max(minScore * 0.8, 0.45), // Lower threshold for fusion, but cap at 0.45 floor
        categories,
        sourceTypes,
        villageId,
      }),
      searchKeywords(query, {
        topK: topK * 2,
        categories,
        sourceTypes,
        villageId,
      }),
    ]);

    // Combine using RRF
    const fusedResults = reciprocalRankFusion(
      vectorResults,
      keywordResults,
      vectorWeight,
      keywordWeight
    );

    // Recall-first, threshold-late:
    // keep the top fused candidates here and let the downstream reranker/final
    // thresholding decide what survives. This avoids dropping borderline items
    // before semantic rerank has a chance to promote them.
    const candidateResults = fusedResults.slice(0, topK);

    const searchTimeMs = Date.now() - startTime;

    logger.info('[HybridSearch] Search completed', {
      query: query.substring(0, 50),
      vectorCount: vectorResults.length,
      keywordCount: keywordResults.length,
      fusedCount: fusedResults.length,
      candidateCount: candidateResults.length,
      requestedMinScore: minScore,
      searchTimeMs,
      topScore: candidateResults[0]?.score.toFixed(3),
      matchTypes: candidateResults.map(r => r.matchType),
    });

    return candidateResults;
  } catch (error: any) {
    logger.error('[HybridSearch] Search failed', { error: error.message });
    return [];
  }
}

// ==================== EXPORTS ====================

export default {
  hybridSearch,
  searchKeywords,
  reciprocalRankFusion,
};
