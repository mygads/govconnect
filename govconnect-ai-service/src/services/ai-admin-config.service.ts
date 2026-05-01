import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { config, type ChatGatewayLaneConfig, type EmbeddingGatewayLaneConfig, type RerankGatewayLaneConfig } from '../config/env';
import { encryptSecret } from '../utils/crypto';
import logger from '../utils/logger';
import { clearRuntimeGatewayConfigCache } from './ai-runtime-config.service';
import { sanitizeProviderDefaultHeaders } from '../utils/provider-headers';

type LaneType = 'llm' | 'embed' | 'rewrite' | 'rerank';

function normalizeLaneType(value: string): LaneType {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'llm' || normalized === 'embed' || normalized === 'rewrite' || normalized === 'rerank') {
    return normalized;
  }
  throw new Error('Invalid lane_type');
}

function sanitizeHeaders(value: unknown): Record<string, string> | null {
  const headers = sanitizeProviderDefaultHeaders(value);
  return Object.keys(headers).length > 0 ? headers : null;
}

function normalizeEndpointPath(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) throw new Error('endpoint_path must be a path, not a full URL');
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export const __test_only__ = { sanitizeHeaders, sanitizeProviderDefaultHeaders };

function redactProviderSecret<T extends { api_key_encrypted?: string | null }>(provider: T) {
  const { api_key_encrypted: _apiKeyEncrypted, ...safeProvider } = provider;
  return safeProvider;
}

type EnvLaneConfig = ChatGatewayLaneConfig | EmbeddingGatewayLaneConfig | RerankGatewayLaneConfig;

type EnvManagedMeta = {
  config_source: 'env' | 'db';
  is_read_only: boolean;
  source_lane?: LaneType;
};

const ENV_PROVIDER_SLUG_PREFIX = 'env-';
const ENV_MODEL_NOTE_PREFIX = 'env-managed:';

function toEnvLaneType(sourceLane: string): LaneType {
  return sourceLane === 'rag' ? 'rewrite' : normalizeLaneType(sourceLane);
}

function slugPart(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'default';
}

function envProviderSlug(laneType: LaneType, providerKind: string) {
  return `${ENV_PROVIDER_SLUG_PREFIX}${laneType}-${slugPart(providerKind)}`;
}

function sourceLaneFromProviderSlug(slug?: string | null): LaneType | undefined {
  const match = (slug || '').match(/^env-(llm|embed|rewrite|rerank)-/);
  return match ? (match[1] as LaneType) : undefined;
}

function sourceLaneFromModelNotes(notes?: string | null): LaneType | undefined {
  const match = (notes || '').match(/^env-managed:(llm|embed|rewrite|rerank)$/);
  return match ? (match[1] as LaneType) : undefined;
}

function providerMeta(provider: { slug?: string | null }): EnvManagedMeta {
  const sourceLane = sourceLaneFromProviderSlug(provider.slug);
  return sourceLane
    ? { config_source: 'env', is_read_only: true, source_lane: sourceLane }
    : { config_source: 'db', is_read_only: false };
}

function modelMeta(model: { notes?: string | null; provider?: { slug?: string | null } | null }): EnvManagedMeta {
  const sourceLane = sourceLaneFromModelNotes(model.notes) || sourceLaneFromProviderSlug(model.provider?.slug);
  return sourceLane
    ? { config_source: 'env', is_read_only: true, source_lane: sourceLane }
    : { config_source: 'db', is_read_only: false };
}

function withProviderMeta<T extends { slug?: string | null; models?: Array<Record<string, unknown>> }>(provider: T) {
  const meta = providerMeta(provider);
  return {
    ...provider,
    ...meta,
    models: provider.models?.map((model) => ({ ...model, ...meta })) ?? provider.models,
  };
}

function withModelMeta<T extends { notes?: string | null; provider?: { slug?: string | null } | null }>(model: T) {
  return { ...model, ...modelMeta(model) };
}

