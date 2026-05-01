import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import logger from '../utils/logger';
import { LRUCache } from '../utils/lru-cache';
import { generateEmbedding } from './embedding.service';
import { recordMemoryTrace } from './runtime-observability.service';
import {
  searchUserMemoryVectors,
  upsertUserMemoryVector,
  type UserMemoryVectorSearchResult,
} from './memory-vector.service';

const MEMORY_SUMMARY_CACHE = new LRUCache<string, string>({
  maxSize: 2000,
  ttlMs: 2 * 60 * 1000,
  name: 'hybrid-memory-summary',
});
const MAX_MEMORY_ENTRIES_PER_USER = 200;
const MEMORY_RETENTION_DAYS = 180;

const MEMORY_STOP_WORDS = new Set([
  'dan', 'atau', 'yang', 'untuk', 'dengan', 'dari', 'ke', 'di', 'ini', 'itu',
  'saya', 'anda', 'kami', 'kita', 'pak', 'bu', 'bapak', 'ibu', 'mohon', 'tolong',
  'mau', 'ingin', 'nya', 'sih', 'dong', 'deh', 'ya', 'nih', 'gimana', 'bagaimana',
  'status', 'cek', 'tolong', 'minta',
]);

const OPERATIONAL_MEMORY_TYPES = new Set([
  'complaint',
  'service_request',
  'service_edit',
  'status_lookup',
  'cancellation',
]);

type MemoryEntryRow = {
  id: string;
  wa_user_id: string;
  village_id: string | null;
  memory_type: string;
  memory_key: string | null;
  content: string;
  importance: number;
  created_at: Date;
};

export interface MemoryEventInput {
  wa_user_id: string;
  village_id?: string;
  memory_type: 'complaint' | 'service_request' | 'service_edit' | 'status_lookup' | 'cancellation' | 'profile';
  memory_key?: string;
  content: string;
  metadata_json?: Prisma.InputJsonObject;
  importance?: number;
}

export interface RetrievedUserMemory {
  id: string;
  memory_type: string;
  memory_key?: string | null;
  content: string;
  importance: number;
  created_at: Date;
  lexicalScore: number;
  semanticScore: number;
  recencyScore: number;
  importanceScore: number;
  typeBoost: number;
  finalScore: number;
}

