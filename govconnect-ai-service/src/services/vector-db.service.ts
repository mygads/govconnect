/**
 * Vector Database Service for GovConnect AI
 * 
 * Handles all vector storage and search operations using local PostgreSQL + pgvector
 * This replaces the old vector-store.service.ts that relied on Dashboard API
 * 
 * Features:
 * - Store/update/delete knowledge embeddings
 * - Store/update/delete document chunk embeddings
 * - Semantic search using cosine similarity (pgvector)
 * - Quality scoring and usage tracking
 */

import prisma from '../lib/prisma';
import logger from '../utils/logger';
import { Prisma } from '@prisma/client';
import {
  VectorSearchResult,
  VectorSearchOptions,
} from '../types/embedding.types';

// ==================== KNOWLEDGE VECTORS ====================

export interface KnowledgeVectorInput {
  id: string;
  villageId?: string | null;
  title: string;
  content: string;
  category: string;
  keywords: string[];
  embedding: number[];
  embeddingModel?: string;
  qualityScore?: number;
}

/**
 * Add or update a knowledge vector
 * Used when admin creates or edits knowledge in Dashboard
 */
export async function upsertKnowledgeVector(input: KnowledgeVectorInput): Promise<void> {
  const {
    id,
    villageId = null,
    title,
    content,
    category,
    keywords,
    embedding,
    embeddingModel = 'gemini-embedding-001',
    qualityScore = 1.0,
  } = input;

  try {
    // Convert embedding array to pgvector format
    const embeddingStr = `[${embedding.join(',')}]`;

    await prisma.$executeRaw`
      INSERT INTO knowledge_vectors (
        id, village_id, title, content, category, keywords, 
        embedding, embedding_model, quality_score,
        created_at, updated_at
      ) VALUES (
        ${id}, ${villageId}, ${title}, ${content}, ${category}, ${keywords},
        ${embeddingStr}::vector, ${embeddingModel}, ${qualityScore},
        NOW(), NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        village_id = EXCLUDED.village_id,
        title = EXCLUDED.title,
        content = EXCLUDED.content,
        category = EXCLUDED.category,
        keywords = EXCLUDED.keywords,
        embedding = EXCLUDED.embedding,
        embedding_model = EXCLUDED.embedding_model,
        quality_score = EXCLUDED.quality_score,
        updated_at = NOW()
    `;

    logger.info('Knowledge vector upserted', { id, category });
  } catch (error: any) {
    logger.error('Failed to upsert knowledge vector', { id, error: error.message });
    throw error;
  }
}

/**
 * Delete a knowledge vector (and all its AI-generated sub-chunks)
 * When AI splits a long knowledge entry into multiple chunks,
 * they are stored as id, id_1, id_2, etc.
 * This deletes all of them.
 */
export async function deleteKnowledgeVector(id: string): Promise<boolean> {
  try {
    const likePattern = `${id}_%`;
    const result = await prisma.$executeRaw`
      DELETE FROM knowledge_vectors WHERE id = ${id} OR id LIKE ${likePattern}
    `;
    
    logger.info('Knowledge vector(s) deleted', { id, deletedCount: result });
    return result > 0;
  } catch (error: any) {
    logger.error('Failed to delete knowledge vector', { id, error: error.message });
    return false;
  }
}

/**
 * Get knowledge vector by ID
 */
export async function getKnowledgeVector(id: string) {
  try {
    const result = await prisma.$queryRaw<any[]>`
      SELECT id, title, content, category, keywords, 
             embedding::text as embedding_text, embedding_model,
             quality_score, usage_count, retrieval_count, last_retrieved,
             created_at, updated_at
      FROM knowledge_vectors
      WHERE id = ${id}
    `;
    
    return result[0] || null;
  } catch (error: any) {
    logger.error('Failed to get knowledge vector', { id, error: error.message });
    return null;
  }
}

/**
 * Get embedding status for multiple knowledge IDs
 */
