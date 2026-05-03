import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import logger from '../utils/logger';

export interface MemoryTraceCandidate {
  id: string;
  memoryType: string;
  content: string;
  relevanceScore: number;
  lexicalScore: number;
  semanticScore: number;
  recencyScore: number;
  importanceScore: number;
  typeBoost: number;
  createdAt: string;
}

export async function recordMemoryTrace(input: {
  traceId?: string;
  waUserId: string;
  villageId?: string;
  channel?: string;
  source: 'summary_builder' | 'tool_search_user_memory';
  query: string;
  candidates: MemoryTraceCandidate[];
  summaryText?: string;
}): Promise<void> {
  try {
    const resultCount = input.candidates.length;
    const scores = input.candidates
      .map((candidate) => candidate.relevanceScore)
      .filter((score) => Number.isFinite(score));
    const topScore = scores.length > 0 ? Math.max(...scores) : null;
    const avgScore = scores.length > 0
      ? scores.reduce((sum, score) => sum + score, 0) / scores.length
      : null;

    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO ai."ai_memory_traces" (
        id,
        trace_id,
        wa_user_id,
        village_id,
        channel,
        source,
        query,
        result_count,
        top_score,
        avg_score,
        selected_memories_json,
        summary_text
      ) VALUES (
        ${randomUUID()},
        ${input.traceId ?? null},
        ${input.waUserId},
        ${input.villageId ?? null},
        ${input.channel ?? null},
        ${input.source},
        ${input.query.substring(0, 300)},
        ${resultCount},
        ${topScore},
        ${avgScore},
        ${JSON.stringify(input.candidates.slice(0, 10))}::jsonb,
        ${input.summaryText ?? null}
      )
    `);
  } catch (error: any) {
    logger.warn('Failed to record memory trace', {
      waUserId: input.waUserId,
      source: input.source,
      error: error.message,
    });
  }
}

export async function getMemoryObservabilityDurable(filters?: {
  villageId?: string;
  channel?: string;
}): Promise<{
  summary: {
    totalTraces: number;
    avgResultCount: number;
    avgTopScore: number | null;
  };
  bySource: Array<{
    source: string;
    count: number;
    avgResultCount: number;
  }>;
  byMemoryType: Array<{
    memoryType: string;
    count: number;
  }>;
  recentTraces: Array<{
    traceId?: string;
    waUserId: string;
    source: string;
    query: string;
    channel?: string;
    villageId?: string;
    resultCount: number;
    topScore: number | null;
    avgScore: number | null;
    summaryText?: string;
    createdAt: string;
    candidates: MemoryTraceCandidate[];
  }>;
}> {
  try {
    const traces = await prisma.$queryRaw<Array<{
      trace_id: string | null;
      wa_user_id: string;
      source: string;
      query: string;
      channel: string | null;
      village_id: string | null;
      result_count: number;
      top_score: number | null;
      avg_score: number | null;
      summary_text: string | null;
      selected_memories_json: Prisma.JsonValue | string | null;
      created_at: Date;
    }>>(Prisma.sql`
      SELECT
        trace_id,
        wa_user_id,
        source,
        query,
        channel,
        village_id,
        result_count,
        top_score,
        avg_score,
        summary_text,
        selected_memories_json,
        created_at
      FROM ai."ai_memory_traces"
      WHERE 1 = 1
      ${filters?.villageId ? Prisma.sql`AND village_id = ${filters.villageId}` : Prisma.empty}
      ${filters?.channel ? Prisma.sql`AND channel = ${filters.channel}` : Prisma.empty}
      ORDER BY created_at DESC
      LIMIT 200
    `);

    const normalized = traces.map((trace) => ({
      traceId: trace.trace_id || undefined,
      waUserId: trace.wa_user_id,
      source: trace.source,
      query: trace.query,
      channel: trace.channel || undefined,
      villageId: trace.village_id || undefined,
      resultCount: trace.result_count,
      topScore: trace.top_score,
      avgScore: trace.avg_score,
      summaryText: trace.summary_text || undefined,
      createdAt: trace.created_at.toISOString(),
      candidates: parseJsonArray<MemoryTraceCandidate>(trace.selected_memories_json),
    }));

    const totalTraces = normalized.length;
    const avgResultCount = totalTraces > 0
      ? Math.round((normalized.reduce((sum, trace) => sum + trace.resultCount, 0) / totalTraces) * 10) / 10
      : 0;
    const topScores = normalized
      .map((trace) => trace.topScore)
      .filter((score): score is number => typeof score === 'number' && Number.isFinite(score));
    const avgTopScore = topScores.length > 0
      ? Math.round((topScores.reduce((sum, score) => sum + score, 0) / topScores.length) * 1000) / 1000
      : null;

    const bySource = Array.from(
      normalized.reduce((acc, trace) => {
        const bucket = acc.get(trace.source) || { source: trace.source, count: 0, totalResults: 0 };
        bucket.count++;
        bucket.totalResults += trace.resultCount;
        acc.set(trace.source, bucket);
        return acc;
      }, new Map<string, { source: string; count: number; totalResults: number }>()),
    ).map(([, bucket]) => ({
      source: bucket.source,
      count: bucket.count,
      avgResultCount: bucket.count > 0 ? Math.round((bucket.totalResults / bucket.count) * 10) / 10 : 0,
    }));

    const memoryTypeCounts = new Map<string, number>();
    for (const trace of normalized) {
      for (const candidate of trace.candidates) {
        memoryTypeCounts.set(candidate.memoryType, (memoryTypeCounts.get(candidate.memoryType) || 0) + 1);
      }
    }

    const byMemoryType = Array.from(memoryTypeCounts.entries())
      .map(([memoryType, count]) => ({ memoryType, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      summary: {
        totalTraces,
        avgResultCount,
        avgTopScore,
      },
      bySource,
      byMemoryType,
      recentTraces: normalized.slice(0, 30),
    };
  } catch (error: any) {
    logger.error('Failed to load memory observability', { error: error.message });
    return {
      summary: { totalTraces: 0, avgResultCount: 0, avgTopScore: null },
      bySource: [],
      byMemoryType: [],
      recentTraces: [],
    };
  }
}

export async function recordGuardrailEvent(input: {
  traceId?: string;
  waUserId?: string;
  villageId?: string;
  channel?: string;
  guardStage: string;
  guardType: string;
  action: string;
  reason?: string;
  messagePreview?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO ai."ai_guardrail_events" (
        id,
        trace_id,
        wa_user_id,
        village_id,
        channel,
        guard_stage,
        guard_type,
        action,
        reason,
        message_preview,
        metadata_json
      ) VALUES (
        ${randomUUID()},
        ${input.traceId ?? null},
        ${input.waUserId ?? null},
        ${input.villageId ?? null},
        ${input.channel ?? null},
        ${input.guardStage},
        ${input.guardType},
        ${input.action},
        ${input.reason ?? null},
        ${input.messagePreview ? input.messagePreview.substring(0, 300) : null},
        ${input.metadata ? JSON.stringify(input.metadata) : null}::jsonb
      )
    `);
  } catch (error: any) {
    logger.warn('Failed to record guardrail event', {
      guardStage: input.guardStage,
      guardType: input.guardType,
      error: error.message,
    });
  }
}

