import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import logger from '../../utils/logger';
import { LRUCache } from '../../utils/lru-cache';
import type { AgentToolName } from './tool-definitions';

interface PersistedToolPolicy {
  policyKey: string;
  source: string;
  matchTerms: string[];
  allowedTools: AgentToolName[];
  confidence: number;
  evaluationCount: number;
  successCount: number;
  lastSeenAt: string;
}

const POLICY_CACHE = new LRUCache<string, PersistedToolPolicy[]>({
  maxSize: 1,
  ttlMs: 5 * 60 * 1000,
  name: 'tool-policy-cache',
});

const POLICY_STOP_WORDS = new Set([
  'dan', 'atau', 'yang', 'untuk', 'dengan', 'dari', 'ke', 'di', 'ini', 'itu',
  'saya', 'anda', 'kami', 'kita', 'pak', 'bu', 'bapak', 'ibu', 'mohon', 'tolong',
  'dong', 'ya', 'nih', 'deh', 'lagi', 'banget', 'please', 'minta',
]);

export function normalizePolicyTerms(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 2 && !POLICY_STOP_WORDS.has(term));
}

async function loadPolicies(): Promise<PersistedToolPolicy[]> {
  const cached = POLICY_CACHE.get('all');
  if (cached) {
    return cached;
  }

  const rows = await prisma.$queryRaw<Array<{
    policy_key: string;
    source: string;
    match_terms_json: Prisma.JsonValue | string;
    allowed_tools_json: Prisma.JsonValue | string;
    confidence: number;
    evaluation_count: number;
    success_count: number;
    last_seen_at: Date;
  }>>(Prisma.sql`
    SELECT
      policy_key,
      source,
      match_terms_json,
      allowed_tools_json,
      confidence,
      evaluation_count,
      success_count,
      last_seen_at
    FROM ai_tool_allowlist_policies
    ORDER BY confidence DESC, updated_at DESC
    LIMIT 200
  `);

  const policies = rows.map((row) => ({
    policyKey: row.policy_key,
    source: row.source,
    matchTerms: parseJsonArray<string>(row.match_terms_json),
    allowedTools: parseJsonArray<AgentToolName>(row.allowed_tools_json),
    confidence: row.confidence,
    evaluationCount: row.evaluation_count,
    successCount: row.success_count,
    lastSeenAt: row.last_seen_at.toISOString(),
  }));

  POLICY_CACHE.set('all', policies);
  return policies;
}

export async function resolveLearnedToolPolicy(query: string): Promise<{
  tools: AgentToolName[];
  matchedPolicyKey?: string;
  matchedPolicySource?: string;
  confidence?: number;
}> {
  const queryTerms = normalizePolicyTerms(query);
  if (queryTerms.length === 0) {
    return { tools: [] };
  }

  try {
    const policies = await loadPolicies();
    let bestMatch: {
      policy: PersistedToolPolicy;
      overlapScore: number;
    } | null = null;

    for (const policy of policies) {
      if (!policy.matchTerms.length || !policy.allowedTools.length) {
        continue;
      }

      const overlapCount = policy.matchTerms.filter((term) => queryTerms.includes(term)).length;
      if (overlapCount === 0) {
        continue;
      }

      const overlapScore = overlapCount / Math.max(policy.matchTerms.length, 1);
      const weightedScore = (overlapScore * 0.7) + (policy.confidence * 0.3);
      if (weightedScore < 0.72) {
        continue;
      }

      if (!bestMatch || weightedScore > bestMatch.overlapScore) {
        bestMatch = { policy, overlapScore: weightedScore };
      }
    }

    if (!bestMatch) {
      return { tools: [] };
    }

    return {
      tools: bestMatch.policy.allowedTools,
      matchedPolicyKey: bestMatch.policy.policyKey,
      matchedPolicySource: bestMatch.policy.source,
      confidence: Number(bestMatch.overlapScore.toFixed(3)),
    };
  } catch (error: any) {
    logger.warn('Failed to resolve learned tool policy', { error: error.message });
    return { tools: [] };
  }
}

