/**
 * Token Usage Tracking Service
 *
 * Persists actual LLM token usage to PostgreSQL.
 * Provides aggregation queries for the AI Usage dashboard.
 *
 * Default legacy pricing reference (USD per 1M tokens) used only when no DB model pricing
 * can be resolved for a recorded usage row:
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
import { config } from '../config/env';
import { getCurrentBillingContext, registerUsageWrite } from './ai-turn-billing.service';

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

const unknownPricingModels = new Set<string>();

/** Find legacy pricing for a model name. */
export function findPricing(model: string): { input: number; output: number } {
  if (PRICING[model]) return PRICING[model];
  // Prefix match (longest key first)
  const keys = Object.keys(PRICING).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (model.startsWith(key)) return PRICING[key];
  }

  if (!unknownPricingModels.has(model)) {
    unknownPricingModels.add(model);
    logger.warn('No pricing configured for model, defaulting cost to 0', { model });
  }

  return { input: 0, output: 0 };
}

function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = findPricing(model);
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

// ==================== Types ====================

export type LayerType = 'full_nlu' | 'micro_nlu' | 'embedding' | 'rag_expand' | 'rag_rerank' | 'agent';

export type CallType =
  | 'main_chat'
  | 'anti_hallucination_retry'
  | 'complaint_type_match'
  | 'service_slug_match'
  | 'rag_query_expand'
  | 'confirmation_classify'
  | 'farewell_classify'
  | 'greeting_classify'
  | 'name_update_classify'
  | 'rag_intent_classify'
  | 'unified_classify'
  | 'connection_test'
  | 'embedding_single'
  | 'embedding_batch'
  | 'name_extraction'
  | 'knowledge_subtype'
  | 'address_analysis'
  | 'contact_match'
  | 'update_intent'
  | 'profile_query_classify'
  | 'summarize'
  | 'hallucination_check'
  | 'sentiment_urgency'
  | 'rerank_documents'
  | 'agent_orchestrator'
  | 'media_analysis';

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
  key_source?: string | null;  // "gateway_<lane>" | legacy values like "byok" / "env"
  key_id?: string | null;      // gateway key label or legacy key identifier
  key_tier?: string | null;    // active gateway provider or legacy tier label
  provider_id?: string | null;
  model_config_id?: string | null;
  lane_type?: string | null;
  message_id?: string | null;
  trace_id?: string | null;
  billing_group_id?: string | null;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  cache_read_discount_ratio?: number;
  cache_write_multiplier?: number;
  cache_status?: string | null;
  cache_provider?: string | null;
  actual_cost_usd?: number | null;
  adjusted_cost_usd?: number | null;
  margin_usd?: number | null;
}

interface PricingResolution {
  provider_id: string | null;
  model_config_id: string | null;
  lane_type: string | null;
  actual_cost_usd: number;
  adjusted_cost_usd: number;
  margin_usd: number;
  legacy_cost_usd: number;
  pricing_source: 'db' | 'legacy' | 'override';
  actual_pricing_type: string | null;
  actual_fixed_price_usd: number | null;
  actual_input_price_per_million_usd: number | null;
  actual_output_price_per_million_usd: number | null;
  adjusted_pricing_type: string | null;
  adjusted_fixed_price_usd: number | null;
  adjusted_input_price_per_million_usd: number | null;
  adjusted_output_price_per_million_usd: number | null;
  pricing_snapshot_json: Prisma.InputJsonValue;
}

function calculateCostWithCache(
  pricingType: string | null | undefined,
  fixedPriceUsd: number | null | undefined,
  inputPricePerMillionUsd: number | null | undefined,
  outputPricePerMillionUsd: number | null | undefined,
  inputTokens: number,
  outputTokens: number,
  cache?: {
    cachedInputTokens?: number;
    cacheWriteInputTokens?: number;
    cacheReadDiscountRatio?: number;
    cacheWriteMultiplier?: number;
  },
): number {
  if (pricingType === 'fixed_per_call') {
    return fixedPriceUsd ?? 0;
  }

  const inputPrice = inputPricePerMillionUsd ?? 0;
  const outputCost = (outputTokens * (outputPricePerMillionUsd ?? 0)) / 1_000_000;
  const cachedInputTokens = Math.max(0, Math.min(inputTokens, cache?.cachedInputTokens ?? 0));
  const cacheWriteInputTokens = Math.max(0, Math.min(inputTokens - cachedInputTokens, cache?.cacheWriteInputTokens ?? 0));
  const regularInputTokens = Math.max(0, inputTokens - cachedInputTokens - cacheWriteInputTokens);
  const cacheReadRatio = cache?.cacheReadDiscountRatio ?? 1;
  const cacheWriteMultiplier = cache?.cacheWriteMultiplier ?? 1;
  const inputCost = (
    (regularInputTokens * inputPrice)
    + (cachedInputTokens * inputPrice * cacheReadRatio)
    + (cacheWriteInputTokens * inputPrice * cacheWriteMultiplier)
  ) / 1_000_000;

  return inputCost + outputCost;
}

