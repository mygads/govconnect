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

type RuntimeLaneInfo = {
  source: ConfigSource;
  primaryModelId?: string;
  fallbackModelId?: string;
};

const cache = new Map<GatewayLaneKind, { expiresAt: number; config: ChatGatewayLaneConfig | EmbeddingGatewayLaneConfig | RerankGatewayLaneConfig; meta: RuntimeLaneInfo }>();
const CACHE_TTL_MS = 30_000;

function mapProvider(provider: string): AIGatewayProvider {
  const normalized = (provider || '').trim().toLowerCase();
  if (normalized === 'openrouter' || normalized === 'sumopod' || normalized === 'vercel' || normalized === 'cloudflare' || normalized === 'direct') {
    return normalized;
  }
  return 'direct';
}

function fallbackConfig(kind: GatewayLaneKind): ChatGatewayLaneConfig | EmbeddingGatewayLaneConfig | RerankGatewayLaneConfig {
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

function fallbackMeta(): RuntimeLaneInfo {
  return { source: 'env_fallback' };
}

function laneToDb(kind: GatewayLaneKind): 'llm' | 'embed' | 'rewrite' | 'rerank' {
  if (kind === 'rag') return 'rewrite';
  return kind;
}

async function loadLaneConfig(kind: GatewayLaneKind) {
  const assignment = await prisma.ai_lane_assignments.findFirst({
    where: {
      lane_type: laneToDb(kind),
      village_id: null,
      is_global_default: true,
    },
    include: {
      primary_model: { include: { provider: true } },
      fallback_model: { include: { provider: true } },
    },
  });

  if (!assignment?.primary_model?.provider) {
    return { config: fallbackConfig(kind), meta: fallbackMeta() };
  }

  const model = assignment.primary_model;
  const provider = model.provider;
  const shared = {
    enabled: true,
    provider: mapProvider(provider.name),
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

  const meta: RuntimeLaneInfo = {
    source: 'db',
    primaryModelId: model.id,
    fallbackModelId: assignment.fallback_model?.id,
  };

  if (kind === 'embed') {
    return {
      config: {
        ...shared,
        model: model.upstream_model_name,
        timeoutMs: config.embeddingGateway.timeoutMs,
        embeddingsPath: model.endpoint_path || config.embeddingGateway.embeddingsPath,
        dimensions: config.embeddingGateway.dimensions,
        encodingFormat: config.embeddingGateway.encodingFormat,
      } satisfies EmbeddingGatewayLaneConfig,
      meta,
    };
  }

  if (kind === 'rerank') {
    return {
      config: {
        ...shared,
        model: model.upstream_model_name,
        timeoutMs: config.rerankerGateway.timeoutMs,
        rerankPath: model.endpoint_path || config.rerankerGateway.rerankPath,
        topN: config.rerankerGateway.topN,
      } satisfies RerankGatewayLaneConfig,
      meta,
    };
  }

  return {
    config: {
      ...shared,
      model: model.upstream_model_name,
      timeoutMs: kind === 'rag' ? config.ragGateway.timeoutMs : config.llmGateway.timeoutMs,
      chatCompletionsPath: model.endpoint_path || (kind === 'rag' ? config.ragGateway.chatCompletionsPath : config.llmGateway.chatCompletionsPath),
    } satisfies ChatGatewayLaneConfig,
    meta,
  };
}

export async function getRuntimeGatewayConfig(kind: GatewayLaneKind) {
  const cached = cache.get(kind);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const loaded = await loadLaneConfig(kind);
  const entry = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    config: loaded.config,
    meta: loaded.meta,
  };
  cache.set(kind, entry);
  return entry;
}

export function clearRuntimeGatewayConfigCache() {
  cache.clear();
}