function envLaneDefinitions(): Array<{ sourceLane: 'llm' | 'embed' | 'rag' | 'rerank'; laneType: LaneType; laneConfig: EnvLaneConfig; endpointPath: string }> {
  return [
    { sourceLane: 'llm', laneType: 'llm', laneConfig: config.llmGateway, endpointPath: config.llmGateway.chatCompletionsPath },
    { sourceLane: 'embed', laneType: 'embed', laneConfig: config.embeddingGateway, endpointPath: config.embeddingGateway.embeddingsPath },
    { sourceLane: 'rag', laneType: 'rewrite', laneConfig: config.ragGateway, endpointPath: config.ragGateway.chatCompletionsPath },
    { sourceLane: 'rerank', laneType: 'rerank', laneConfig: config.rerankerGateway, endpointPath: config.rerankerGateway.rerankPath },
  ];
}

export async function syncEnvManagedAIConfig() {
  const syncedModelIds: string[] = [];

  for (const lane of envLaneDefinitions()) {
    if (!lane.laneConfig.enabled || lane.laneConfig.provider === 'unconfigured') continue;

    const providerSlug = envProviderSlug(lane.laneType, lane.laneConfig.provider);
    const apiKey = lane.laneConfig.apiKeys[0] || '';
    if (!apiKey) continue;

    const providerData = {
      name: `ENV ${lane.laneType.toUpperCase()} ${lane.laneConfig.provider}`,
      provider_kind: lane.laneConfig.provider,
      base_url: lane.laneConfig.baseUrl,
      api_key_encrypted: encryptSecret(apiKey),
      default_headers_json: sanitizeHeaders(lane.laneConfig.defaultHeaders) ?? Prisma.JsonNull,
      is_active: true,
      priority: 100,
    };

    const existingProvider = await prisma.ai_providers.findUnique({ where: { slug: providerSlug } });
    const provider = existingProvider
      ? await prisma.ai_providers.update({ where: { id: existingProvider.id }, data: providerData })
      : await prisma.ai_providers.create({ data: { ...providerData, slug: providerSlug } });

    const model = await prisma.ai_models.upsert({
      where: {
        provider_id_lane_type_upstream_model_name: {
          provider_id: provider.id,
          lane_type: lane.laneType,
          upstream_model_name: lane.laneConfig.model,
        },
      },
      update: {
        display_name: `ENV ${lane.laneType.toUpperCase()} ${lane.laneConfig.model}`,
        endpoint_path: lane.endpointPath,
        is_active: true,
        is_publicly_selectable: true,
        notes: `${ENV_MODEL_NOTE_PREFIX}${lane.laneType}`,
        priority: 100,
      },
      create: {
        provider_id: provider.id,
        lane_type: lane.laneType,
        display_name: `ENV ${lane.laneType.toUpperCase()} ${lane.laneConfig.model}`,
        upstream_model_name: lane.laneConfig.model,
        endpoint_path: lane.endpointPath,
        actual_pricing_type: 'per_million_tokens',
        adjusted_pricing_type: 'per_million_tokens',
        is_active: true,
        is_publicly_selectable: true,
        notes: `${ENV_MODEL_NOTE_PREFIX}${lane.laneType}`,
        priority: 100,
      },
    });
    syncedModelIds.push(model.id);

    const activeGlobalAssignment = await prisma.ai_lane_assignments.findFirst({
      where: {
        lane_type: lane.laneType,
        village_id: null,
        is_global_default: true,
        is_active: true,
      },
      select: { id: true },
    });

    if (!activeGlobalAssignment) {
      await prisma.ai_lane_assignments.create({
        data: {
          lane_type: lane.laneType,
          primary_model_id: model.id,
          village_id: null,
          is_global_default: true,
          is_active: true,
        },
      });
    }
  }

  if (syncedModelIds.length > 0) {
    clearRuntimeGatewayConfigCache();
    logger.info('Synced env-managed AI config', { models: syncedModelIds.length });
  }
}

async function assertProviderEditable(id: string) {
  const provider = await prisma.ai_providers.findUnique({ where: { id }, select: { slug: true } });
  if (provider && providerMeta(provider).is_read_only) {
    throw new Error('Env-managed provider is read-only');
  }
}

async function assertModelEditable(id: string) {
  const model = await prisma.ai_models.findUnique({ where: { id }, include: { provider: { select: { slug: true } } } });
  if (model && modelMeta(model).is_read_only) {
    throw new Error('Env-managed model is read-only');
  }
}