async function resolvePricing(record: TokenUsageRecord): Promise<PricingResolution> {
  const legacyPricing = findPricing(record.model);
  const legacy_cost_usd = (record.input_tokens * legacyPricing.input + record.output_tokens * legacyPricing.output) / 1_000_000;

  const modelConfig = record.model_config_id
    ? await prisma.ai_models.findUnique({
        where: { id: record.model_config_id },
        select: {
          id: true,
          provider_id: true,
          lane_type: true,
          actual_pricing_type: true,
          actual_fixed_price_usd: true,
          actual_input_price_per_million_usd: true,
          actual_output_price_per_million_usd: true,
          adjusted_pricing_type: true,
          adjusted_fixed_price_usd: true,
          adjusted_input_price_per_million_usd: true,
          adjusted_output_price_per_million_usd: true,
        },
      })
    : await prisma.ai_models.findFirst({
        where: {
          upstream_model_name: record.model,
          is_active: true,
          ...(record.lane_type ? { lane_type: record.lane_type } : {}),
          ...(record.provider_id ? { provider_id: record.provider_id } : {}),
        },
        orderBy: { updated_at: 'desc' },
        select: {
          id: true,
          provider_id: true,
          lane_type: true,
          actual_pricing_type: true,
          actual_fixed_price_usd: true,
          actual_input_price_per_million_usd: true,
          actual_output_price_per_million_usd: true,
          adjusted_pricing_type: true,
          adjusted_fixed_price_usd: true,
          adjusted_input_price_per_million_usd: true,
          adjusted_output_price_per_million_usd: true,
        },
      });

  const cachePricing = {
    cachedInputTokens: record.cached_input_tokens,
    cacheWriteInputTokens: record.cache_write_input_tokens,
    cacheReadDiscountRatio: record.cache_read_discount_ratio,
    cacheWriteMultiplier: record.cache_write_multiplier,
  };

  const actual_cost_usd = record.actual_cost_usd ?? (modelConfig
    ? calculateCostWithCache(
        modelConfig.actual_pricing_type,
        modelConfig.actual_fixed_price_usd,
        modelConfig.actual_input_price_per_million_usd,
        modelConfig.actual_output_price_per_million_usd,
        record.input_tokens,
        record.output_tokens,
        cachePricing,
      )
    : legacy_cost_usd);

  const adjusted_cost_usd = record.adjusted_cost_usd ?? (modelConfig
    ? calculateCostWithCache(
        modelConfig.adjusted_pricing_type,
        modelConfig.adjusted_fixed_price_usd,
        modelConfig.adjusted_input_price_per_million_usd,
        modelConfig.adjusted_output_price_per_million_usd,
        record.input_tokens,
        record.output_tokens,
        cachePricing,
      )
    : legacy_cost_usd);

  const margin_usd = record.margin_usd ?? (adjusted_cost_usd - actual_cost_usd);
  const pricing_source: PricingResolution['pricing_source'] = record.actual_cost_usd != null || record.adjusted_cost_usd != null
    ? 'override'
    : modelConfig
      ? 'db'
      : 'legacy';
  const actual_pricing_type = modelConfig?.actual_pricing_type ?? (pricing_source === 'legacy' ? 'per_million_tokens' : null);
  const actual_fixed_price_usd = modelConfig?.actual_fixed_price_usd ?? null;
  const actual_input_price_per_million_usd = modelConfig?.actual_input_price_per_million_usd ?? (pricing_source === 'legacy' ? legacyPricing.input : null);
  const actual_output_price_per_million_usd = modelConfig?.actual_output_price_per_million_usd ?? (pricing_source === 'legacy' ? legacyPricing.output : null);
  const adjusted_pricing_type = modelConfig?.adjusted_pricing_type ?? (pricing_source === 'legacy' ? 'per_million_tokens' : null);
  const adjusted_fixed_price_usd = modelConfig?.adjusted_fixed_price_usd ?? null;
  const adjusted_input_price_per_million_usd = modelConfig?.adjusted_input_price_per_million_usd ?? (pricing_source === 'legacy' ? legacyPricing.input : null);
  const adjusted_output_price_per_million_usd = modelConfig?.adjusted_output_price_per_million_usd ?? (pricing_source === 'legacy' ? legacyPricing.output : null);
  const pricing_snapshot_json = {
    source: pricing_source,
    model: record.model,
    model_config_id: record.model_config_id ?? modelConfig?.id ?? null,
    provider_id: record.provider_id ?? modelConfig?.provider_id ?? null,
    actual: {
      pricing_type: actual_pricing_type,
      fixed_price_usd: actual_fixed_price_usd,
      input_price_per_million_usd: actual_input_price_per_million_usd,
      output_price_per_million_usd: actual_output_price_per_million_usd,
    },
    adjusted: {
      pricing_type: adjusted_pricing_type,
      fixed_price_usd: adjusted_fixed_price_usd,
      input_price_per_million_usd: adjusted_input_price_per_million_usd,
      output_price_per_million_usd: adjusted_output_price_per_million_usd,
    },
    cache: {
      provider: record.cache_provider ?? null,
      status: record.cache_status ?? null,
      cached_input_tokens: record.cached_input_tokens ?? 0,
      cache_write_input_tokens: record.cache_write_input_tokens ?? 0,
      cache_read_discount_ratio: record.cache_read_discount_ratio ?? null,
      cache_write_multiplier: record.cache_write_multiplier ?? null,
    },
  } as Prisma.InputJsonValue;

  return {
    provider_id: record.provider_id ?? modelConfig?.provider_id ?? null,
    model_config_id: record.model_config_id ?? modelConfig?.id ?? null,
    lane_type: record.lane_type ?? modelConfig?.lane_type ?? null,
    actual_cost_usd,
    adjusted_cost_usd,
    margin_usd,
    legacy_cost_usd,
    pricing_source,
    actual_pricing_type,
    actual_fixed_price_usd,
    actual_input_price_per_million_usd,
    actual_output_price_per_million_usd,
    adjusted_pricing_type,
    adjusted_fixed_price_usd,
    adjusted_input_price_per_million_usd,
    adjusted_output_price_per_million_usd,
    pricing_snapshot_json,
  };
}

