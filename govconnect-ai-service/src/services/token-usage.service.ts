/**
 * Token Usage Tracking Service
 *
 * Persists actual Gemini API token usage (from usageMetadata) to PostgreSQL.
 * Provides aggregation queries for the AI Usage dashboard.
 *
 * Pricing reference (USD per 1M tokens, paid tier <=200k context) — February 2026:
 * ┌─────────────────────────────────┬──────────┬───────────┐
 * │ Model                           │ Input    │ Output    │
 * ├─────────────────────────────────┼──────────┼───────────┤
 * │ gemini-3-pro-preview            │ $2.00    │ $12.00    │
 * │ gemini-3-flash-preview          │ $0.50    │ $3.00     │
 * │ gemini-2.5-pro                  │ $1.25    │ $10.00    │
 * │ gemini-2.5-flash                │ $0.30    │ $2.50     │
 * │ gemini-2.5-flash-lite           │ $0.10    │ $0.40     │
 * │ gemini-2.0-flash                │ $0.10    │ $0.40     │
 * │ gemini-2.0-flash-lite           │ $0.075   │ $0.30     │
 * │ gemini-1.5-pro                  │ $1.25    │ $5.00     │
 * │ gemini-1.5-flash                │ $0.075   │ $0.30     │
 * └─────────────────────────────────┴──────────┴───────────┘
 */

import prisma from '../lib/prisma';
import { Prisma } from '@prisma/client';
import logger from '../utils/logger';

// ==================== Pricing ====================

const PRICING: Record<string, { input: number; output: number }> = {
  // Gemini 3
  'gemini-3-pro-preview':       { input: 2.00,  output: 12.00 },
  'gemini-3-flash-preview':     { input: 0.50,  output: 3.00 },
  // Gemini 2.5
  'gemini-2.5-pro':             { input: 1.25,  output: 10.00 },
  'gemini-2.5-pro-preview':     { input: 1.25,  output: 10.00 },
  'gemini-2.5-flash':           { input: 0.30,  output: 2.50 },
  'gemini-2.5-flash-preview':   { input: 0.30,  output: 2.50 },
  'gemini-2.5-flash-lite':      { input: 0.10,  output: 0.40 },
  'gemini-2.5-flash-lite-preview': { input: 0.10, output: 0.40 },
  // Gemini 2.0
  'gemini-2.0-flash':           { input: 0.10,  output: 0.40 },
  'gemini-2.0-flash-exp':       { input: 0.10,  output: 0.40 },
  'gemini-2.0-flash-lite':      { input: 0.075, output: 0.30 },
  // Gemini 1.5 (legacy)
  'gemini-1.5-pro':             { input: 1.25,  output: 5.00 },
  'gemini-1.5-flash':           { input: 0.075, output: 0.30 },
  'gemini-1.5-flash-8b':        { input: 0.0375, output: 0.15 },
};

/** Find pricing for a model name — supports date-suffixed names like gemini-2.5-flash-preview-05-20 */
function findPricing(model: string): { input: number; output: number } {
  if (PRICING[model]) return PRICING[model];
  // Prefix match (longest key first)
  const keys = Object.keys(PRICING).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (model.startsWith(key)) return PRICING[key];
  }
  // Fallback by family
  if (model.includes('flash-lite')) return { input: 0.10, output: 0.40 };
  if (model.includes('flash'))      return { input: 0.30, output: 2.50 };
  if (model.includes('pro'))        return { input: 1.25, output: 10.00 };
  return { input: 0.30, output: 2.50 }; // default flash
}

function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = findPricing(model);
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

// ==================== Types ====================

export type LayerType = 'full_nlu' | 'micro_nlu' | 'embedding' | 'rag_expand';

export type CallType =
  | 'main_chat'
  | 'anti_hallucination_retry'
  | 'complaint_type_match'
  | 'service_slug_match'
  | 'rag_query_expand'
  | 'confirmation_classify'
  | 'farewell_classify'
  | 'greeting_classify'
  | 'embedding_single'
  | 'embedding_batch';

export interface TokenUsageRecord {
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  layer_type: LayerType;
  call_type: CallType;
  village_id?: string | null;
  wa_user_id?: string | null;
  session_id?: string | null;
  channel?: string | null;
  intent?: string | null;
  success?: boolean;
  duration_ms?: number | null;
  key_source?: string | null;  // "byok" | "env"
  key_id?: string | null;      // BYOK key ID
  key_tier?: string | null;    // "free" | "tier1" | "tier2" | "env"
}

