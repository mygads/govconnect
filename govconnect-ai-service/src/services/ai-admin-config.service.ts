import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { clearRuntimeGatewayConfigCache } from './ai-runtime-config.service';

type LaneType = 'llm' | 'embed' | 'rewrite' | 'rerank';

function normalizeLaneType(value: string): LaneType {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'llm' || normalized === 'embed' || normalized === 'rewrite' || normalized === 'rerank') {
    return normalized;
  }
  throw new Error('Invalid lane_type');
}

function sanitizeHeaders(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, headerValue]) => typeof headerValue === 'string' && headerValue.trim().length > 0)
      .map(([key, headerValue]) => [key, String(headerValue)])
  );
}

function redactProviderSecret<T extends { api_key_encrypted?: string | null }>(provider: T) {
  const { api_key_encrypted: _apiKeyEncrypted, ...safeProvider } = provider;
  return safeProvider;
}

export async function listAIProviders() {
  const providers = await prisma.ai_providers.findMany({
    include: {
      models: {
        select: {
          id: true,
          lane_type: true,
          display_name: true,
          upstream_model_name: true,
          is_active: true,
        },
      },
    },
    orderBy: [{ is_active: 'desc' }, { updated_at: 'desc' }],
  });

  return providers.map(redactProviderSecret);
}

export async function createAIProvider(input: {
  name: string;
  slug: string;
  provider_kind?: string;
  base_url: string;
  api_key: string;
  default_headers_json?: unknown;
  is_active?: boolean;
}) {
  if (!input.name?.trim()) throw new Error('Provider name is required');
  if (!input.slug?.trim()) throw new Error('Provider slug is required');
  if (!input.base_url?.trim()) throw new Error('Provider base_url is required');
  if (!input.api_key?.trim()) throw new Error('Provider api_key is required');

  const provider = await prisma.ai_providers.create({
    data: {
      name: input.name.trim(),
      slug: input.slug.trim().toLowerCase(),
      provider_kind: (input.provider_kind || 'openai_compatible').trim(),
      base_url: input.base_url.trim(),
      api_key_encrypted: input.api_key.trim(),
      default_headers_json: sanitizeHeaders(input.default_headers_json) ?? Prisma.JsonNull,
      is_active: input.is_active !== false,
    },
  });

  clearRuntimeGatewayConfigCache();
  return redactProviderSecret(provider);
}

export async function listAIModels() {
  return prisma.ai_models.findMany({
    include: {
      provider: {
        select: {
          id: true,
          name: true,
          slug: true,
          provider_kind: true,
          base_url: true,
          is_active: true,
        },
      },
    },
    orderBy: [{ lane_type: 'asc' }, { updated_at: 'desc' }],
  });
}

export async function createAIModel(input: {
  provider_id: string;
  lane_type: string;
  display_name: string;
  upstream_model_name: string;
  endpoint_path?: string | null;
  actual_pricing_type?: string;
  actual_fixed_price_usd?: number | null;
  actual_input_price_per_million_usd?: number | null;
  actual_output_price_per_million_usd?: number | null;
  adjusted_pricing_type?: string;
  adjusted_fixed_price_usd?: number | null;
  adjusted_input_price_per_million_usd?: number | null;
  adjusted_output_price_per_million_usd?: number | null;
  is_active?: boolean;
  is_publicly_selectable?: boolean;
  notes?: string | null;
}) {
  if (!input.provider_id?.trim()) throw new Error('provider_id is required');
  if (!input.display_name?.trim()) throw new Error('display_name is required');
  if (!input.upstream_model_name?.trim()) throw new Error('upstream_model_name is required');

  const laneType = normalizeLaneType(input.lane_type);

  const model = await prisma.ai_models.create({
    data: {
      provider_id: input.provider_id,
      lane_type: laneType,
      display_name: input.display_name.trim(),
      upstream_model_name: input.upstream_model_name.trim(),
      endpoint_path: input.endpoint_path?.trim() || null,
      actual_pricing_type: (input.actual_pricing_type || 'per_million_tokens').trim(),
      actual_fixed_price_usd: input.actual_fixed_price_usd ?? null,
      actual_input_price_per_million_usd: input.actual_input_price_per_million_usd ?? null,
      actual_output_price_per_million_usd: input.actual_output_price_per_million_usd ?? null,
      adjusted_pricing_type: (input.adjusted_pricing_type || 'per_million_tokens').trim(),
      adjusted_fixed_price_usd: input.adjusted_fixed_price_usd ?? null,
      adjusted_input_price_per_million_usd: input.adjusted_input_price_per_million_usd ?? null,
      adjusted_output_price_per_million_usd: input.adjusted_output_price_per_million_usd ?? null,
      is_active: input.is_active !== false,
      is_publicly_selectable: input.is_publicly_selectable !== false,
      notes: input.notes?.trim() || null,
    },
  });

  clearRuntimeGatewayConfigCache();
  return model;
}

