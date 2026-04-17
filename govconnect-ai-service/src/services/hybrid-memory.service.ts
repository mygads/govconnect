import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import logger from '../utils/logger';
import { LRUCache } from '../utils/lru-cache';

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

export interface MemoryEventInput {
  wa_user_id: string;
  village_id?: string;
  memory_type: 'complaint' | 'service_request' | 'service_edit' | 'status_lookup' | 'cancellation' | 'profile';
  memory_key?: string;
  content: string;
  metadata_json?: Prisma.InputJsonObject;
  importance?: number;
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

function computeMemoryScore(
  entry: {
    content: string;
    memory_key: string | null;
    importance: number;
    created_at: Date;
  },
  queryTerms: string[],
): number {
  const haystack = `${entry.memory_key || ''} ${entry.content}`.toLowerCase();
  const overlap = queryTerms.reduce((count, term) => (haystack.includes(term) ? count + 1 : count), 0);
  const overlapScore = queryTerms.length > 0 ? overlap / queryTerms.length : 0;

  const ageDays = Math.max(0, (Date.now() - entry.created_at.getTime()) / (24 * 60 * 60 * 1000));
  const recencyBoost = Math.max(0, 1 - ageDays / 30) * 0.2;
  const importanceBoost = clampImportance(entry.importance) * 0.8;

  return overlapScore + recencyBoost + importanceBoost;
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

export async function rememberMemoryEvent(input: MemoryEventInput): Promise<void> {
  try {
    await prisma.user_memory_entries.create({
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

export async function buildHybridMemorySummary(input: {
  wa_user_id: string;
  query: string;
  village_id?: string;
}): Promise<string> {
  const cacheKey = buildSummaryCacheKey(input.wa_user_id, input.village_id, input.query);
  const cached = MEMORY_SUMMARY_CACHE.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const queryTerms = normalizeQueryTerms(input.query);
    const needsRecentOperationalMemory = /\b(status|cek|lacak|update|ubah|edit|batalkan|batal|laporan|layanan|permohonan)\b/i.test(input.query || '');
    const [profile, memoryEntries] = await Promise.all([
      prisma.durable_user_profiles.findUnique({
        where: { wa_user_id: input.wa_user_id },
      }),
      prisma.user_memory_entries.findMany({
        where: {
          wa_user_id: input.wa_user_id,
          OR: [
            { village_id: input.village_id ?? null },
            { village_id: null },
          ],
        },
        orderBy: { created_at: 'desc' },
        take: 40,
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

    let rankedMemories = memoryEntries
      .map((entry) => ({
        ...entry,
        score: computeMemoryScore(entry, queryTerms),
      }))
      .filter((entry) => entry.score >= 0.45)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (rankedMemories.length === 0 && memoryEntries.length > 0) {
      const fallbackTypes = needsRecentOperationalMemory
        ? new Set(['complaint', 'service_request', 'service_edit', 'status_lookup', 'cancellation'])
        : null;

      rankedMemories = memoryEntries
        .filter((entry) => !fallbackTypes || fallbackTypes.has(entry.memory_type))
        .map((entry) => ({
          ...entry,
          score: computeMemoryScore(entry, []) + clampImportance(entry.importance),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, needsRecentOperationalMemory ? 3 : 2);
    }

    const memoryParts = rankedMemories.map((entry) => {
      const createdAt = entry.created_at.toISOString().slice(0, 10);
      return `${createdAt}: ${entry.content}`;
    });

    if (rankedMemories.length > 0) {
      prisma.user_memory_entries.updateMany({
        where: { id: { in: rankedMemories.map((entry) => entry.id) } },
        data: { last_accessed_at: new Date() },
      }).catch(() => {});
    }

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

    return summary;
  } catch (error: any) {
    logger.warn('Failed to build hybrid memory summary', {
      wa_user_id: input.wa_user_id,
      error: error.message,
    });
    return '';
  }
}