export async function findPricingForModel(model: string): Promise<{ input: number; output: number }> {
  const modelConfig = await prisma.ai_models.findFirst({
    where: {
      upstream_model_name: model,
      is_active: true,
    },
    orderBy: { updated_at: 'desc' },
    select: {
      adjusted_pricing_type: true,
      adjusted_fixed_price_usd: true,
      adjusted_input_price_per_million_usd: true,
      adjusted_output_price_per_million_usd: true,
    },
  });

  if (!modelConfig) {
    return findPricing(model);
  }

  if (modelConfig.adjusted_pricing_type === 'fixed_per_call') {
    return { input: modelConfig.adjusted_fixed_price_usd ?? 0, output: 0 };
  }

  return {
    input: modelConfig.adjusted_input_price_per_million_usd ?? 0,
    output: modelConfig.adjusted_output_price_per_million_usd ?? 0,
  };
}

export async function calculateCostForModel(model: string, inputTokens: number, outputTokens: number): Promise<number> {
  const pricing = await findPricingForModel(model);
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

function getLaneTypeFromKeySource(keySource?: string | null): string | null {
  if (!keySource?.startsWith('gateway_')) {
    return null;
  }

  const lane = keySource.replace('gateway_', '').trim();
  return lane || null;
}

async function attachResolvedPricing(record: TokenUsageRecord): Promise<{ record: TokenUsageRecord; pricing: PricingResolution }> {
  const lane_type = record.lane_type ?? getLaneTypeFromKeySource(record.key_source);
  const pricedRecord = { ...record, lane_type };
  const pricing = await resolvePricing(pricedRecord);

  return {
    record: {
      ...pricedRecord,
      provider_id: pricing.provider_id,
      model_config_id: pricing.model_config_id,
      lane_type: pricing.lane_type,
      actual_cost_usd: pricing.actual_cost_usd,
      adjusted_cost_usd: pricing.adjusted_cost_usd,
      margin_usd: pricing.margin_usd,
    },
    pricing,
  };
}

export type { PricingResolution };

export async function resolveTokenUsagePricing(record: TokenUsageRecord): Promise<PricingResolution> {
  return resolvePricing(record);
}

export async function resolveTokenUsageRecord(record: TokenUsageRecord): Promise<TokenUsageRecord> {
  return (await attachResolvedPricing(record)).record;
}

export async function ensureTokenUsagePricing(record: TokenUsageRecord): Promise<{ record: TokenUsageRecord; pricing: PricingResolution }> {
  return attachResolvedPricing(record);
}

export async function calculateLegacyCost(record: TokenUsageRecord): Promise<number> {
  return calculateCost(record.model, record.input_tokens, record.output_tokens);
}

export async function getLatestModelConfigForLane(lane: string | null | undefined, model: string) {
  return prisma.ai_models.findFirst({
    where: {
      upstream_model_name: model,
      is_active: true,
      ...(lane ? { lane_type: lane } : {}),
    },
    orderBy: { updated_at: 'desc' },
    select: {
      id: true,
      provider_id: true,
      lane_type: true,
    },
  });
}

export async function enrichTokenUsageRecord(record: TokenUsageRecord): Promise<TokenUsageRecord> {
  return (await attachResolvedPricing(record)).record;
}

export async function enrichAndResolveTokenUsage(record: TokenUsageRecord): Promise<{ record: TokenUsageRecord; pricing: PricingResolution }> {
  return attachResolvedPricing(record);
}

export type TokenUsageWriteRecord = TokenUsageRecord;

export async function calculatePersistedCost(record: TokenUsageRecord): Promise<PricingResolution> {
  return resolvePricing(record);
}

export async function recordResolvedTokenUsage(record: TokenUsageRecord): Promise<void> {
  await recordTokenUsage(record);
}

export async function resolveDbBackedTokenUsage(record: TokenUsageRecord): Promise<{ record: TokenUsageRecord; pricing: PricingResolution }> {
  return attachResolvedPricing(record);
}

export async function getDbBackedPricing(record: TokenUsageRecord): Promise<PricingResolution> {
  return resolvePricing(record);
}

export async function getDbBackedTokenUsage(record: TokenUsageRecord): Promise<TokenUsageRecord> {
  return (await attachResolvedPricing(record)).record;
}

export async function attachDbPricing(record: TokenUsageRecord): Promise<TokenUsageRecord> {
  return (await attachResolvedPricing(record)).record;
}

export async function resolveDbPricing(record: TokenUsageRecord): Promise<PricingResolution> {
  return resolvePricing(record);
}

export async function getResolvedPricing(record: TokenUsageRecord): Promise<PricingResolution> {
  return resolvePricing(record);
}

export async function getResolvedTokenUsageRecord(record: TokenUsageRecord): Promise<TokenUsageRecord> {
  return (await attachResolvedPricing(record)).record;
}

export async function getResolvedTokenUsagePricing(record: TokenUsageRecord): Promise<PricingResolution> {
  return resolvePricing(record);
}

export async function populateTokenUsageRecord(record: TokenUsageRecord): Promise<TokenUsageRecord> {
  return (await attachResolvedPricing(record)).record;
}

export async function populateTokenUsagePricing(record: TokenUsageRecord): Promise<TokenUsageRecord> {
  return (await attachResolvedPricing(record)).record;
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
export async function recordTokenUsage(record: TokenUsageRecord): Promise<string | null> {
  try {
    const { record: resolvedRecord, pricing } = await attachResolvedPricing(record);
    const billingContext = getCurrentBillingContext();
    const messageId = resolvedRecord.message_id ?? billingContext?.message_id ?? null;
    const traceId = resolvedRecord.trace_id ?? billingContext?.trace_id ?? null;
    const billingGroupId = resolvedRecord.billing_group_id ?? billingContext?.billing_group_id ?? null;
    const resolvedVillageId = resolvedRecord.village_id ?? billingContext?.village_id ?? null;

    if (config.nodeEnv === 'production' && resolvedVillageId && !billingGroupId && (pricing.adjusted_cost_usd > 0 || pricing.actual_cost_usd > 0)) {
      logger.error('Billable token usage recorded without billing turn context', {
        model: resolvedRecord.model,
        layer_type: resolvedRecord.layer_type,
        call_type: resolvedRecord.call_type,
        village_id: resolvedVillageId,
        adjusted_cost_usd: pricing.adjusted_cost_usd,
      });
    }

    const created = await prisma.ai_token_usage.create({
      data: {
        model: resolvedRecord.model,
        input_tokens: resolvedRecord.input_tokens,
        output_tokens: resolvedRecord.output_tokens,
        total_tokens: resolvedRecord.total_tokens,
        cost_usd: pricing.adjusted_cost_usd,
        layer_type: resolvedRecord.layer_type,
        call_type: resolvedRecord.call_type,
        village_id: resolvedVillageId,
        wa_user_id: resolvedRecord.wa_user_id ?? billingContext?.wa_user_id ?? null,
        session_id: resolvedRecord.session_id ?? billingContext?.session_id ?? null,
        channel: resolvedRecord.channel ?? billingContext?.channel ?? null,
        message_id: messageId,
        trace_id: traceId,
        billing_group_id: billingGroupId,
        billing_status: billingGroupId ? 'unbilled' : 'not_billable',
        intent: resolvedRecord.intent ?? null,
        success: resolvedRecord.success ?? true,
        duration_ms: resolvedRecord.duration_ms ?? null,
        key_source: resolvedRecord.key_source ?? null,
        key_id: resolvedRecord.key_id ?? null,
        key_tier: resolvedRecord.key_tier ?? null,
        provider_id: resolvedRecord.provider_id ?? null,
        model_config_id: resolvedRecord.model_config_id ?? null,
        lane_type: resolvedRecord.lane_type ?? null,
        actual_cost_usd: pricing.actual_cost_usd,
        adjusted_cost_usd: pricing.adjusted_cost_usd,
        margin_usd: pricing.margin_usd,
        pricing_source: pricing.pricing_source,
        actual_pricing_type: pricing.actual_pricing_type,
        actual_fixed_price_usd: pricing.actual_fixed_price_usd,
        actual_input_price_per_million_usd: pricing.actual_input_price_per_million_usd,
        actual_output_price_per_million_usd: pricing.actual_output_price_per_million_usd,
        adjusted_pricing_type: pricing.adjusted_pricing_type,
        adjusted_fixed_price_usd: pricing.adjusted_fixed_price_usd,
        adjusted_input_price_per_million_usd: pricing.adjusted_input_price_per_million_usd,
        adjusted_output_price_per_million_usd: pricing.adjusted_output_price_per_million_usd,
        pricing_snapshot_json: pricing.pricing_snapshot_json,
      },
    });

    logger.debug('📊 Token usage recorded', {
      model: resolvedRecord.model,
      layer: resolvedRecord.layer_type,
      call: resolvedRecord.call_type,
      tokens: resolvedRecord.total_tokens,
      adjusted_cost_usd: pricing.adjusted_cost_usd.toFixed(6),
      actual_cost_usd: pricing.actual_cost_usd.toFixed(6),
      margin_usd: pricing.margin_usd.toFixed(6),
      pricing_source: pricing.pricing_source,
      billing_group_id: billingGroupId,
    });

    return created.id;
  } catch (error: any) {
    logger.error('❌ Failed to record token usage', {
      error: error.message,
      model: record.model,
    });
    return null;
  }
}

/**
 * Helper: extract provider usage metadata from a usageMetadata-style result and record it.
 */
export function extractAndRecord(
  providerResult: any,
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
  const meta: UsageMetadata = providerResult?.response?.usageMetadata ?? {};
  const inputTokens = meta.promptTokenCount ?? 0;
  const outputTokens = meta.candidatesTokenCount ?? 0;
  const totalTokens = meta.totalTokenCount ?? (inputTokens + outputTokens);

  // Fire and forget
  const usageWrite = recordTokenUsage({
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    layer_type,
    call_type,
    ...context,
  });
  registerUsageWrite(usageWrite);

  return { inputTokens, outputTokens, totalTokens };
}

// ==================== Read / Aggregation Queries ====================

type Period = 'day' | 'week' | 'month';
type UsageFilters = { village_id?: string | null; model?: string | null; start?: string | null; end?: string | null; wa_user_id?: string | null; session_id?: string | null };

function applyCommonFilters(conditions: Prisma.Sql[], filters?: UsageFilters) {
  if (filters?.village_id) conditions.push(Prisma.sql`village_id = ${filters.village_id}`);
  if (filters?.model) conditions.push(Prisma.sql`model = ${filters.model}`);
  if (filters?.wa_user_id) conditions.push(Prisma.sql`wa_user_id = ${filters.wa_user_id}`);
  if (filters?.session_id) conditions.push(Prisma.sql`session_id = ${filters.session_id}`);
}

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
  filters?: UsageFilters
): Promise<any[]> {
  const trunc = periodToDateTrunc(period);
  const range = defaultRange(period);
  const startDate = filters?.start ? new Date(filters.start) : range.start;
  const endDate = filters?.end ? new Date(filters.end) : range.end;

  const conditions: Prisma.Sql[] = [Prisma.sql`created_at >= ${startDate} AND created_at <= ${endDate}`];
  applyCommonFilters(conditions, filters);

  const where = Prisma.join(conditions, ' AND ');

  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT
      date_trunc(${trunc}, created_at) AS period_start,
      SUM(input_tokens)::int AS input_tokens,
      SUM(output_tokens)::int AS output_tokens,
      SUM(total_tokens)::int AS total_tokens,
      SUM(cost_usd)::float AS cost_usd,
      COUNT(*)::int AS call_count
    FROM ai."ai_token_usage"
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
  filters?: UsageFilters
): Promise<any[]> {
  const range = defaultRange('month');
  const startDate = filters?.start ? new Date(filters.start) : range.start;
  const endDate = filters?.end ? new Date(filters.end) : range.end;

  const conditions: Prisma.Sql[] = [Prisma.sql`created_at >= ${startDate} AND created_at <= ${endDate}`];
  applyCommonFilters(conditions, filters);

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
    FROM ai."ai_token_usage"
    WHERE ${where}
    GROUP BY model
    ORDER BY total_tokens DESC
  `);
}

export async function getUsageByProvider(
  filters?: UsageFilters
): Promise<any[]> {
  const range = defaultRange('month');
  const startDate = filters?.start ? new Date(filters.start) : range.start;
  const endDate = filters?.end ? new Date(filters.end) : range.end;
  const villageId = filters?.village_id ?? null;
  const waUserId = filters?.wa_user_id ?? null;
  const sessionId = filters?.session_id ?? null;

  return prisma.$queryRaw<any[]>(Prisma.sql`
    WITH provider_rows AS (
      SELECT
        COALESCE(u.provider_id, '__legacy__') AS provider_key,
        COALESCE(u.provider_id, p.id, '__legacy__') AS provider_id,
        COALESCE(p.name, u.key_tier, 'Legacy / Unknown Provider') AS provider_name,
        COALESCE(p.slug, u.key_tier, 'legacy-unknown') AS provider_slug,
        COALESCE(p.provider_kind, 'legacy') AS provider_kind,
        SUM(u.input_tokens)::int AS input_tokens,
        SUM(u.output_tokens)::int AS output_tokens,
        SUM(u.total_tokens)::int AS total_tokens,
        SUM(u.cost_usd)::float AS cost_usd,
        SUM(u.actual_cost_usd)::float AS actual_cost_usd,
        SUM(u.adjusted_cost_usd)::float AS adjusted_cost_usd,
        SUM(u.margin_usd)::float AS margin_usd,
        COUNT(*)::int AS call_count,
        AVG(u.duration_ms)::int AS avg_duration_ms
      FROM ai."ai_token_usage" u
      LEFT JOIN ai."ai_providers" p ON p.id = u.provider_id
      WHERE u.created_at >= ${startDate}
        AND u.created_at <= ${endDate}
        AND (${villageId}::text IS NULL OR u.village_id = ${villageId})
        AND (${waUserId}::text IS NULL OR u.wa_user_id = ${waUserId})
        AND (${sessionId}::text IS NULL OR u.session_id = ${sessionId})
      GROUP BY COALESCE(u.provider_id, '__legacy__'), COALESCE(u.provider_id, p.id, '__legacy__'), COALESCE(p.name, u.key_tier, 'Legacy / Unknown Provider'), COALESCE(p.slug, u.key_tier, 'legacy-unknown'), COALESCE(p.provider_kind, 'legacy')
    ),
    model_rows AS (
      SELECT
        COALESCE(u.provider_id, '__legacy__') AS provider_key,
        COALESCE(u.model_config_id, m.id, '__legacy__') AS model_config_id,
        u.model,
        COALESCE(m.display_name, u.model) AS display_name,
        COALESCE(u.lane_type, m.lane_type, 'unknown') AS lane_type,
        SUM(u.input_tokens)::int AS input_tokens,
        SUM(u.output_tokens)::int AS output_tokens,
        SUM(u.total_tokens)::int AS total_tokens,
        SUM(u.cost_usd)::float AS cost_usd,
        SUM(u.actual_cost_usd)::float AS actual_cost_usd,
        SUM(u.adjusted_cost_usd)::float AS adjusted_cost_usd,
        SUM(u.margin_usd)::float AS margin_usd,
        COUNT(*)::int AS call_count,
        AVG(u.duration_ms)::int AS avg_duration_ms
      FROM ai."ai_token_usage" u
      LEFT JOIN ai."ai_models" m ON m.id = u.model_config_id
      WHERE u.created_at >= ${startDate}
        AND u.created_at <= ${endDate}
        AND (${villageId}::text IS NULL OR u.village_id = ${villageId})
        AND (${waUserId}::text IS NULL OR u.wa_user_id = ${waUserId})
        AND (${sessionId}::text IS NULL OR u.session_id = ${sessionId})
      GROUP BY COALESCE(u.provider_id, '__legacy__'), COALESCE(u.model_config_id, m.id, '__legacy__'), u.model, COALESCE(m.display_name, u.model), COALESCE(u.lane_type, m.lane_type, 'unknown')
    )
    SELECT
      provider_rows.provider_id,
      provider_rows.provider_name,
      provider_rows.provider_slug,
      provider_rows.provider_kind,
      provider_rows.input_tokens,
      provider_rows.output_tokens,
      provider_rows.total_tokens,
      provider_rows.cost_usd,
      provider_rows.actual_cost_usd,
      provider_rows.adjusted_cost_usd,
      provider_rows.margin_usd,
      provider_rows.call_count,
      provider_rows.avg_duration_ms,
      COALESCE(
        json_agg(
          json_build_object(
            'model_config_id', model_rows.model_config_id,
            'model', model_rows.model,
            'display_name', model_rows.display_name,
            'lane_type', model_rows.lane_type,
            'input_tokens', model_rows.input_tokens,
            'output_tokens', model_rows.output_tokens,
            'total_tokens', model_rows.total_tokens,
            'cost_usd', model_rows.cost_usd,
            'actual_cost_usd', model_rows.actual_cost_usd,
            'adjusted_cost_usd', model_rows.adjusted_cost_usd,
            'margin_usd', model_rows.margin_usd,
            'call_count', model_rows.call_count,
            'avg_duration_ms', model_rows.avg_duration_ms
          ) ORDER BY model_rows.cost_usd DESC, model_rows.total_tokens DESC
        ) FILTER (WHERE model_rows.model IS NOT NULL),
        '[]'::json
      ) AS models
    FROM provider_rows
    LEFT JOIN model_rows ON model_rows.provider_key = provider_rows.provider_key
    GROUP BY provider_rows.provider_key, provider_rows.provider_id, provider_rows.provider_name, provider_rows.provider_slug, provider_rows.provider_kind, provider_rows.input_tokens, provider_rows.output_tokens, provider_rows.total_tokens, provider_rows.cost_usd, provider_rows.actual_cost_usd, provider_rows.adjusted_cost_usd, provider_rows.margin_usd, provider_rows.call_count, provider_rows.avg_duration_ms
    ORDER BY provider_rows.cost_usd DESC, provider_rows.total_tokens DESC
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
    FROM ai."ai_token_usage"
    WHERE ${where}
    GROUP BY village_id
    ORDER BY total_tokens DESC
  `);
}

/**
 * Token usage grouped by intent family for cost observability.
 */
export async function getUsageByIntentFamily(
  filters?: UsageFilters
): Promise<any[]> {
  const range = defaultRange('month');
  const startDate = filters?.start ? new Date(filters.start) : range.start;
  const endDate = filters?.end ? new Date(filters.end) : range.end;

  const conditions: Prisma.Sql[] = [Prisma.sql`created_at >= ${startDate} AND created_at <= ${endDate}`];
  applyCommonFilters(conditions, filters);

  const where = Prisma.join(conditions, ' AND ');

  return prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT
      CASE
        WHEN intent IN ('CREATE_COMPLAINT', 'UPDATE_COMPLAINT', 'CANCEL_REQUEST') THEN 'complaint'
        WHEN intent IN ('CREATE_SERVICE_REQUEST', 'SERVICE_INFO') THEN 'service'
        WHEN intent IN ('CHECK_STATUS', 'HISTORY') THEN 'status_history'
        WHEN intent IN ('KNOWLEDGE_QUERY', 'DOCUMENT_SEARCH', 'QUESTION') THEN 'knowledge'
        WHEN intent IN ('GREETING', 'FAREWELL', 'CONFIRMATION', 'NAME_UPDATE', 'ADDRESS_INPUT') THEN 'conversation'
        WHEN intent IN ('TAKEOVER', 'AGENT_ERROR', 'ERROR') THEN 'handoff_fallback'
        ELSE 'other'
      END AS intent_family,
      COALESCE(intent, 'unknown') AS intent,
      SUM(input_tokens)::int AS input_tokens,
      SUM(output_tokens)::int AS output_tokens,
      SUM(total_tokens)::int AS total_tokens,
      SUM(cost_usd)::float AS cost_usd,
      COUNT(*)::int AS call_count,
      COUNT(DISTINCT COALESCE(session_id, wa_user_id))::int AS unique_conversations
    FROM ai."ai_token_usage"
    WHERE ${where}
    GROUP BY intent_family, COALESCE(intent, 'unknown')
    ORDER BY cost_usd DESC, total_tokens DESC
  `);
}