export async function getKnowledgeEmbeddingStatuses(ids: string[]) {
  if (!ids.length) return [];

  try {
    const results = await prisma.$queryRaw<Array<{ id: string; embedding_model: string | null; updated_at: Date }>>`
      SELECT id, embedding_model, updated_at
      FROM knowledge_vectors
      WHERE id IN (${Prisma.join(ids)})
    `;

    return results || [];
  } catch (error: any) {
    logger.error('Failed to get knowledge embedding statuses', { error: error.message });
    return [];
  }
}

// ==================== DOCUMENT VECTORS ====================

export interface DocumentChunkInput {
  documentId: string;
  villageId?: string | null;
  chunkIndex: number;
  content: string;
  embedding: number[];
  documentTitle?: string;
  category?: string;
  pageNumber?: number;
  sectionTitle?: string;
  embeddingModel?: string;
}

/**
 * Add document chunk vectors (batch)
 * Used when admin uploads a document
 */
export async function addDocumentChunks(chunks: DocumentChunkInput[]): Promise<void> {
  if (chunks.length === 0) return;

  try {
    // Use transaction for batch insert
    await prisma.$transaction(async (tx) => {
      for (const chunk of chunks) {
        const embeddingStr = `[${chunk.embedding.join(',')}]`;
        
        await tx.$executeRaw`
          INSERT INTO document_vectors (
            id, document_id, village_id, chunk_index, content,
            document_title, category, page_number, section_title,
            embedding, embedding_model, created_at
          ) VALUES (
            ${`${chunk.documentId}_${chunk.chunkIndex}`},
            ${chunk.documentId}, ${chunk.villageId || null}, ${chunk.chunkIndex}, ${chunk.content},
            ${chunk.documentTitle || null}, ${chunk.category || null}, 
            ${chunk.pageNumber || null}, ${chunk.sectionTitle || null},
            ${embeddingStr}::vector, ${chunk.embeddingModel || 'gemini-embedding-001'},
            NOW()
          )
          ON CONFLICT (document_id, chunk_index) DO UPDATE SET
            content = EXCLUDED.content,
            document_title = EXCLUDED.document_title,
            category = EXCLUDED.category,
            page_number = EXCLUDED.page_number,
            section_title = EXCLUDED.section_title,
            embedding = EXCLUDED.embedding,
            village_id = EXCLUDED.village_id
        `;
      }
    });

    logger.info('Document chunks added', { 
      documentId: chunks[0].documentId, 
      chunkCount: chunks.length 
    });
  } catch (error: any) {
    logger.error('Failed to add document chunks', { error: error.message });
    throw error;
  }
}

/**
 * Delete all vectors for a document
 * Used when admin deletes a document
 */
export async function deleteDocumentVectors(documentId: string): Promise<boolean> {
  try {
    const result = await prisma.$executeRaw`
      DELETE FROM document_vectors WHERE document_id = ${documentId}
    `;
    
    logger.info('Document vectors deleted', { documentId, chunksDeleted: result });
    return result > 0;
  } catch (error: any) {
    logger.error('Failed to delete document vectors', { documentId, error: error.message });
    return false;
  }
}


// ==================== VECTOR SEARCH ====================

interface VectorSearchRow {
  id: string;
  content: string;
  title: string;
  category: string;
  keywords: string[];
  similarity: number;
  source_type: string;
  document_id?: string;
  chunk_index?: number;
  page_number?: number;
  section_title?: string;
  quality_score?: number;
}

/**
 * Search for similar vectors using cosine similarity
 * Searches both knowledge and document vectors
 */