function normalizeQueryTerms(query: string): string[] {
  return (query || '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 2 && !MEMORY_STOP_WORDS.has(term));
}

function clampImportance(value?: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.5;
  return Math.max(0.1, Math.min(1, value));
}

function buildSummaryCacheKey(wa_user_id: string, village_id: string | undefined, query: string): string {
  return `${wa_user_id}:${village_id || '_'}:${normalizeQueryTerms(query).sort().join('|')}`;
}

function computeLexicalOverlap(
  entry: {
    content: string;
    memory_key?: string | null;
  },
  queryTerms: string[],
): number {
  if (queryTerms.length === 0) {
    return 0;
  }

  const haystack = `${entry.memory_key || ''} ${entry.content}`.toLowerCase();
  const overlap = queryTerms.reduce((count, term) => (haystack.includes(term) ? count + 1 : count), 0);
  return overlap / queryTerms.length;
}

function computeRecencyScore(createdAt: Date): number {
  const ageDays = Math.max(0, (Date.now() - createdAt.getTime()) / (24 * 60 * 60 * 1000));
  return Math.max(0, 1 - (ageDays / 45));
}

function needsRecentOperationalMemory(query: string): boolean {
  return /\b(status|cek|lacak|update|ubah|edit|batalkan|batal|laporan|layanan|permohonan|riwayat)\b/i.test(query || '');
}

function computeTypeBoost(query: string, memoryType: string): number {
  if (!needsRecentOperationalMemory(query)) {
    return 0;
  }

  return OPERATIONAL_MEMORY_TYPES.has(memoryType) ? 0.08 : 0;
}

function clearMemoryCaches(wa_user_id: string): void {
  for (const [key] of MEMORY_SUMMARY_CACHE.entries()) {
    if (String(key).startsWith(`${wa_user_id}:`)) {
      MEMORY_SUMMARY_CACHE.delete(key);
    }
  }
}

async function pruneUserMemories(wa_user_id: string): Promise<void> {
  const retentionCutoff = new Date(Date.now() - (MEMORY_RETENTION_DAYS * 24 * 60 * 60 * 1000));
  const [staleEntries, overflowEntries] = await Promise.all([
    prisma.user_memory_entries.findMany({
      where: {
        wa_user_id,
        created_at: { lt: retentionCutoff },
      },
      select: { id: true },
      take: 500,
    }),
    prisma.user_memory_entries.findMany({
      where: { wa_user_id },
      orderBy: { created_at: 'desc' },
      skip: MAX_MEMORY_ENTRIES_PER_USER,
      select: { id: true },
      take: 500,
    }),
  ]);

  const ids = Array.from(new Set([
    ...staleEntries.map((entry) => entry.id),
    ...overflowEntries.map((entry) => entry.id),
  ]));

  if (ids.length === 0) {
    return;
  }

  await prisma.user_memory_entries.deleteMany({
    where: {
      id: { in: ids },
    },
  });
}

async function persistMemoryVector(entry: {
  id: string;
  wa_user_id: string;
  village_id: string | null;
  memory_type: string;
  content: string;
  importance: number;
}): Promise<void> {
  try {
    const embedding = await generateEmbedding(entry.content, {
      taskType: 'RETRIEVAL_DOCUMENT',
      outputDimensionality: 768,
      useCache: true,
    });

    await upsertUserMemoryVector({
      memoryEntryId: entry.id,
      waUserId: entry.wa_user_id,
      villageId: entry.village_id,
      memoryType: entry.memory_type,
      content: entry.content,
      importance: entry.importance,
      embedding: embedding.values,
      embeddingModel: embedding.model,
    });
  } catch (error: any) {
    logger.debug('Failed to persist semantic memory vector', {
      memoryEntryId: entry.id,
      error: error.message,
    });
  }
}

function mergeMemoryCandidates(
  lexicalCandidates: MemoryEntryRow[],
  semanticCandidates: UserMemoryVectorSearchResult[],
  query: string,
  queryTerms: string[],
): RetrievedUserMemory[] {
  const merged = new Map<string, RetrievedUserMemory>();

  for (const entry of lexicalCandidates) {
    const lexicalScore = computeLexicalOverlap(entry, queryTerms);
    const recencyScore = computeRecencyScore(entry.created_at);
    const importanceScore = clampImportance(entry.importance);
    const typeBoost = computeTypeBoost(query, entry.memory_type);
    const finalScore = (lexicalScore * 0.3) + (recencyScore * 0.2) + (importanceScore * 0.4) + typeBoost;

    merged.set(entry.id, {
      id: entry.id,
      memory_type: entry.memory_type,
      memory_key: entry.memory_key,
      content: entry.content,
      importance: entry.importance,
      created_at: entry.created_at,
      lexicalScore,
      semanticScore: 0,
      recencyScore,
      importanceScore,
      typeBoost,
      finalScore,
    });
  }

  for (const semantic of semanticCandidates) {
    const existing = merged.get(semantic.memoryEntryId);
    const recencyScore = computeRecencyScore(semantic.createdAt);
    const importanceScore = clampImportance(semantic.importance);
    const typeBoost = computeTypeBoost(query, semantic.memoryType);
    const lexicalScore = existing?.lexicalScore ?? computeLexicalOverlap({
      content: semantic.content,
      memory_key: null,
    }, queryTerms);
    const semanticScore = Math.max(0, Math.min(1, semantic.similarity));
    const finalScore = (semanticScore * 0.45)
      + (lexicalScore * 0.2)
      + (importanceScore * 0.2)
      + (recencyScore * 0.15)
      + typeBoost;

    merged.set(semantic.memoryEntryId, {
      id: semantic.memoryEntryId,
      memory_type: semantic.memoryType,
      memory_key: existing?.memory_key ?? null,
      content: existing?.content ?? semantic.content,
      importance: semantic.importance,
      created_at: semantic.createdAt,
      lexicalScore,
      semanticScore,
      recencyScore,
      importanceScore,
      typeBoost,
      finalScore,
    });
  }

  return Array.from(merged.values())
    .sort((a, b) => b.finalScore - a.finalScore);
}

export async function rememberMemoryEvent(input: MemoryEventInput): Promise<void> {
  try {
    const created = await prisma.user_memory_entries.create({
      data: {
        wa_user_id: input.wa_user_id,
        village_id: input.village_id ?? null,
        memory_type: input.memory_type,
        memory_key: input.memory_key ?? null,
        content: input.content,
        metadata_json: input.metadata_json,
        importance: clampImportance(input.importance),
      },
    });

    clearMemoryCaches(input.wa_user_id);
    pruneUserMemories(input.wa_user_id).catch(() => {});
    void persistMemoryVector(created);
  } catch (error: any) {
    logger.warn('Failed to persist episodic memory', {
      wa_user_id: input.wa_user_id,
      memory_type: input.memory_type,
      error: error.message,
    });
  }
}

export async function deleteAllMemories(wa_user_id: string): Promise<void> {
  try {
    await prisma.user_memory_entries.deleteMany({ where: { wa_user_id } });
    clearMemoryCaches(wa_user_id);
  } catch (error: any) {
    logger.warn('Failed to delete user episodic memories', {
      wa_user_id,
      error: error.message,
    });
  }
}

export async function searchUserMemories(input: {
  wa_user_id: string;
  query: string;
  village_id?: string;
  limit?: number;
}): Promise<RetrievedUserMemory[]> {
  const queryTerms = normalizeQueryTerms(input.query);
  const memoryTypeFilter = needsRecentOperationalMemory(input.query)
    ? Array.from(OPERATIONAL_MEMORY_TYPES)
    : undefined;

  try {
    const [lexicalCandidates, semanticCandidates] = await Promise.all([
      prisma.user_memory_entries.findMany({
        where: {
          wa_user_id: input.wa_user_id,
          ...(input.village_id
            ? { village_id: input.village_id }
            : { village_id: null }),
          ...(memoryTypeFilter ? { memory_type: { in: memoryTypeFilter } } : {}),
        },
        orderBy: { created_at: 'desc' },
        take: 40,
      }),
      (async () => {
        if (!input.query.trim()) {
          return [];
        }

        try {
          const queryEmbedding = await generateEmbedding(input.query, {
            taskType: 'RETRIEVAL_QUERY',
            outputDimensionality: 768,
            useCache: true,
            context: {
              village_id: input.village_id,
              wa_user_id: input.wa_user_id,
            },
          });

          return await searchUserMemoryVectors(queryEmbedding.values, {
            waUserId: input.wa_user_id,
            villageId: input.village_id,
            memoryTypes: memoryTypeFilter,
            topK: Math.max((input.limit || 5) * 2, 8),
            minScore: 0.35,
          });
        } catch (error: any) {
          logger.debug('Semantic user memory search skipped', {
            wa_user_id: input.wa_user_id,
            error: error.message,
          });
          return [];
        }
      })(),
    ]);

    let merged = mergeMemoryCandidates(lexicalCandidates, semanticCandidates, input.query, queryTerms);

    if (merged.length === 0 && lexicalCandidates.length > 0) {
      merged = lexicalCandidates
        .map((entry) => {
          const recencyScore = computeRecencyScore(entry.created_at);
          const importanceScore = clampImportance(entry.importance);
          const typeBoost = computeTypeBoost(input.query, entry.memory_type);
          return {
            id: entry.id,
            memory_type: entry.memory_type,
            memory_key: entry.memory_key,
            content: entry.content,
            importance: entry.importance,
            created_at: entry.created_at,
            lexicalScore: 0,
            semanticScore: 0,
            recencyScore,
            importanceScore,
            typeBoost,
            finalScore: (importanceScore * 0.6) + (recencyScore * 0.4) + typeBoost,
          };
        })
        .sort((a, b) => b.finalScore - a.finalScore);
    }

    const ranked = merged
      .filter((entry) => entry.finalScore >= 0.35 || entry.semanticScore >= 0.35)
      .slice(0, input.limit || 5);

    if (ranked.length > 0) {
      prisma.user_memory_entries.updateMany({
        where: { id: { in: ranked.map((entry) => entry.id) } },
        data: { last_accessed_at: new Date() },
      }).catch(() => {});
    }

    return ranked;
  } catch (error: any) {
    logger.warn('Failed to search user memories', {
      wa_user_id: input.wa_user_id,
      error: error.message,
    });
    return [];
  }
}

export async function buildHybridMemorySummary(input: {
  wa_user_id: string;
  query: string;
  village_id?: string;
  trace_id?: string;
  channel?: 'whatsapp' | 'webchat';
  skip_observability?: boolean;
}): Promise<string> {
  const cacheKey = buildSummaryCacheKey(input.wa_user_id, input.village_id, input.query);
  const cached = MEMORY_SUMMARY_CACHE.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const [profile, rankedMemories] = await Promise.all([
      prisma.durable_user_profiles.findUnique({
        where: { wa_user_id: input.wa_user_id },
      }),
      searchUserMemories({
        wa_user_id: input.wa_user_id,
        query: input.query,
        village_id: input.village_id,
        limit: needsRecentOperationalMemory(input.query) ? 5 : 4,
      }),
    ]);

    const profileParts: string[] = [];
    if (profile?.nama_lengkap) {
      profileParts.push(`Nama user yang tersimpan: ${profile.nama_lengkap}`);
    }
    if (profile?.default_address) {
      profileParts.push(`Alamat default/sering dipakai: ${profile.default_address}`);
    }
    if (profile?.default_rt_rw) {
      profileParts.push(`RT/RW default: ${profile.default_rt_rw}`);
    }
    if (profile?.communication_style && profile.communication_style !== 'auto') {
      profileParts.push(`Gaya komunikasi favorit: ${profile.communication_style}`);
    }
    if (profile?.frequent_services && profile.frequent_services.length > 0) {
      profileParts.push(`Layanan/kategori yang sering dipakai: ${profile.frequent_services.slice(-3).join(', ')}`);
    }
    if ((profile?.total_messages || 0) > 1) {
      profileParts.push(`Total interaksi historis: ${profile?.total_messages}`);
    }

    const memoryParts = rankedMemories.map((entry) => {
      const createdAt = entry.created_at.toISOString().slice(0, 10);
      return `${createdAt}: ${entry.content}`;
    });

    const sections: string[] = [];
    if (profileParts.length > 0) {
      sections.push(`[LONG-TERM PROFILE]\n${profileParts.join('\n')}`);
    }
    if (memoryParts.length > 0) {
      sections.push(`[RELEVANT MEMORY]\n${memoryParts.join('\n')}`);
    }

    const summary = sections.join('\n\n');
    if (summary) {
      MEMORY_SUMMARY_CACHE.set(cacheKey, summary);
    }

    if (!input.skip_observability) {
      await recordMemoryTrace({
        traceId: input.trace_id,
        waUserId: input.wa_user_id,
        villageId: input.village_id,
        channel: input.channel,
        source: 'summary_builder',
        query: input.query,
        summaryText: summary || undefined,
        candidates: rankedMemories.map((entry) => ({
          id: entry.id,
          memoryType: entry.memory_type,
          content: entry.content,
          relevanceScore: Number(entry.finalScore.toFixed(3)),
          lexicalScore: Number(entry.lexicalScore.toFixed(3)),
          semanticScore: Number(entry.semanticScore.toFixed(3)),
          recencyScore: Number(entry.recencyScore.toFixed(3)),
          importanceScore: Number(entry.importanceScore.toFixed(3)),
          typeBoost: Number(entry.typeBoost.toFixed(3)),
          createdAt: entry.created_at.toISOString(),
        })),
      });
    }

    return summary;
  } catch (error: any) {
    logger.warn('Failed to build hybrid memory summary', {
      wa_user_id: input.wa_user_id,
      error: error.message,
    });
    return '';
  }
}