export async function listAIProviders() {
  const providers = await prisma.ai_providers.findMany({
    where: {
      slug: { not: { startsWith: ENV_PROVIDER_SLUG_PREFIX } },
    },
    include: {
      models: {
        select: {
          id: true,
          lane_type: true,
          display_name: true,
          upstream_model_name: true,
          is_active: true,
          notes: true,
        },
      },
    },
    orderBy: [{ is_active: 'desc' }, { updated_at: 'desc' }],
  });

  return providers.map((provider) => withProviderMeta(redactProviderSecret(provider)));
}

export async function createAIProvider(input: {
  name: string;
  slug: string;
  provider_kind?: string;
  base_url: string;
  api_key: string;
  default_headers_json?: unknown;
  is_active?: boolean;
  priority?: number;
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
      api_key_encrypted: encryptSecret(input.api_key.trim()),
      default_headers_json: sanitizeHeaders(input.default_headers_json) ?? Prisma.JsonNull,
      is_active: input.is_active !== false,
      priority: input.priority ?? 100,
    },
  });

  clearRuntimeGatewayConfigCache();
  return redactProviderSecret(provider);
}

export async function updateAIProvider(input: {
  id: string;
  name?: string;
  provider_kind?: string;
  base_url?: string;
  api_key?: string;
  default_headers_json?: unknown;
  is_active?: boolean;
  priority?: number;
}) {
  if (!input.id?.trim()) throw new Error('Provider id is required');
  await assertProviderEditable(input.id);

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new Error('Provider name cannot be empty');
    data.name = input.name.trim();
  }
  if (input.provider_kind !== undefined) {
    if (!input.provider_kind.trim()) throw new Error('Provider kind cannot be empty');
    data.provider_kind = input.provider_kind.trim();
  }
  if (input.base_url !== undefined) {
    if (!input.base_url.trim()) throw new Error('Provider base_url cannot be empty');
    data.base_url = input.base_url.trim();
  }
  if (input.api_key !== undefined) {
    if (!input.api_key.trim()) throw new Error('Provider api_key cannot be empty');
    data.api_key_encrypted = encryptSecret(input.api_key.trim());
  }
  if (input.default_headers_json !== undefined) {
    data.default_headers_json = sanitizeHeaders(input.default_headers_json) ?? Prisma.JsonNull;
  }
  if (input.is_active !== undefined) {
    data.is_active = input.is_active;
  }
  if (input.priority !== undefined) {
    data.priority = input.priority;
  }

  const provider = await prisma.ai_providers.update({
    where: { id: input.id },
    data,
  });

  clearRuntimeGatewayConfigCache();
  return withProviderMeta(redactProviderSecret(provider));
}

export async function deleteAIProvider(id: string) {
  if (!id?.trim()) throw new Error('Provider id is required');
  await assertProviderEditable(id);

  const modelCount = await prisma.ai_models.count({ where: { provider_id: id } });
  if (modelCount > 0) {
    throw new Error('Provider masih memiliki model. Hapus atau pindahkan model terlebih dahulu.');
  }

  await prisma.ai_providers.delete({ where: { id } });
  clearRuntimeGatewayConfigCache();
  return { id };
}

