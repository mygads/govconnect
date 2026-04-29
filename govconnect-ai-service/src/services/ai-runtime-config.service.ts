import prisma from '../lib/prisma';
import {
  config,
  type AIGatewayProvider,
  type ChatGatewayLaneConfig,
  type EmbeddingGatewayLaneConfig,
  type GatewayLaneKind,
  type RerankGatewayLaneConfig,
} from '../config/env';
import { decryptSecret } from '../utils/crypto';
import logger from '../utils/logger';

export type ConfigSource = 'db';

export class MissingRuntimeGatewayConfigError extends Error {
  constructor(kind: GatewayLaneKind, villageId?: string | null) {
    super(`AI lane ${kind} is not configured in the database${villageId ? ` for village ${villageId}` : ''}`);
    this.name = 'MissingRuntimeGatewayConfigError';
  }
}

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
  if (
    normalized === 'openrouter' ||
    normalized === 'sumopod' ||
    normalized === 'vercel' ||
    normalized === 'cloudflare' ||
    normalized === 'direct' ||
    normalized === 'genfity-gateway' ||
    normalized === 'openai_compatible'
  ) {
    return normalized;
  }
  // L3: do NOT default to 'direct' — let caller skip unknown providers.
  return 'unconfigured';
}

function cacheKey(kind: GatewayLaneKind, villageId?: string | null): string {
  return `${kind}:${villageId || 'global'}`;
}

function laneToDb(kind: GatewayLaneKind): 'llm' | 'embed' | 'rewrite' | 'rerank' {
  if (kind === 'rag') return 'rewrite';
  return kind;
}

type DbModel = {
  id: string;
  display_name: string;
  upstream_model_name: string;
  endpoint_path: string | null;
  lane_type: string;
};

type DbProvider = {
  id: string;
  name: string;
  slug: string;
  provider_kind: string | null;
  base_url: string;
  api_key_encrypted: string | null;
  default_headers_json: unknown;
};

function buildGatewayConfig(kind: GatewayLaneKind, model: DbModel, provider: DbProvider): AnyGatewayConfig {
  const encryptedKey = provider.api_key_encrypted || '';
  let plaintextKey = '';
  try {
    plaintextKey = encryptedKey ? decryptSecret(encryptedKey) : '';
  } catch (err: any) {
    logger.error('Failed to decrypt provider API key', {
      providerId: provider.id,
      providerSlug: provider.slug,
      error: err.message,
    });
  }

  const shared = {
    enabled: true,
    provider: mapProvider(provider.provider_kind || provider.slug || provider.name),
    baseUrl: provider.base_url,
    apiKeys: plaintextKey ? [plaintextKey] : [],
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

/**
 * Load all additional same-lane providers (not already in primary/fallback) ordered by
 * model.priority then provider.priority. These become extra fallback attempts.
 */
async function loadExtraSameLaneAttempts(
  kind: GatewayLaneKind,
  excludeModelIds: string[],
): Promise<RuntimeAttempt[]> {
  const laneType = laneToDb(kind);
  try {
    const models = await prisma.ai_models.findMany({
      where: {
        lane_type: laneType,
        is_active: true,
        id: { notIn: excludeModelIds.length > 0 ? excludeModelIds : ['__none__'] },
        provider: { is_active: true },
      },
      include: { provider: true },
    });

    // Sort by priority (lower number = higher priority); fall back to display_name.
    const sorted = [...models].sort((a: any, b: any) => {
      const ap = a.priority ?? 100;
      const bp = b.priority ?? 100;
      if (ap !== bp) return ap - bp;
      const apv = a.provider?.priority ?? 100;
      const bpv = b.provider?.priority ?? 100;
      return apv - bpv;
    });

    return sorted.map((m: any) => ({
      modelId: m.id,
      modelDisplayName: m.display_name,
      providerId: m.provider.id,
      config: buildGatewayConfig(kind, m, m.provider),
    }));
  } catch (err: any) {
    logger.debug('loadExtraSameLaneAttempts failed (priority column may be missing)', { error: err.message });
    return [];
  }
}

async function loadLaneConfig(kind: GatewayLaneKind, villageId?: string | null): Promise<RuntimeGatewayEntry> {
  const assignment = await loadAssignment(kind, villageId);

  if (!assignment?.primary_model?.provider) {
    throw new MissingRuntimeGatewayConfigError(kind, villageId);
  }

  const attempts: RuntimeAttempt[] = [
    {
      modelId: assignment.primary_model.id,
      modelDisplayName: assignment.primary_model.display_name,
      providerId: assignment.primary_model.provider.id,
      config: buildGatewayConfig(kind, assignment.primary_model as any, assignment.primary_model.provider as any),
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
      config: buildGatewayConfig(kind, assignment.fallback_model as any, assignment.fallback_model.provider as any),
    });
  }

  // Add additional same-lane providers as extra fallback attempts.
  const extras = await loadExtraSameLaneAttempts(
    kind,
    attempts.map((a) => a.modelId).filter((id): id is string => Boolean(id)),
  );
  attempts.push(...extras);

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

/**
 * Selective cache invalidation. Call without args to clear everything.
 * TODO: integrate Redis pubsub for multi-instance invalidation.
 */
export function clearRuntimeGatewayConfigCache(kind?: GatewayLaneKind, villageId?: string | null): void {
  if (!kind) {
    cache.clear();
    return;
  }
  cache.delete(cacheKey(kind, villageId));
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
