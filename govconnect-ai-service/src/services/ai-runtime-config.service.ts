import prisma from '../lib/prisma';
import {
  config,
  type AIGatewayProvider,
  type ChatGatewayLaneConfig,
  type EmbeddingGatewayLaneConfig,
  type GatewayLaneKind,
  type RerankGatewayLaneConfig,
} from '../config/env';

export type ConfigSource = 'db' | 'env_fallback';

type AnyGatewayConfig = ChatGatewayLaneConfig | EmbeddingGatewayLaneConfig | RerankGatewayLaneConfig;

type RuntimeAttempt = {
  modelId?: string;
  modelDisplayName?: string;
  providerId?: string;
  config: AnyGatewayConfig;
};

export type RuntimeLaneInfo = {
  source: ConfigSource;
  assignmentId?: string;
  primaryModelId?: string;
  fallbackModelId?: string;
  villageId?: string | null;
};

type RuntimeGatewayEntry = {
  expiresAt: number;
  config: AnyGatewayConfig;
  attempts: RuntimeAttempt[];
  meta: RuntimeLaneInfo;
};

const cache = new Map<string, RuntimeGatewayEntry>();
const CACHE_TTL_MS = 30_000;

function mapProvider(provider: string): AIGatewayProvider {
  const normalized = (provider || '').trim().toLowerCase();
  if (normalized === 'openrouter' || normalized === 'sumopod' || normalized === 'vercel' || normalized === 'cloudflare' || normalized === 'direct') {
    return normalized;
  }
  return 'direct';
}

function fallbackConfig(kind: GatewayLaneKind): AnyGatewayConfig {
  switch (kind) {
    case 'embed':
      return config.embeddingGateway;
    case 'rag':
      return config.ragGateway;
    case 'rerank':
      return config.rerankerGateway;
    default:
      return config.llmGateway;
  }
}

function fallbackMeta(villageId?: string | null): RuntimeLaneInfo {
  return { source: 'env_fallback', villageId: villageId ?? null };
}

function fallbackAttempts(kind: GatewayLaneKind): RuntimeAttempt[] {
  return [{ config: fallbackConfig(kind) }];
}

function cacheKey(kind: GatewayLaneKind, villageId?: string | null): string {
  return `${kind}:${villageId || 'global'}`;
}

function laneToDb(kind: GatewayLaneKind): 'llm' | 'embed' | 'rewrite' | 'rerank' {
  if (kind === 'rag') return 'rewrite';
  return kind;
}

function buildGatewayConfig(kind: GatewayLaneKind, model: any, provider: any): AnyGatewayConfig {
  const shared = {
    enabled: true,
    provider: mapProvider(provider.provider_kind || provider.name),
    baseUrl: provider.base_url,
    apiKeys: provider.api_key_encrypted ? [provider.api_key_encrypted] : [],
    defaultHeaders: (provider.default_headers_json as Record<string, string> | null) || {},
    openRouterSiteUrl: '',
    openRouterAppName: '',
    openRouterProviderOrder: [],
    openRouterAllowFallbacks: true,
    openRouterRequireParameters: false,
    openRouterZDROnly: false,
  };

  if (kind === 'embed') {
    return {
      ...shared,
      model: model.upstream_model_name,
      timeoutMs: config.embeddingGateway.timeoutMs,
      embeddingsPath: model.endpoint_path || config.embeddingGateway.embeddingsPath,
      dimensions: config.embeddingGateway.dimensions,
      encodingFormat: config.embeddingGateway.encodingFormat,
    } satisfies EmbeddingGatewayLaneConfig;
  }

  if (kind === 'rerank') {
    return {
      ...shared,
      model: model.upstream_model_name,
      timeoutMs: config.rerankerGateway.timeoutMs,
      rerankPath: model.endpoint_path || config.rerankerGateway.rerankPath,
      topN: config.rerankerGateway.topN,
    } satisfies RerankGatewayLaneConfig;
  }

  return {
    ...shared,
    model: model.upstream_model_name,
    timeoutMs: kind === 'rag' ? config.ragGateway.timeoutMs : config.llmGateway.timeoutMs,
    chatCompletionsPath: model.endpoint_path || (kind === 'rag' ? config.ragGateway.chatCompletionsPath : config.llmGateway.chatCompletionsPath),
  } satisfies ChatGatewayLaneConfig;
}