export interface UsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

// ==================== Write Operations ====================

/**
 * Record a single LLM call's token usage to the database.
 * Fire-and-forget — errors are logged but never thrown.
 */
export async function recordTokenUsage(record: TokenUsageRecord): Promise<void> {
  try {
    const cost_usd = calculateCost(record.model, record.input_tokens, record.output_tokens);

    await prisma.ai_token_usage.create({
      data: {
        model: record.model,
        input_tokens: record.input_tokens,
        output_tokens: record.output_tokens,
        total_tokens: record.total_tokens,
        cost_usd,
        layer_type: record.layer_type,
        call_type: record.call_type,
        village_id: record.village_id ?? null,
        wa_user_id: record.wa_user_id ?? null,
        session_id: record.session_id ?? null,
        channel: record.channel ?? null,
        intent: record.intent ?? null,
        success: record.success ?? true,
        duration_ms: record.duration_ms ?? null,
        key_source: record.key_source ?? null,
        key_id: record.key_id ?? null,
        key_tier: record.key_tier ?? null,
      },
    });

    logger.debug('📊 Token usage recorded', {
      model: record.model,
      layer: record.layer_type,
      call: record.call_type,
      tokens: record.total_tokens,
      cost_usd: cost_usd.toFixed(6),
    });
  } catch (error: any) {
    logger.error('❌ Failed to record token usage', {
      error: error.message,
      model: record.model,
    });
  }
}

/**
 * Helper: extract usageMetadata from a Gemini GenerateContentResult and record it.
 */
export function extractAndRecord(
  geminiResult: any,
  model: string,
  layer_type: LayerType,
  call_type: CallType,
  context?: {
    village_id?: string | null;
    wa_user_id?: string | null;
    session_id?: string | null;
    channel?: string | null;
    intent?: string | null;
    success?: boolean;
    duration_ms?: number | null;
    key_source?: string | null;
    key_id?: string | null;
    key_tier?: string | null;
  }
): { inputTokens: number; outputTokens: number; totalTokens: number } {
  const meta: UsageMetadata = geminiResult?.response?.usageMetadata ?? {};
  const inputTokens = meta.promptTokenCount ?? 0;
  const outputTokens = meta.candidatesTokenCount ?? 0;
  const totalTokens = meta.totalTokenCount ?? (inputTokens + outputTokens);

  // Fire and forget
  recordTokenUsage({
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    layer_type,
    call_type,
    ...context,
  });

  return { inputTokens, outputTokens, totalTokens };
}

// ==================== Read / Aggregation Queries ====================

type Period = 'day' | 'week' | 'month';

function periodToDateTrunc(period: Period): string {
  switch (period) {
    case 'day': return 'day';
    case 'week': return 'week';
    case 'month': return 'month';
  }
}

function defaultRange(period: Period): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date();
  switch (period) {
    case 'day': start.setDate(start.getDate() - 30); break;
    case 'week': start.setDate(start.getDate() - 90); break;
    case 'month': start.setMonth(start.getMonth() - 12); break;
  }
  return { start, end };
}

/**
 * Token usage grouped by time period.
 */
export async function getUsageByPeriod(
  period: Period = 'day',
  filters?: { village_id?: string; model?: string; start?: string; end?: string }
): Promise<any[]> {
  const trunc = periodToDateTrunc(period);
  const range = defaultRange(period);
  const startDate = filters?.start ? new Date(filters.start) : range.start;
  const endDate = filters?.end ? new Date(filters.end) : range.end;

  const conditions: Prisma.Sql[] = [Prisma.sql`created_at >= ${startDate} AND created_at <= ${endDate}`];
  if (filters?.village_id) conditions.push(Prisma.sql`village_id = ${filters.village_id}`);
  if (filters?.model) conditions.push(Prisma.sql`model = ${filters.model}`);

  const where = Prisma.join(conditions, ' AND ');

  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT
      date_trunc(${trunc}, created_at) AS period_start,
      SUM(input_tokens)::int AS input_tokens,
      SUM(output_tokens)::int AS output_tokens,
      SUM(total_tokens)::int AS total_tokens,
      SUM(cost_usd)::float AS cost_usd,
      COUNT(*)::int AS call_count
    FROM ai_token_usage
    WHERE ${where}
    GROUP BY period_start
    ORDER BY period_start ASC
  `);

  return rows.map(r => ({
    ...r,
    period_start: r.period_start instanceof Date ? r.period_start.toISOString() : r.period_start,
  }));
}

/**
 * Token usage grouped by model.
 */
export async function getUsageByModel(
  filters?: { village_id?: string; start?: string; end?: string }
): Promise<any[]> {
  const range = defaultRange('month');
  const startDate = filters?.start ? new Date(filters.start) : range.start;
  const endDate = filters?.end ? new Date(filters.end) : range.end;

  const conditions: Prisma.Sql[] = [Prisma.sql`created_at >= ${startDate} AND created_at <= ${endDate}`];
  if (filters?.village_id) conditions.push(Prisma.sql`village_id = ${filters.village_id}`);

  const where = Prisma.join(conditions, ' AND ');

  return prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT
      model,
      SUM(input_tokens)::int AS input_tokens,
      SUM(output_tokens)::int AS output_tokens,
      SUM(total_tokens)::int AS total_tokens,
      SUM(cost_usd)::float AS cost_usd,
      COUNT(*)::int AS call_count,
      AVG(duration_ms)::int AS avg_duration_ms
    FROM ai_token_usage
    WHERE ${where}
    GROUP BY model
    ORDER BY total_tokens DESC
  `);
}