export async function searchVectors(
  queryEmbedding: number[],
  options: VectorSearchOptions = {}
): Promise<VectorSearchResult[]> {
  const {
    topK = 5,
    minScore = 0.7,
    categories,
    sourceTypes = ['knowledge', 'document'],
    villageId,
  } = options;

  const startTime = Date.now();
  const embeddingStr = `[${queryEmbedding.join(',')}]`;
  const results: VectorSearchResult[] = [];

  try {
    // Search knowledge vectors
    if (sourceTypes.includes('knowledge')) {
      let knowledgeQuery = Prisma.sql`
        SELECT 
          id,
          content,
          title,
          category,
          keywords,
          1 - (embedding <=> ${embeddingStr}::vector) as similarity,
          'knowledge' as source_type,
          quality_score
        FROM knowledge_vectors
        WHERE 1 - (embedding <=> ${embeddingStr}::vector) >= ${minScore}
      `;

      if (villageId) {
        knowledgeQuery = Prisma.sql`
          SELECT 
            id,
            content,
            title,
            category,
            keywords,
            1 - (embedding <=> ${embeddingStr}::vector) as similarity,
            'knowledge' as source_type,
            quality_score
          FROM knowledge_vectors
          WHERE 1 - (embedding <=> ${embeddingStr}::vector) >= ${minScore}
            AND (village_id = ${villageId} OR village_id IS NULL)
        `;
      }

      if (categories && categories.length > 0) {
        knowledgeQuery = Prisma.sql`
          SELECT 
            id,
            content,
            title,
            category,
            keywords,
            1 - (embedding <=> ${embeddingStr}::vector) as similarity,
            'knowledge' as source_type,
            quality_score
          FROM knowledge_vectors
          WHERE 1 - (embedding <=> ${embeddingStr}::vector) >= ${minScore}
            AND category = ANY(${categories})
        `;
      }

      if (villageId && categories && categories.length > 0) {
        knowledgeQuery = Prisma.sql`
          SELECT 
            id,
            content,
            title,
            category,
            keywords,
            1 - (embedding <=> ${embeddingStr}::vector) as similarity,
            'knowledge' as source_type,
            quality_score
          FROM knowledge_vectors
          WHERE 1 - (embedding <=> ${embeddingStr}::vector) >= ${minScore}
            AND category = ANY(${categories})
            AND (village_id = ${villageId} OR village_id IS NULL)
        `;
      }

      const knowledgeResults = await prisma.$queryRaw<VectorSearchRow[]>`
        ${knowledgeQuery}
        ORDER BY similarity DESC
        LIMIT ${topK}
      `;

      for (const row of knowledgeResults) {
        results.push({
          id: row.id,
          content: row.content,
          score: row.similarity,
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

    // Search document vectors
    if (sourceTypes.includes('document')) {
      let documentQuery = Prisma.sql`
        SELECT 
          id,
          content,
          document_title as title,
          category,
          document_id,
          chunk_index,
          page_number,
          section_title,
          1 - (embedding <=> ${embeddingStr}::vector) as similarity,
          'document' as source_type
        FROM document_vectors
        WHERE 1 - (embedding <=> ${embeddingStr}::vector) >= ${minScore}
      `;

      if (villageId) {
        documentQuery = Prisma.sql`
          SELECT 
            id,
            content,
            document_title as title,
            category,
            document_id,
            chunk_index,
            page_number,
            section_title,
            1 - (embedding <=> ${embeddingStr}::vector) as similarity,
            'document' as source_type
          FROM document_vectors
          WHERE 1 - (embedding <=> ${embeddingStr}::vector) >= ${minScore}
            AND (village_id = ${villageId} OR village_id IS NULL)
        `;
      }

      if (categories && categories.length > 0) {
        documentQuery = Prisma.sql`
          SELECT 
            id,
            content,
            document_title as title,
            category,
            document_id,
            chunk_index,
            page_number,
            section_title,
            1 - (embedding <=> ${embeddingStr}::vector) as similarity,
            'document' as source_type
          FROM document_vectors
          WHERE 1 - (embedding <=> ${embeddingStr}::vector) >= ${minScore}
            AND category = ANY(${categories})
        `;
      }

      if (villageId && categories && categories.length > 0) {
        documentQuery = Prisma.sql`
          SELECT 
            id,
            content,
            document_title as title,
            category,
            document_id,
            chunk_index,
            page_number,
            section_title,
            1 - (embedding <=> ${embeddingStr}::vector) as similarity,
            'document' as source_type
          FROM document_vectors
          WHERE 1 - (embedding <=> ${embeddingStr}::vector) >= ${minScore}
            AND category = ANY(${categories})
            AND (village_id = ${villageId} OR village_id IS NULL)
        `;
      }

      const documentResults = await prisma.$queryRaw<VectorSearchRow[]>`
        ${documentQuery}
        ORDER BY similarity DESC
        LIMIT ${topK}
      `;

      for (const row of documentResults) {
        results.push({
          id: row.id,
          content: row.content,
          score: row.similarity,
          source: row.title || row.document_id || row.id,
          sourceType: 'document',
          metadata: {
            documentId: row.document_id,
            chunkIndex: row.chunk_index,
            pageNumber: row.page_number,
            sectionTitle: row.section_title,
            category: row.category,
          },
        });
      }
    }

    // Sort combined results by score and limit
    results.sort((a, b) => b.score - a.score);
    const finalResults = results.slice(0, topK);

    const endTime = Date.now();
    logger.info('Vector search completed', {
      resultsFound: finalResults.length,
      searchTimeMs: endTime - startTime,
      sourceTypes,
    });

    return finalResults;
  } catch (error: any) {
    logger.error('Vector search failed', { error: error.message });
    return [];
  }
}

// ==================== USAGE TRACKING ====================

/**
 * Record that a knowledge item was retrieved (for quality scoring)
 */
export async function recordKnowledgeRetrieval(knowledgeId: string): Promise<void> {
  try {
    await prisma.$executeRaw`
      UPDATE knowledge_vectors
      SET 
        retrieval_count = retrieval_count + 1,
        last_retrieved = NOW()
      WHERE id = ${knowledgeId}
    `;
  } catch (error: any) {
    logger.warn('Failed to record knowledge retrieval', { knowledgeId, error: error.message });
  }
}

/**
 * Record batch retrievals
 */
export async function recordBatchRetrievals(knowledgeIds: string[]): Promise<void> {
  if (knowledgeIds.length === 0) return;
  
  try {
    await prisma.$executeRaw`
      UPDATE knowledge_vectors
      SET 
        retrieval_count = retrieval_count + 1,
        last_retrieved = NOW()
      WHERE id = ANY(${knowledgeIds})
    `;
  } catch (error: any) {
    logger.warn('Failed to record batch retrievals', { error: error.message });
  }
}

/**
 * Increment usage count for a knowledge item
 */
export async function incrementKnowledgeUsage(knowledgeId: string): Promise<void> {
  try {
    await prisma.$executeRaw`
      UPDATE knowledge_vectors
      SET usage_count = usage_count + 1
      WHERE id = ${knowledgeId}
    `;
  } catch (error: any) {
    logger.warn('Failed to increment knowledge usage', { knowledgeId, error: error.message });
  }
}

// ==================== STATS ====================

/**
 * Get vector database statistics
 */
export async function getVectorDbStats(): Promise<{
  knowledgeCount: number;
  documentChunkCount: number;
  uniqueDocuments: number;
}> {
  try {
    const [knowledgeCount] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM knowledge_vectors
    `;
    
    const [documentStats] = await prisma.$queryRaw<[{ chunk_count: bigint; doc_count: bigint }]>`
      SELECT 
        COUNT(*) as chunk_count,
        COUNT(DISTINCT document_id) as doc_count
      FROM document_vectors
    `;

    return {
      knowledgeCount: Number(knowledgeCount.count),
      documentChunkCount: Number(documentStats.chunk_count),
      uniqueDocuments: Number(documentStats.doc_count),
    };
  } catch (error: any) {
    logger.error('Failed to get vector DB stats', { error: error.message });
    return {
      knowledgeCount: 0,
      documentChunkCount: 0,
      uniqueDocuments: 0,
    };
  }
}
