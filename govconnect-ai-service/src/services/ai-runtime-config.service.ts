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
import { sanitizeProviderDefaultHeaders } from '../utils/provider-headers';
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
  brokenReason?: string;
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

type RuntimeGatewayConfigCacheClearListener = (kind?: GatewayLaneKind, villageId?: string | null) => void;
const cacheClearListeners = new Set<RuntimeGatewayConfigCacheClearListener>();

export function onRuntimeGatewayConfigCacheClear(listener: RuntimeGatewayConfigCacheClearListener): () => void {
  cacheClearListeners.add(listener);
  return () => cacheClearListeners.delete(listener);
}

function notifyRuntimeGatewayConfigCacheClear(kind?: GatewayLaneKind, villageId?: string | null): void {
  for (const listener of cacheClearListeners) {
    try {
      listener(kind, villageId);
    } catch (err: any) {
      logger.warn('Runtime gateway config cache clear listener failed', { error: err.message });
    }
  }
}

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

type ProviderKeyState = {
  plaintextKey: string;
  brokenReason?: string;
};

function decryptProviderApiKey(provider: DbProvider): ProviderKeyState {
  const encryptedKey = provider.api_key_encrypted || '';
  if (!encryptedKey) return { plaintextKey: '' };

  try {
    return { plaintextKey: decryptSecret(encryptedKey) };
  } catch (err: any) {
    logger.warn('Failed to decrypt provider API key; marking runtime attempt broken', {
      providerId: provider.id,
      providerSlug: provider.slug,
      error: err.message,
    });
    return { plaintextKey: '', brokenReason: 'provider_api_key_decrypt_failed' };
  }
}

function buildGatewayConfig(
  kind: GatewayLaneKind,
  model: DbModel,
  provider: DbProvider,
  keyState: ProviderKeyState = decryptProviderApiKey(provider),
): AnyGatewayConfig {
  const { plaintextKey } = keyState;

  const shared = {
    enabled: true,
    provider: mapProvider(provider.provider_kind || provider.slug || provider.name),
    baseUrl: provider.base_url,
    apiKeys: plaintextKey ? [plaintextKey] : [],
    defaultHeaders: sanitizeProviderDefaultHeaders(provider.default_headers_json),
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

async function loadAssignment(kind: GatewayLaneKind, villageId?: string | null, client: any = prisma) {
  const laneType = laneToDb(kind);

  if (villageId) {
    const villageAssignment = await client.ai_lane_assignments.findFirst({
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

  return client.ai_lane_assignments.findFirst({
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


function buildRuntimeAttempt(kind: GatewayLaneKind, model: DbModel, provider: DbProvider): RuntimeAttempt {
  const keyState = decryptProviderApiKey(provider);
  return {
    modelId: model.id,
    modelDisplayName: model.display_name,
    providerId: provider.id,
    brokenReason: keyState.brokenReason,
    config: buildGatewayConfig(kind, model, provider, keyState),
  };
}

/**
 * Load all additional same-lane providers (not already in primary/fallback) ordered by
 * model.priority then provider.priority. These become extra fallback attempts.
 */
async function loadExtraSameLaneAttempts(
  kind: GatewayLaneKind,
  excludeModelIds: string[],
  client: any = prisma,
): Promise<RuntimeAttempt[]> {
  const laneType = laneToDb(kind);
  try {
    const models = await client.ai_models.findMany({
      where: {
        lane_type: laneType,
        is_active: true,
        ...(excludeModelIds.length > 0 ? { id: { notIn: excludeModelIds } } : {}),
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

    return sorted.map((m: any) => buildRuntimeAttempt(kind, m, m.provider));
  } catch (err: any) {
    logger.debug('loadExtraSameLaneAttempts failed (priority column may be missing)', { error: err.message });
    return [];
  }
}

async function loadLaneConfig(kind: GatewayLaneKind, villageId?: string | null): Promise<RuntimeGatewayEntry> {
  return prisma.$transaction(async (tx: any) => {
    const assignment = await loadAssignment(kind, villageId, tx);

    if (!assignment?.primary_model?.provider) {
      throw new MissingRuntimeGatewayConfigError(kind, villageId);
    }

    const attempts: RuntimeAttempt[] = [
      buildRuntimeAttempt(kind, assignment.primary_model as any, assignment.primary_model.provider as any),
    ];

    if (
      assignment.fallback_model?.provider &&
      assignment.fallback_model.id !== assignment.primary_model.id
    ) {
      attempts.push(buildRuntimeAttempt(kind, assignment.fallback_model as any, assignment.fallback_model.provider as any));
    }

    const extras = await loadExtraSameLaneAttempts(
      kind,
      attempts.map((a) => a.modelId).filter((id): id is string => Boolean(id)),
      tx,
    );
    attempts.push(...extras);

    return {
      expiresAt: Date.now() + CACHE_TTL_MS,
      config: attempts[0].config,
      attempts,
      meta: {
        source: 'db' as const,
        assignmentId: assignment.id,
        primaryModelId: assignment.primary_model.id,
        fallbackModelId: assignment.fallback_model?.id,
        villageId: assignment.village_id,
      },
    };
  });
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
    notifyRuntimeGatewayConfigCacheClear();
    return;
  }
  cache.delete(cacheKey(kind, villageId));
  notifyRuntimeGatewayConfigCacheClear(kind, villageId);
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