export async function getGuardrailObservabilityDurable(filters?: {
  villageId?: string;
  channel?: string;
}): Promise<{
  summary: {
    totalEvents: number;
    blockedCount: number;
    handledCount: number;
  };
  byType: Array<{
    guardType: string;
    count: number;
  }>;
  byStage: Array<{
    guardStage: string;
    count: number;
  }>;
  recentEvents: Array<{
    traceId?: string;
    waUserId?: string;
    guardStage: string;
    guardType: string;
    action: string;
    reason?: string;
    messagePreview?: string;
    createdAt: string;
  }>;
}> {
  try {
    const rows = await prisma.$queryRaw<Array<{
      trace_id: string | null;
      wa_user_id: string | null;
      guard_stage: string;
      guard_type: string;
      action: string;
      reason: string | null;
      message_preview: string | null;
      created_at: Date;
    }>>(Prisma.sql`
      SELECT
        trace_id,
        wa_user_id,
        guard_stage,
        guard_type,
        action,
        reason,
        message_preview,
        created_at
      FROM ai."ai_guardrail_events"
      WHERE 1 = 1
      ${filters?.villageId ? Prisma.sql`AND village_id = ${filters.villageId}` : Prisma.empty}
      ${filters?.channel ? Prisma.sql`AND channel = ${filters.channel}` : Prisma.empty}
      ORDER BY created_at DESC
      LIMIT 200
    `);

    const totalEvents = rows.length;
    const blockedCount = rows.filter((row) => row.action === 'blocked').length;
    const handledCount = rows.filter((row) => row.action === 'handled').length;

    const byType = Array.from(
      rows.reduce((acc, row) => {
        acc.set(row.guard_type, (acc.get(row.guard_type) || 0) + 1);
        return acc;
      }, new Map<string, number>()),
    ).map(([guardType, count]) => ({ guardType, count }))
      .sort((a, b) => b.count - a.count);

    const byStage = Array.from(
      rows.reduce((acc, row) => {
        acc.set(row.guard_stage, (acc.get(row.guard_stage) || 0) + 1);
        return acc;
      }, new Map<string, number>()),
    ).map(([guardStage, count]) => ({ guardStage, count }))
      .sort((a, b) => b.count - a.count);

    return {
      summary: {
        totalEvents,
        blockedCount,
        handledCount,
      },
      byType,
      byStage,
      recentEvents: rows.slice(0, 30).map((row) => ({
        traceId: row.trace_id || undefined,
        waUserId: row.wa_user_id || undefined,
        guardStage: row.guard_stage,
        guardType: row.guard_type,
        action: row.action,
        reason: row.reason || undefined,
        messagePreview: row.message_preview || undefined,
        createdAt: row.created_at.toISOString(),
      })),
    };
  } catch (error: any) {
    logger.error('Failed to load guardrail observability', { error: error.message });
    return {
      summary: { totalEvents: 0, blockedCount: 0, handledCount: 0 },
      byType: [],
      byStage: [],
      recentEvents: [],
    };
  }
}

function parseJsonArray<T>(value: Prisma.JsonValue | string | null | undefined): T[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value as T[];
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  return [];
}