/**
 * Token usage per village.
 */
export async function getUsageByVillage(
  filters?: { model?: string; start?: string; end?: string }
): Promise<any[]> {
  const range = defaultRange('month');
  const startDate = filters?.start ? new Date(filters.start) : range.start;
  const endDate = filters?.end ? new Date(filters.end) : range.end;

  const conditions: Prisma.Sql[] = [
    Prisma.sql`created_at >= ${startDate} AND created_at <= ${endDate}`,
    Prisma.sql`village_id IS NOT NULL`,
  ];
  if (filters?.model) conditions.push(Prisma.sql`model = ${filters.model}`);

  const where = Prisma.join(conditions, ' AND ');

  return prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT
      village_id,
      SUM(input_tokens)::int AS input_tokens,
      SUM(output_tokens)::int AS output_tokens,
      SUM(total_tokens)::int AS total_tokens,
      SUM(cost_usd)::float AS cost_usd,
      COUNT(*)::int AS call_count
    FROM ai_token_usage
    WHERE ${where}
    GROUP BY village_id
    ORDER BY total_tokens DESC
  `);
}

/**
 * Micro NLU vs Full NLU breakdown.
 */
export async function getLayerBreakdown(
  filters?: { village_id?: string; start?: string; end?: string }
): Promise<any[]> {
  const range = defaultRange('month');
  const startDate = filters?.start ? new Date(filters.start) : range.start;
  const endDate = filters?.end ? new Date(filters.end) : range.end;

  const conditions: Prisma.Sql[] = [Prisma.sql`created_at >= ${startDate} AND created_at <= ${endDate}`];
  if (filters?.village_id) conditions.push(Prisma.sql`village_id = ${filters.village_id}`);

  const where = Prisma.join(conditions, ' AND ');

  return prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT
      layer_type,
      call_type,
      model,
      SUM(input_tokens)::int AS input_tokens,
      SUM(output_tokens)::int AS output_tokens,
      SUM(total_tokens)::int AS total_tokens,
      SUM(cost_usd)::float AS cost_usd,
      COUNT(*)::int AS call_count,
      AVG(duration_ms)::int AS avg_duration_ms
    FROM ai_token_usage
    WHERE ${where}
    GROUP BY layer_type, call_type, model
    ORDER BY layer_type, call_count DESC
  `);
}

/**
 * Average tokens per chat (only main_chat calls = actual citizen messages).
 */