export async function upsertPoliciesFromGoldenSet(items: Array<{
  query: string;
  expected_tools?: string[];
  scenario?: string;
  tool_score?: number;
  score?: number;
}>): Promise<void> {
  const candidates = items.filter((item) =>
    Array.isArray(item.expected_tools)
    && item.expected_tools.length > 0
    && (item.tool_score ?? 0) >= 1
    && (item.score ?? 0) >= 0.85,
  );

  if (candidates.length === 0) {
    return;
  }

  for (const item of candidates) {
    const matchTerms = normalizePolicyTerms(item.query).slice(0, 6);
    const allowedTools = Array.from(new Set((item.expected_tools || []).map((tool) => tool as AgentToolName)));
    if (matchTerms.length === 0 || allowedTools.length === 0) {
      continue;
    }

    const scenario = item.scenario || 'general';
    const policyKey = `golden:${scenario}:${matchTerms.join('|')}`;
    const confidence = Math.min(0.98, 0.75 + (allowedTools.length * 0.03));

    try {
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO ai_tool_allowlist_policies (
          id,
          policy_key,
          source,
          match_terms_json,
          allowed_tools_json,
          confidence,
          evaluation_count,
          success_count,
          last_seen_at,
          created_at,
          updated_at
        ) VALUES (
          ${randomUUID()},
          ${policyKey},
          ${'golden_set'},
          ${JSON.stringify(matchTerms)}::jsonb,
          ${JSON.stringify(allowedTools)}::jsonb,
          ${confidence},
          1,
          1,
          NOW(),
          NOW(),
          NOW()
        )
        ON CONFLICT (policy_key) DO UPDATE SET
          allowed_tools_json = EXCLUDED.allowed_tools_json,
          confidence = GREATEST(ai_tool_allowlist_policies.confidence, EXCLUDED.confidence),
          evaluation_count = ai_tool_allowlist_policies.evaluation_count + 1,
          success_count = ai_tool_allowlist_policies.success_count + 1,
          last_seen_at = NOW(),
          updated_at = NOW()
      `);
    } catch (error: any) {
      logger.warn('Failed to upsert golden set tool policy', {
        policyKey,
        error: error.message,
      });
    }
  }

  POLICY_CACHE.clear();
}

export async function recordToolPolicyEvent(input: {
  traceId?: string;
  waUserId?: string;
  villageId?: string;
  channel?: string;
  query: string;
  heuristicTools: AgentToolName[];
  learnedTools: AgentToolName[];
  allowedTools: AgentToolName[];
  actualTools: string[];
  success: boolean;
  policyKey?: string;
  policySource?: string;
}): Promise<void> {
  try {
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO ai_tool_policy_events (
        id,
        trace_id,
        wa_user_id,
        village_id,
        channel,
        query,
        policy_key,
        policy_source,
        heuristic_tools_json,
        learned_tools_json,
        allowed_tools_json,
        actual_tools_json,
        success
      ) VALUES (
        ${randomUUID()},
        ${input.traceId ?? null},
        ${input.waUserId ?? null},
        ${input.villageId ?? null},
        ${input.channel ?? null},
        ${input.query.substring(0, 300)},
        ${input.policyKey ?? null},
        ${input.policySource ?? null},
        ${JSON.stringify(input.heuristicTools)}::jsonb,
        ${JSON.stringify(input.learnedTools)}::jsonb,
        ${JSON.stringify(input.allowedTools)}::jsonb,
        ${JSON.stringify(input.actualTools)}::jsonb,
        ${input.success}
      )
    `);

    if (input.policyKey) {
      await prisma.$executeRaw(Prisma.sql`
        UPDATE ai_tool_allowlist_policies
        SET
          evaluation_count = evaluation_count + 1,
          success_count = success_count + ${input.success ? 1 : 0},
          confidence = CASE
            WHEN evaluation_count + 1 > 0 THEN LEAST(
              0.99,
              GREATEST(
                0.3,
                ((success_count + ${input.success ? 1 : 0})::float / (evaluation_count + 1))
              )
            )
            ELSE confidence
          END,
          last_seen_at = NOW(),
          updated_at = NOW()
        WHERE policy_key = ${input.policyKey}
      `);
    }
  } catch (error: any) {
    logger.warn('Failed to record tool policy event', {
      policyKey: input.policyKey,
      error: error.message,
    });
  }
}

export async function getToolPolicyObservabilityDurable(filters?: {
  villageId?: string;
  channel?: string;
}): Promise<{
  summary: {
    totalPolicies: number;
    totalEvents: number;
    policyHitRate: number;
  };
  policies: PersistedToolPolicy[];
  recentEvents: Array<{
    traceId?: string;
    query: string;
    policyKey?: string;
    policySource?: string;
    heuristicTools: string[];
    learnedTools: string[];
    allowedTools: string[];
    actualTools: string[];
    success: boolean;
    createdAt: string;
  }>;
}> {
  try {
    const [policies, events] = await Promise.all([
      loadPolicies(),
      prisma.$queryRaw<Array<{
        trace_id: string | null;
        query: string;
        policy_key: string | null;
        policy_source: string | null;
        heuristic_tools_json: Prisma.JsonValue | string | null;
        learned_tools_json: Prisma.JsonValue | string | null;
        allowed_tools_json: Prisma.JsonValue | string | null;
        actual_tools_json: Prisma.JsonValue | string | null;
        success: boolean;
        created_at: Date;
      }>>(Prisma.sql`
        SELECT
          trace_id,
          query,
          policy_key,
          policy_source,
          heuristic_tools_json,
          learned_tools_json,
          allowed_tools_json,
          actual_tools_json,
          success,
          created_at
        FROM ai_tool_policy_events
        WHERE 1 = 1
        ${filters?.villageId ? Prisma.sql`AND village_id = ${filters.villageId}` : Prisma.empty}
        ${filters?.channel ? Prisma.sql`AND channel = ${filters.channel}` : Prisma.empty}
        ORDER BY created_at DESC
        LIMIT 100
      `),
    ]);

    const policyHitEvents = events.filter((event) => !!event.policy_key);
    return {
      summary: {
        totalPolicies: policies.length,
        totalEvents: events.length,
        policyHitRate: events.length > 0
          ? Math.round((policyHitEvents.length / events.length) * 1000) / 10
          : 0,
      },
      policies: policies.slice(0, 20),
      recentEvents: events.slice(0, 30).map((event) => ({
        traceId: event.trace_id || undefined,
        query: event.query,
        policyKey: event.policy_key || undefined,
        policySource: event.policy_source || undefined,
        heuristicTools: parseJsonArray<string>(event.heuristic_tools_json),
        learnedTools: parseJsonArray<string>(event.learned_tools_json),
        allowedTools: parseJsonArray<string>(event.allowed_tools_json),
        actualTools: parseJsonArray<string>(event.actual_tools_json),
        success: event.success,
        createdAt: event.created_at.toISOString(),
      })),
    };
  } catch (error: any) {
    logger.error('Failed to get tool policy observability', { error: error.message });
    return {
      summary: { totalPolicies: 0, totalEvents: 0, policyHitRate: 0 },
      policies: [],
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