async function loadAssignment(kind: GatewayLaneKind, villageId?: string | null) {
  const laneType = laneToDb(kind);

  if (villageId) {
    const villageAssignment = await prisma.ai_lane_assignments.findFirst({
      where: {
        lane_type: laneType,
        village_id: villageId,
        is_active: true,
      },
      orderBy: { updated_at: 'desc' },
      include: {
        primary_model: { include: { provider: true } },
        fallback_model: { include: { provider: true } },
      },
    });

    if (villageAssignment) {
      return villageAssignment;
    }
  }

  return prisma.ai_lane_assignments.findFirst({
    where: {
      lane_type: laneType,
      village_id: null,
      is_global_default: true,
      is_active: true,
    },
    orderBy: { updated_at: 'desc' },
    include: {
      primary_model: { include: { provider: true } },
      fallback_model: { include: { provider: true } },
    },
  });
}

async function loadLaneConfig(kind: GatewayLaneKind, villageId?: string | null): Promise<RuntimeGatewayEntry> {
  const assignment = await loadAssignment(kind, villageId);

  if (!assignment?.primary_model?.provider) {
    const config = fallbackConfig(kind);
    return {
      expiresAt: Date.now() + CACHE_TTL_MS,
      config,
      attempts: fallbackAttempts(kind),
      meta: fallbackMeta(villageId),
    };
  }

  const attempts: RuntimeAttempt[] = [
    {
      modelId: assignment.primary_model.id,
      modelDisplayName: assignment.primary_model.display_name,
      providerId: assignment.primary_model.provider.id,
      config: buildGatewayConfig(kind, assignment.primary_model, assignment.primary_model.provider),
    },
  ];

  if (
    assignment.fallback_model?.provider &&
    assignment.fallback_model.id !== assignment.primary_model.id
  ) {
    attempts.push({
      modelId: assignment.fallback_model.id,
      modelDisplayName: assignment.fallback_model.display_name,
      providerId: assignment.fallback_model.provider.id,
      config: buildGatewayConfig(kind, assignment.fallback_model, assignment.fallback_model.provider),
    });
  }

  return {
    expiresAt: Date.now() + CACHE_TTL_MS,
    config: attempts[0].config,
    attempts,
    meta: {
      source: 'db',
      assignmentId: assignment.id,
      primaryModelId: assignment.primary_model.id,
      fallbackModelId: assignment.fallback_model?.id,
      villageId: assignment.village_id,
    },
  };
}

export async function getRuntimeGatewayConfig(kind: GatewayLaneKind, villageId?: string | null) {
  const key = cacheKey(kind, villageId);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const loaded = await loadLaneConfig(kind, villageId);
  cache.set(key, loaded);
  return loaded;
}

export function clearRuntimeGatewayConfigCache() {
  cache.clear();
}

export async function getRuntimeGatewayAttempts(kind: GatewayLaneKind, villageId?: string | null): Promise<RuntimeAttempt[]> {
  const loaded = await getRuntimeGatewayConfig(kind, villageId);
  return loaded.attempts;
}

export async function getRuntimeLaneModelIds(kind: GatewayLaneKind, villageId?: string | null): Promise<string[]> {
  const loaded = await getRuntimeGatewayConfig(kind, villageId);
  return loaded.attempts.map((attempt) => attempt.modelId).filter((value): value is string => Boolean(value));
}

export type { RuntimeAttempt, AnyGatewayConfig };