export async function getAvgTokensPerChat(
  filters?: { village_id?: string; start?: string; end?: string }
): Promise<{ avg_input: number; avg_output: number; avg_total: number; total_chats: number }> {
  const range = defaultRange('month');
  const startDate = filters?.start ? new Date(filters.start) : range.start;
  const endDate = filters?.end ? new Date(filters.end) : range.end;

  const conditions: Prisma.Sql[] = [
    Prisma.sql`created_at >= ${startDate} AND created_at <= ${endDate}`,
    Prisma.sql`call_type = 'main_chat'`,
  ];
  if (filters?.village_id) conditions.push(Prisma.sql`village_id = ${filters.village_id}`);

  const where = Prisma.join(conditions, ' AND ');

  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT
      COALESCE(AVG(input_tokens), 0)::int AS avg_input,
      COALESCE(AVG(output_tokens), 0)::int AS avg_output,
      COALESCE(AVG(total_tokens), 0)::int AS avg_total,
      COUNT(*)::int AS total_chats
    FROM ai_token_usage
    WHERE ${where}
  `);

  return rows[0] ?? { avg_input: 0, avg_output: 0, avg_total: 0, total_chats: 0 };
}

/**
 * AI response count per village (only main_chat — actual messages sent back to citizens).
 * Excludes micro LLM internal calls.
 */
export async function getResponseCountByVillage(
  filters?: { start?: string; end?: string }
): Promise<any[]> {
  const range = defaultRange('month');
  const startDate = filters?.start ? new Date(filters.start) : range.start;
  const endDate = filters?.end ? new Date(filters.end) : range.end;

  return prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT
      village_id,
      COUNT(*)::int AS response_count,
      COUNT(DISTINCT wa_user_id)::int AS unique_users
    FROM ai_token_usage
    WHERE created_at >= ${startDate}
      AND created_at <= ${endDate}
      AND call_type = 'main_chat'
      AND village_id IS NOT NULL
    GROUP BY village_id
    ORDER BY response_count DESC
  `);
}

/**
 * Detailed usage per village + model (for drill-down table).
 */
export async function getUsageByVillageAndModel(
  filters?: { village_id?: string; start?: string; end?: string }
): Promise<any[]> {
  const range = defaultRange('month');
  const startDate = filters?.start ? new Date(filters.start) : range.start;
  const endDate = filters?.end ? new Date(filters.end) : range.end;

  const conditions: Prisma.Sql[] = [
    Prisma.sql`created_at >= ${startDate} AND created_at <= ${endDate}`,
  ];

  // Support special __null__ to query superadmin testing data (village_id IS NULL)
  if (filters?.village_id === '__null__') {
    conditions.push(Prisma.sql`village_id IS NULL`);
  } else if (filters?.village_id) {
    conditions.push(Prisma.sql`village_id = ${filters.village_id}`);
  } else {
    conditions.push(Prisma.sql`village_id IS NOT NULL`);
  }

  const where = Prisma.join(conditions, ' AND ');

  return prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT
      village_id,
      model,
      layer_type,
      SUM(input_tokens)::int AS input_tokens,
      SUM(output_tokens)::int AS output_tokens,
      SUM(total_tokens)::int AS total_tokens,
      SUM(cost_usd)::float AS cost_usd,
      COUNT(*)::int AS call_count
    FROM ai_token_usage
    WHERE ${where}
    GROUP BY village_id, model, layer_type
    ORDER BY village_id, total_tokens DESC
  `);
}

/**
 * Token usage over time, split by layer_type (for stacked chart).
 */
export async function getUsageByPeriodAndLayer(
  period: Period = 'day',
  filters?: { village_id?: string; start?: string; end?: string }
): Promise<any[]> {
  const trunc = periodToDateTrunc(period);
  const range = defaultRange(period);
  const startDate = filters?.start ? new Date(filters.start) : range.start;
  const endDate = filters?.end ? new Date(filters.end) : range.end;

  const conditions: Prisma.Sql[] = [Prisma.sql`created_at >= ${startDate} AND created_at <= ${endDate}`];
  if (filters?.village_id) conditions.push(Prisma.sql`village_id = ${filters.village_id}`);

  const where = Prisma.join(conditions, ' AND ');

  return prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT
      date_trunc(${trunc}, created_at) AS period_start,
      layer_type,
      SUM(input_tokens)::int AS input_tokens,
      SUM(output_tokens)::int AS output_tokens,
      SUM(total_tokens)::int AS total_tokens,
      SUM(cost_usd)::float AS cost_usd,
      COUNT(*)::int AS call_count
    FROM ai_token_usage
    WHERE ${where}
    GROUP BY period_start, layer_type
    ORDER BY period_start ASC, layer_type
  `);
}

// ==================== Summary for quick dashboard card ====================