export async function listAIModels() {
  const models = await prisma.ai_models.findMany({
    where: {
      OR: [
        { notes: null },
        { notes: { not: { startsWith: ENV_MODEL_NOTE_PREFIX } } },
      ],
      provider: {
        slug: { not: { startsWith: ENV_PROVIDER_SLUG_PREFIX } },
      },
    },
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

  return models.map(withModelMeta);
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
  priority?: number;
}) {
  if (!input.provider_id?.trim()) throw new Error('provider_id is required');
  if (!input.display_name?.trim()) throw new Error('display_name is required');
  if (!input.upstream_model_name?.trim()) throw new Error('upstream_model_name is required');
  await assertProviderEditable(input.provider_id);

  const laneType = normalizeLaneType(input.lane_type);

  const model = await prisma.ai_models.create({
    data: {
      provider_id: input.provider_id,
      lane_type: laneType,
      display_name: input.display_name.trim(),
      upstream_model_name: input.upstream_model_name.trim(),
      endpoint_path: normalizeEndpointPath(input.endpoint_path),
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
      priority: input.priority ?? 100,
    },
  });

  clearRuntimeGatewayConfigCache();
  return model;
}

export async function updateAIModel(input: {
  id: string;
  provider_id?: string;
  lane_type?: string;
  display_name?: string;
  upstream_model_name?: string;
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
  priority?: number;
}) {
  if (!input.id?.trim()) throw new Error('Model id is required');
  await assertModelEditable(input.id);

  const data: Record<string, unknown> = {};
  if (input.provider_id !== undefined) {
    if (!input.provider_id.trim()) throw new Error('provider_id cannot be empty');
    await assertProviderEditable(input.provider_id);
    data.provider_id = input.provider_id;
  }
  if (input.lane_type !== undefined) {
    data.lane_type = normalizeLaneType(input.lane_type);
  }
  if (input.display_name !== undefined) {
    if (!input.display_name.trim()) throw new Error('display_name cannot be empty');
    data.display_name = input.display_name.trim();
  }
  if (input.upstream_model_name !== undefined) {
    if (!input.upstream_model_name.trim()) throw new Error('upstream_model_name cannot be empty');
    data.upstream_model_name = input.upstream_model_name.trim();
  }
  if (input.endpoint_path !== undefined) {
    data.endpoint_path = normalizeEndpointPath(input.endpoint_path);
  }
  for (const key of [
    'actual_pricing_type',
    'actual_fixed_price_usd',
    'actual_input_price_per_million_usd',
    'actual_output_price_per_million_usd',
    'adjusted_pricing_type',
    'adjusted_fixed_price_usd',
    'adjusted_input_price_per_million_usd',
    'adjusted_output_price_per_million_usd',
    'is_active',
    'is_publicly_selectable',
    'priority',
  ] as const) {
    if (input[key] !== undefined) data[key] = input[key];
  }
  if (input.notes !== undefined) {
    data.notes = input.notes?.trim() || null;
  }

  const model = await prisma.ai_models.update({
    where: { id: input.id },
    data,
    include: { provider: { select: { slug: true } } },
  });

  clearRuntimeGatewayConfigCache();
  return withModelMeta(model);
}

export async function deleteAIModel(id: string) {
  if (!id?.trim()) throw new Error('Model id is required');
  await assertModelEditable(id);

  const primaryAssignment = await prisma.ai_lane_assignments.findFirst({ where: { primary_model_id: id } });
  if (primaryAssignment) {
    throw new Error('Model masih dipakai sebagai primary assignment. Ganti assignment terlebih dahulu.');
  }

  await prisma.ai_models.delete({ where: { id } });
  clearRuntimeGatewayConfigCache();
  return { id };
}

export async function listAILaneAssignments() {
  const assignments = await prisma.ai_lane_assignments.findMany({
    include: {
      primary_model: {
        select: {
          id: true,
          display_name: true,
          upstream_model_name: true,
          lane_type: true,
          notes: true,
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
          notes: true,
          provider: {
            select: { id: true, name: true, slug: true },
          },
        },
      },
    },
    orderBy: [{ lane_type: 'asc' }, { village_id: 'asc' }, { updated_at: 'desc' }],
  });

  return assignments.filter((assignment) => {
    const primaryMeta = modelMeta(assignment.primary_model);
    const fallbackMeta = assignment.fallback_model ? modelMeta(assignment.fallback_model) : null;
    return !primaryMeta.is_read_only && !fallbackMeta?.is_read_only;
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
    prisma.ai_models.findUnique({ where: { id: input.primary_model_id }, include: { provider: { select: { slug: true } } } }),
    input.fallback_model_id ? prisma.ai_models.findUnique({ where: { id: input.fallback_model_id }, include: { provider: { select: { slug: true } } } }) : Promise.resolve(null),
  ]);

  if (!primaryModel) throw new Error('Primary model not found');
  if (modelMeta(primaryModel).is_read_only) throw new Error('Env-managed primary model cannot be assigned');
  if (fallbackModel && modelMeta(fallbackModel).is_read_only) throw new Error('Env-managed fallback model cannot be assigned');
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