/**
 * Token usage grouped by tenant + high-level flow.
 */
export async function getUsageByTenantFlow(
  filters?: UsageFilters
): Promise<any[]> {
  const range = defaultRange('month');
  const startDate = filters?.start ? new Date(filters.start) : range.start;
  const endDate = filters?.end ? new Date(filters.end) : range.end;

  const conditions: Prisma.Sql[] = [Prisma.sql`created_at >= ${startDate} AND created_at <= ${endDate}`];
  applyCommonFilters(conditions, filters);

  const where = Prisma.join(conditions, ' AND ');

  return prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT
      COALESCE(village_id, '__unknown__') AS village_id,
      CASE
        WHEN layer_type IN ('embedding', 'rag_expand', 'rag_rerank') THEN 'retrieval'
        WHEN layer_type IN ('micro_nlu', 'full_nlu') THEN 'nlu'
        WHEN layer_type = 'agent' THEN 'agent'
        WHEN call_type = 'main_chat' THEN 'citizen_reply'
        ELSE COALESCE(call_type, 'other')
      END AS flow,
      SUM(input_tokens)::int AS input_tokens,
      SUM(output_tokens)::int AS output_tokens,
      SUM(total_tokens)::int AS total_tokens,
      SUM(cost_usd)::float AS cost_usd,
      COUNT(*)::int AS call_count,
      COUNT(DISTINCT COALESCE(session_id, wa_user_id))::int AS unique_conversations,
      COALESCE(SUM(CASE WHEN success = false THEN 1 ELSE 0 END), 0)::int AS failed_calls
    FROM ai."ai_token_usage"
    WHERE ${where}
    GROUP BY COALESCE(village_id, '__unknown__'), flow
    ORDER BY cost_usd DESC, total_tokens DESC
  `);
}

/**
 * Micro NLU vs Full NLU breakdown.
 */
export async function getLayerBreakdown(
  filters?: UsageFilters
): Promise<any[]> {
  const range = defaultRange('month');
  const startDate = filters?.start ? new Date(filters.start) : range.start;
  const endDate = filters?.end ? new Date(filters.end) : range.end;

  const conditions: Prisma.Sql[] = [Prisma.sql`created_at >= ${startDate} AND created_at <= ${endDate}`];
  applyCommonFilters(conditions, filters);

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
    FROM ai."ai_token_usage"
    WHERE ${where}
    GROUP BY layer_type, call_type, model
    ORDER BY layer_type, call_count DESC
  `);
}