export async function getTokenUsageSummary(
  filters?: { village_id?: string; start?: string; end?: string }
): Promise<{
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_cost_usd: number;
  total_calls: number;
  micro_nlu_calls: number;
  full_nlu_calls: number;
  micro_nlu_tokens: number;
  full_nlu_tokens: number;
  embedding_calls: number;
  embedding_tokens: number;
  embedding_cost: number;
  rag_expand_calls: number;
  rag_expand_tokens: number;
  main_chat_calls: number;
  main_chat_tokens: number;
  main_chat_cost: number;
  full_nlu_cost: number;
  micro_nlu_cost: number;
}> {
  const range = defaultRange('month');
  const startDate = filters?.start ? new Date(filters.start) : range.start;
  const endDate = filters?.end ? new Date(filters.end) : range.end;

  const conditions: Prisma.Sql[] = [Prisma.sql`created_at >= ${startDate} AND created_at <= ${endDate}`];
  if (filters?.village_id) conditions.push(Prisma.sql`village_id = ${filters.village_id}`);

  const where = Prisma.join(conditions, ' AND ');

  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT
      COALESCE(SUM(input_tokens), 0)::int AS total_input_tokens,
      COALESCE(SUM(output_tokens), 0)::int AS total_output_tokens,
      COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
      COALESCE(SUM(cost_usd), 0)::float AS total_cost_usd,
      COUNT(*)::int AS total_calls,
      COALESCE(SUM(CASE WHEN layer_type = 'micro_nlu' THEN 1 ELSE 0 END), 0)::int AS micro_nlu_calls,
      COALESCE(SUM(CASE WHEN layer_type = 'full_nlu' THEN 1 ELSE 0 END), 0)::int AS full_nlu_calls,
      COALESCE(SUM(CASE WHEN layer_type = 'micro_nlu' THEN total_tokens ELSE 0 END), 0)::int AS micro_nlu_tokens,
      COALESCE(SUM(CASE WHEN layer_type = 'full_nlu' THEN total_tokens ELSE 0 END), 0)::int AS full_nlu_tokens,
      COALESCE(SUM(CASE WHEN layer_type = 'embedding' THEN 1 ELSE 0 END), 0)::int AS embedding_calls,
      COALESCE(SUM(CASE WHEN layer_type = 'embedding' THEN total_tokens ELSE 0 END), 0)::int AS embedding_tokens,
      COALESCE(SUM(CASE WHEN layer_type = 'embedding' THEN cost_usd ELSE 0 END), 0)::float AS embedding_cost,
      COALESCE(SUM(CASE WHEN layer_type = 'rag_expand' THEN 1 ELSE 0 END), 0)::int AS rag_expand_calls,
      COALESCE(SUM(CASE WHEN layer_type = 'rag_expand' THEN total_tokens ELSE 0 END), 0)::int AS rag_expand_tokens,
      COALESCE(SUM(CASE WHEN call_type = 'main_chat' THEN 1 ELSE 0 END), 0)::int AS main_chat_calls,
      COALESCE(SUM(CASE WHEN call_type = 'main_chat' THEN total_tokens ELSE 0 END), 0)::int AS main_chat_tokens,
      COALESCE(SUM(CASE WHEN call_type = 'main_chat' THEN cost_usd ELSE 0 END), 0)::float AS main_chat_cost,
      COALESCE(SUM(CASE WHEN layer_type = 'full_nlu' THEN cost_usd ELSE 0 END), 0)::float AS full_nlu_cost,
      COALESCE(SUM(CASE WHEN layer_type = 'micro_nlu' THEN cost_usd ELSE 0 END), 0)::float AS micro_nlu_cost
    FROM ai_token_usage
    WHERE ${where}
  `);

  return rows[0] ?? {
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_tokens: 0,
    total_cost_usd: 0,
    total_calls: 0,
    micro_nlu_calls: 0,
    full_nlu_calls: 0,
    micro_nlu_tokens: 0,
    full_nlu_tokens: 0,
    embedding_calls: 0,
    embedding_tokens: 0,
    embedding_cost: 0,
    rag_expand_calls: 0,
    rag_expand_tokens: 0,
    main_chat_calls: 0,
    main_chat_tokens: 0,
    main_chat_cost: 0,
    full_nlu_cost: 0,
    micro_nlu_cost: 0,
  };
}

/**
 * Get token usage breakdown by key source (BYOK vs ENV).
 * Returns aggregated totals per source for the given slug filter.
 */
export async function getTokenUsageBySource(slug?: string) {
  const conditions: Prisma.Sql[] = [];
  if (slug) conditions.push(Prisma.sql`village_id = ${slug}`);

  const where = conditions.length > 0
    ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
    : Prisma.empty;

  return prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT
      COALESCE(key_source, 'unknown') AS source,
      COUNT(*)::int AS total_calls,
      COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
      COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
      COALESCE(SUM(output_tokens), 0)::int AS output_tokens,
      COALESCE(SUM(cost_usd), 0)::float AS total_cost_usd
    FROM ai_token_usage
    ${where}
    GROUP BY COALESCE(key_source, 'unknown')
    ORDER BY total_tokens DESC
  `);
}