export async function listAILaneAssignments() {
  return prisma.ai_lane_assignments.findMany({
    include: {
      primary_model: {
        select: {
          id: true,
          display_name: true,
          upstream_model_name: true,
          lane_type: true,
          provider: {
            select: { id: true, name: true, slug: true },
          },
        },
      },
      fallback_model: {
        select: {
          id: true,
          display_name: true,
          upstream_model_name: true,
          lane_type: true,
          provider: {
            select: { id: true, name: true, slug: true },
          },
        },
      },
    },
    orderBy: [{ lane_type: 'asc' }, { village_id: 'asc' }, { updated_at: 'desc' }],
  });
}

export async function upsertAILaneAssignment(input: {
  lane_type: string;
  primary_model_id: string;
  fallback_model_id?: string | null;
  village_id?: string | null;
  is_global_default?: boolean;
  is_active?: boolean;
}) {
  const laneType = normalizeLaneType(input.lane_type);
  if (!input.primary_model_id?.trim()) throw new Error('primary_model_id is required');
  if (input.fallback_model_id && input.fallback_model_id === input.primary_model_id) {
    throw new Error('fallback_model_id must be different from primary_model_id');
  }

  const [primaryModel, fallbackModel] = await Promise.all([
    prisma.ai_models.findUnique({ where: { id: input.primary_model_id } }),
    input.fallback_model_id ? prisma.ai_models.findUnique({ where: { id: input.fallback_model_id } }) : Promise.resolve(null),
  ]);

  if (!primaryModel) throw new Error('Primary model not found');
  if (primaryModel.lane_type !== laneType) throw new Error('Primary model lane_type does not match assignment lane');
  if (fallbackModel && fallbackModel.lane_type !== laneType) throw new Error('Fallback model lane_type does not match assignment lane');

  const villageId = input.village_id?.trim() || null;
  const isGlobalDefault = villageId ? false : input.is_global_default !== false;
  const existingAssignment = await prisma.ai_lane_assignments.findFirst({
    where: {
      lane_type: laneType,
      village_id: villageId,
      is_global_default: isGlobalDefault,
    },
    select: { id: true },
  });

  const assignment = existingAssignment
    ? await prisma.ai_lane_assignments.update({
        where: { id: existingAssignment.id },
        data: {
          primary_model_id: input.primary_model_id,
          fallback_model_id: input.fallback_model_id || null,
          is_active: input.is_active !== false,
        },
        include: {
          primary_model: true,
          fallback_model: true,
        },
      })
    : await prisma.ai_lane_assignments.create({
        data: {
          lane_type: laneType,
          primary_model_id: input.primary_model_id,
          fallback_model_id: input.fallback_model_id || null,
          village_id: villageId,
          is_global_default: isGlobalDefault,
          is_active: input.is_active !== false,
        },
        include: {
          primary_model: true,
          fallback_model: true,
        },
      });

  clearRuntimeGatewayConfigCache();
  return assignment;
}