/**
 * Average tokens per chat (only main_chat calls = actual citizen messages).
 */
export async function getAvgTokensPerChat(
  filters?: UsageFilters
): Promise<{ avg_input: number; avg_output: number; avg_total: number; total_chats: number }> {
  const range = defaultRange('month');
  const startDate = filters?.start ? new Date(filters.start) : range.start;
  const endDate = filters?.end ? new Date(filters.end) : range.end;

  const conditions: Prisma.Sql[] = [
    Prisma.sql`created_at >= ${startDate} AND created_at <= ${endDate}`,
    Prisma.sql`call_type = 'main_chat'`,
  ];
  applyCommonFilters(conditions, filters);

  const where = Prisma.join(conditions, ' AND ');

  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT
      COALESCE(AVG(input_tokens), 0)::int AS avg_input,
      COALESCE(AVG(output_tokens), 0)::int AS avg_output,
      COALESCE(AVG(total_tokens), 0)::int AS avg_total,
      COUNT(*)::int AS total_chats
    FROM ai."ai_token_usage"
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
    FROM ai."ai_token_usage"
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
  filters?: UsageFilters
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
  if (filters?.wa_user_id) conditions.push(Prisma.sql`wa_user_id = ${filters.wa_user_id}`);
  if (filters?.session_id) conditions.push(Prisma.sql`session_id = ${filters.session_id}`);

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
    FROM ai."ai_token_usage"
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
  filters?: UsageFilters
): Promise<any[]> {
  const trunc = periodToDateTrunc(period);
  const range = defaultRange(period);
  const startDate = filters?.start ? new Date(filters.start) : range.start;
  const endDate = filters?.end ? new Date(filters.end) : range.end;

  const conditions: Prisma.Sql[] = [Prisma.sql`created_at >= ${startDate} AND created_at <= ${endDate}`];
  applyCommonFilters(conditions, filters);

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
    FROM ai."ai_token_usage"
    WHERE ${where}
    GROUP BY period_start, layer_type
    ORDER BY period_start ASC, layer_type
  `);
}

// ==================== Summary for quick dashboard card ====================

export async function getTokenUsageSummary(
  filters?: UsageFilters
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
  rag_expand_cost: number;
  rag_rerank_calls: number;
  rag_rerank_tokens: number;
  rag_rerank_cost: number;
  agent_calls: number;
  agent_tokens: number;
  agent_cost: number;
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
  applyCommonFilters(conditions, filters);

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
      COALESCE(SUM(CASE WHEN layer_type = 'rag_expand' THEN cost_usd ELSE 0 END), 0)::float AS rag_expand_cost,
      COALESCE(SUM(CASE WHEN layer_type = 'rag_rerank' THEN 1 ELSE 0 END), 0)::int AS rag_rerank_calls,
      COALESCE(SUM(CASE WHEN layer_type = 'rag_rerank' THEN total_tokens ELSE 0 END), 0)::int AS rag_rerank_tokens,
      COALESCE(SUM(CASE WHEN layer_type = 'rag_rerank' THEN cost_usd ELSE 0 END), 0)::float AS rag_rerank_cost,
      COALESCE(SUM(CASE WHEN layer_type = 'agent' THEN 1 ELSE 0 END), 0)::int AS agent_calls,
      COALESCE(SUM(CASE WHEN layer_type = 'agent' THEN total_tokens ELSE 0 END), 0)::int AS agent_tokens,
      COALESCE(SUM(CASE WHEN layer_type = 'agent' THEN cost_usd ELSE 0 END), 0)::float AS agent_cost,
      COALESCE(SUM(CASE WHEN call_type = 'main_chat' THEN 1 ELSE 0 END), 0)::int AS main_chat_calls,
      COALESCE(SUM(CASE WHEN call_type = 'main_chat' THEN total_tokens ELSE 0 END), 0)::int AS main_chat_tokens,
      COALESCE(SUM(CASE WHEN call_type = 'main_chat' THEN cost_usd ELSE 0 END), 0)::float AS main_chat_cost,
      COALESCE(SUM(CASE WHEN layer_type = 'full_nlu' THEN cost_usd ELSE 0 END), 0)::float AS full_nlu_cost,
      COALESCE(SUM(CASE WHEN layer_type = 'micro_nlu' THEN cost_usd ELSE 0 END), 0)::float AS micro_nlu_cost
    FROM ai."ai_token_usage"
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
    rag_expand_cost: 0,
    rag_rerank_calls: 0,
    rag_rerank_tokens: 0,
    rag_rerank_cost: 0,
    agent_calls: 0,
    agent_tokens: 0,
    agent_cost: 0,
    main_chat_calls: 0,
    main_chat_tokens: 0,
    main_chat_cost: 0,
    full_nlu_cost: 0,
    micro_nlu_cost: 0,
  };
}

/**
 * Get token usage breakdown by recorded gateway lane / source.
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
    FROM ai."ai_token_usage"
    ${where}
    GROUP BY COALESCE(key_source, 'unknown')
    ORDER BY total_tokens DESC
  `);
}

/**
 * Reset (delete) all token usage data.
 * Used by superadmin to clear testing/development data.
 * Returns the number of deleted rows.
 */
export async function resetAllTokenUsage(): Promise<number> {
  const result = await prisma.$executeRaw`TRUNCATE TABLE ai."ai_token_usage"`;
  logger.info('🗑️ All token usage data has been reset (TRUNCATE)', { affectedRows: result });
  return result;
}
