import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import logger from '../utils/logger';
import { config } from '../config/env';

export interface UserMemoryVectorInput {
  memoryEntryId: string;
  waUserId: string;
  villageId?: string | null;
  memoryType: string;
  content: string;
  importance: number;
  embedding: number[];
  embeddingModel?: string;
}

export interface UserMemoryVectorSearchOptions {
  waUserId: string;
  villageId?: string;
  memoryTypes?: string[];
  topK?: number;
  minScore?: number;
}

export interface UserMemoryVectorSearchResult {
  memoryEntryId: string;
  waUserId: string;
  villageId: string | null;
  memoryType: string;
  content: string;
  importance: number;
  similarity: number;
  createdAt: Date;
}

interface UserMemoryVectorRow {
  memory_entry_id: string;
  wa_user_id: string;
  village_id: string | null;
  memory_type: string;
  content: string;
  importance: number;
  similarity: number;
  created_at: Date;
}

export async function upsertUserMemoryVector(input: UserMemoryVectorInput): Promise<void> {
  const embeddingStr = `[${input.embedding.join(',')}]`;

  try {
    await prisma.$executeRaw`
      INSERT INTO ai.user_memory_vectors (
        id,
        memory_entry_id,
        wa_user_id,
        village_id,
        memory_type,
        content,
        importance,
        embedding,
        embedding_model,
        created_at,
        updated_at
      ) VALUES (
        ${`umv_${input.memoryEntryId}`},
        ${input.memoryEntryId},
        ${input.waUserId},
        ${input.villageId || null},
        ${input.memoryType},
        ${input.content},
        ${input.importance},
        ${embeddingStr}::ai.vector,
        ${input.embeddingModel || config.embeddingGateway.model},
        NOW(),
        NOW()
      )
      ON CONFLICT (memory_entry_id) DO UPDATE SET
        wa_user_id = EXCLUDED.wa_user_id,
        village_id = EXCLUDED.village_id,
        memory_type = EXCLUDED.memory_type,
        content = EXCLUDED.content,
        importance = EXCLUDED.importance,
        embedding = EXCLUDED.embedding,
        embedding_model = EXCLUDED.embedding_model,
        updated_at = NOW()
    `;
  } catch (error: any) {
    logger.warn('Failed to upsert user memory vector', {
      memoryEntryId: input.memoryEntryId,
      error: error.message,
    });
    throw error;
  }
}

export async function searchUserMemoryVectors(
  queryEmbedding: number[],
  options: UserMemoryVectorSearchOptions,
): Promise<UserMemoryVectorSearchResult[]> {
  const {
    waUserId,
    villageId,
    memoryTypes,
    topK = 8,
    minScore = 0.35,
  } = options;

  const embeddingStr = `[${queryEmbedding.join(',')}]`;
  const sqlMinScore = minScore;
  const villageFilter = villageId
    ? Prisma.sql`AND village_id = ${villageId}`
    : Prisma.sql`AND village_id IS NULL`;
  const typeFilter = memoryTypes && memoryTypes.length > 0
    ? Prisma.sql`AND memory_type IN (${Prisma.join(memoryTypes)})`
    : Prisma.empty;

  try {
    const results = await prisma.$queryRaw<UserMemoryVectorRow[]>`
      SELECT
        memory_entry_id,
        wa_user_id,
        village_id,
        memory_type,
        content,
        importance,
        1 - (embedding OPERATOR(ai.<=>) ${embeddingStr}::ai.vector) AS similarity,
        created_at
      FROM ai.user_memory_vectors
      WHERE wa_user_id = ${waUserId}
        AND 1 - (embedding OPERATOR(ai.<=>) ${embeddingStr}::ai.vector) >= ${sqlMinScore}
        ${villageFilter}
        ${typeFilter}
      ORDER BY similarity DESC
      LIMIT ${topK}
    `;

    return results.map((row) => ({
      memoryEntryId: row.memory_entry_id,
      waUserId: row.wa_user_id,
      villageId: row.village_id,
      memoryType: row.memory_type,
      content: row.content,
      importance: row.importance,
      similarity: row.similarity,
      createdAt: row.created_at,
    }));
  } catch (error: any) {
    logger.warn('Failed to search user memory vectors', {
      waUserId,
      error: error.message,
    });
    return [];
  }
}
