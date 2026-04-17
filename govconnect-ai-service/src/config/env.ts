import logger from '../utils/logger';

export type AIGatewayProvider =
  | 'openrouter'
  | 'sumopod'
  | 'vercel'
  | 'cloudflare'
  | 'direct'
  | 'unconfigured';

export type GatewayLaneKind = 'llm' | 'embed' | 'rag' | 'rerank';

interface GatewayBaseLaneConfig {
  enabled: boolean;
  provider: AIGatewayProvider;
  baseUrl: string;
  apiKeys: string[];
  defaultHeaders: Record<string, string>;
  openRouterSiteUrl: string;
  openRouterAppName: string;
  openRouterProviderOrder: string[];
  openRouterAllowFallbacks: boolean;
  openRouterRequireParameters: boolean;
  openRouterZDROnly: boolean;
}

export interface ChatGatewayLaneConfig extends GatewayBaseLaneConfig {
  model: string;
  timeoutMs: number;
  chatCompletionsPath: string;
}

export interface EmbeddingGatewayLaneConfig extends GatewayBaseLaneConfig {
  model: string;
  timeoutMs: number;
  embeddingsPath: string;
  dimensions: number;
  encodingFormat: string;
}

export interface RerankGatewayLaneConfig extends GatewayBaseLaneConfig {
  model: string;
  timeoutMs: number;
  rerankPath: string;
  topN: number;
}

interface Config {
  port: number;
  nodeEnv: string;
  rabbitmqUrl: string;
  channelServiceUrl: string;
  caseServiceUrl: string;
  dashboardServiceUrl: string;
  internalApiKey: string;
  llmTemperature: number;
  llmMaxTokens: number;
  llmTimeoutMs: number;
  maxHistoryMessages: number;
  rateLimitEnabled: boolean;
  maxReportsPerDay: number;
  cooldownSeconds: number;
  autoBlacklistViolations: number;
  testingMode: boolean;
  profileEncryptionKey: string;
  aiGateway: ChatGatewayLaneConfig;
  llmGateway: ChatGatewayLaneConfig;
  embeddingGateway: EmbeddingGatewayLaneConfig;
  ragGateway: ChatGatewayLaneConfig;
  rerankerGateway: RerankGatewayLaneConfig;
  rerankEnabled: boolean;
  ragLLMRerankMaxCandidates: number;
  ragEnableRetrievalCache: boolean;
  ragRetrievalCacheTTLSeconds: number;
}

interface LaneSourceConfig {
  kind: GatewayLaneKind;
  providerKeys: string[];
  apiKeyKeys: string[];
  baseUrlKeys: string[];
  modelKeys: string[];
  timeoutKeys: string[];
  defaultHeadersKeys: string[];
}

const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_SUMOPOD_BASE_URL = 'https://ai.sumopod.com/v1';
const DEFAULT_EMBED_DIMENSIONS = 768;
const DEFAULT_RERANK_TOP_N = 5;

function parseCSV(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function firstDefined(keys: string[]): string | undefined {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(process.env, key)) {
      return process.env[key];
    }
  }

  return undefined;
}

function firstNonEmpty(keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

function parseJSONHeaders(value: string | undefined, envLabel: string): Record<string, string> {
  if (!value?.trim()) return {};

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const headers: Record<string, string> = {};

    for (const [key, headerValue] of Object.entries(parsed)) {
      if (typeof headerValue === 'string' && headerValue.trim()) {
        headers[key] = headerValue;
      }
    }

    return headers;
  } catch (error: any) {
    throw new Error(`Invalid ${envLabel}: ${error.message}`);
  }
}

function parseProvider(value: string | undefined): AIGatewayProvider {
  const normalized = (value || '').trim().toLowerCase();

  if (
    normalized === 'openrouter' ||
    normalized === 'sumopod' ||
    normalized === 'vercel' ||
    normalized === 'cloudflare' ||
    normalized === 'direct'
  ) {
    return normalized;
  }

  return 'unconfigured';
}

function providerDefaultBaseUrl(provider: AIGatewayProvider): string {
  switch (provider) {
    case 'openrouter':
      return DEFAULT_OPENROUTER_BASE_URL;
    case 'sumopod':
      return DEFAULT_SUMOPOD_BASE_URL;
    default:
      return '';
  }
}

function normalizeBaseUrl(provider: AIGatewayProvider, baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return providerDefaultBaseUrl(provider);
  }

  if (provider === 'sumopod' && !/\/v1$/i.test(trimmed)) {
    return `${trimmed}/v1`;
  }

  if (provider === 'openrouter' && /openrouter\.ai$/i.test(trimmed)) {
    return `${trimmed}/api/v1`;
  }

  return trimmed;
}
interface ResolvedBaseLaneConfig extends GatewayBaseLaneConfig {
  missing: string[];
}

function buildBaseLaneConfig(
  source: LaneSourceConfig,
): ResolvedBaseLaneConfig {
  const provider = parseProvider(firstNonEmpty(source.providerKeys));
  const apiKeys = parseCSV(firstNonEmpty(source.apiKeyKeys));
  const explicitBaseUrl = firstNonEmpty(source.baseUrlKeys);
  const baseUrl = provider === 'unconfigured' || !explicitBaseUrl
    ? ''
    : normalizeBaseUrl(provider, explicitBaseUrl);

  const missing: string[] = [];
  if (provider === 'unconfigured') missing.push(source.providerKeys[0]);
  if (apiKeys.length === 0) missing.push(source.apiKeyKeys[0]);
  if (baseUrl.length === 0) missing.push(source.baseUrlKeys[0]);

  return {
    enabled: false,
    provider,
    baseUrl,
    apiKeys,
    missing,
    defaultHeaders: parseJSONHeaders(
      firstNonEmpty(source.defaultHeadersKeys),
      source.defaultHeadersKeys[0] || `${source.kind.toUpperCase()}_DEFAULT_HEADERS_JSON`,
    ),
    openRouterSiteUrl: (process.env.OPENROUTER_SITE_URL || '').trim(),
    openRouterAppName: (process.env.OPENROUTER_APP_NAME || '').trim(),
    openRouterProviderOrder: parseCSV(process.env.OPENROUTER_PROVIDER_ORDER),
    openRouterAllowFallbacks: process.env.OPENROUTER_ALLOW_FALLBACKS !== 'false',
    openRouterRequireParameters: process.env.OPENROUTER_REQUIRE_PARAMETERS === 'true',
    openRouterZDROnly: process.env.OPENROUTER_ZDR_ONLY === 'true',
  };
}

function warnIfLaneDisabled(
  lane: GatewayLaneKind,
  provider: AIGatewayProvider,
  missing: string[],
): void {
  if (missing.length === 0) {
    return;
  }

  logger.warn('Gateway lane is disabled because configuration is incomplete', {
    lane,
    provider,
    missing,
  });
}

function resolveLLMLaneConfig(): ChatGatewayLaneConfig {
  const base = buildBaseLaneConfig({
    kind: 'llm',
    providerKeys: ['LLM_PROVIDER', 'LLM_GATEWAY_PROVIDER', 'AI_GATEWAY_PROVIDER'],
    apiKeyKeys: ['LLM_API_KEY', 'LLM_GATEWAY_API_KEYS', 'AI_GATEWAY_API_KEYS'],
    baseUrlKeys: ['LLM_BASE_URL', 'LLM_GATEWAY_BASE_URL', 'AI_GATEWAY_BASE_URL'],
    modelKeys: ['LLM_MODEL'],
    timeoutKeys: ['LLM_TIMEOUT_MS'],
    defaultHeadersKeys: ['LLM_DEFAULT_HEADERS_JSON', 'LLM_GATEWAY_DEFAULT_HEADERS_JSON', 'AI_GATEWAY_DEFAULT_HEADERS_JSON'],
  });

  const model = (firstNonEmpty(['LLM_MODEL']) || '').trim();
  const missing = [...base.missing];
  if (!model) missing.push('LLM_MODEL');
  warnIfLaneDisabled('llm', base.provider, missing);

  return {
    ...base,
    enabled: missing.length === 0,
    model,
    timeoutMs: parseInt(firstNonEmpty(['LLM_TIMEOUT_MS']) || '30000', 10),
    chatCompletionsPath: (firstNonEmpty(['LLM_CHAT_COMPLETIONS_PATH', 'LLM_GATEWAY_CHAT_COMPLETIONS_PATH', 'AI_GATEWAY_CHAT_COMPLETIONS_PATH']) || '/chat/completions').trim() || '/chat/completions',
  };
}

function resolveEmbedLaneConfig(): EmbeddingGatewayLaneConfig {
  const base = buildBaseLaneConfig({
    kind: 'embed',
    providerKeys: ['EMBED_PROVIDER', 'EMBEDDING_GATEWAY_PROVIDER'],
    apiKeyKeys: ['EMBED_API_KEY', 'EMBEDDING_GATEWAY_API_KEYS'],
    baseUrlKeys: ['EMBED_BASE_URL', 'EMBEDDING_GATEWAY_BASE_URL'],
    modelKeys: ['EMBED_MODEL', 'EMBEDDING_MODEL'],
    timeoutKeys: ['EMBED_TIMEOUT_MS', 'EMBEDDING_TIMEOUT_MS'],
    defaultHeadersKeys: ['EMBED_DEFAULT_HEADERS_JSON', 'EMBEDDING_GATEWAY_DEFAULT_HEADERS_JSON', 'AI_GATEWAY_DEFAULT_HEADERS_JSON'],
  });

  const dimensions = parseInt(firstNonEmpty(['EMBED_DIMENSIONS', 'EMBEDDING_DIMENSIONS']) || `${DEFAULT_EMBED_DIMENSIONS}`, 10);
  const model = (firstNonEmpty(['EMBED_MODEL', 'EMBEDDING_MODEL']) || '').trim();
  const missing = [...base.missing];
  if (!model) missing.push('EMBED_MODEL');
  warnIfLaneDisabled('embed', base.provider, missing);

  return {
    ...base,
    enabled: missing.length === 0,
    model,
    timeoutMs: parseInt(firstNonEmpty(['EMBED_TIMEOUT_MS', 'EMBEDDING_TIMEOUT_MS']) || '30000', 10),
    embeddingsPath: (firstNonEmpty(['EMBED_EMBEDDINGS_PATH', 'EMBEDDING_GATEWAY_EMBEDDINGS_PATH']) || '/embeddings').trim() || '/embeddings',
    dimensions: Number.isFinite(dimensions) && dimensions > 0 ? dimensions : DEFAULT_EMBED_DIMENSIONS,
    encodingFormat: (firstNonEmpty(['EMBED_ENCODING_FORMAT', 'EMBEDDING_ENCODING_FORMAT']) || 'float').trim() || 'float',
  };
}

function resolveRAGLaneConfig(): ChatGatewayLaneConfig {
  const base = buildBaseLaneConfig({
    kind: 'rag',
    providerKeys: ['RAG_PROVIDER'],
    apiKeyKeys: ['RAG_API_KEY'],
    baseUrlKeys: ['RAG_BASE_URL'],
    modelKeys: ['RAG_REWRITE_MODEL'],
    timeoutKeys: ['RAG_QUERY_REWRITE_TIMEOUT_MS'],
    defaultHeadersKeys: ['RAG_DEFAULT_HEADERS_JSON', 'AI_GATEWAY_DEFAULT_HEADERS_JSON'],
  });

  const model = (firstNonEmpty(['RAG_REWRITE_MODEL']) || '').trim();
  const missing = [...base.missing];
  if (!model) missing.push('RAG_REWRITE_MODEL');
  warnIfLaneDisabled('rag', base.provider, missing);

  return {
    ...base,
    enabled: missing.length === 0,
    model,
    timeoutMs: parseInt(firstNonEmpty(['RAG_QUERY_REWRITE_TIMEOUT_MS']) || '10000', 10),
    chatCompletionsPath: (firstNonEmpty(['RAG_CHAT_COMPLETIONS_PATH']) || '/chat/completions').trim() || '/chat/completions',
  };
}

function resolveRerankLaneConfig(): RerankGatewayLaneConfig {
  const base = buildBaseLaneConfig({
    kind: 'rerank',
    providerKeys: ['RERANK_PROVIDER', 'RERANKER_GATEWAY_PROVIDER'],
    apiKeyKeys: ['RERANK_API_KEY', 'RERANKER_GATEWAY_API_KEYS'],
    baseUrlKeys: ['RERANK_BASE_URL', 'RERANKER_GATEWAY_BASE_URL'],
    modelKeys: ['RERANK_MODEL', 'RERANKER_MODEL'],
    timeoutKeys: ['RERANK_TIMEOUT_MS', 'RERANKER_TIMEOUT_MS'],
    defaultHeadersKeys: ['RERANK_DEFAULT_HEADERS_JSON', 'RERANKER_GATEWAY_DEFAULT_HEADERS_JSON', 'AI_GATEWAY_DEFAULT_HEADERS_JSON'],
  });

  const topN = parseInt(firstNonEmpty(['RERANK_TOP_N', 'RERANKER_TOP_N']) || `${DEFAULT_RERANK_TOP_N}`, 10);
  const model = (firstNonEmpty(['RERANK_MODEL', 'RERANKER_MODEL']) || '').trim();
  const rerankEnabled = process.env.RERANK_ENABLED !== 'false';
  const missing = [...base.missing];
  if (!model) missing.push('RERANK_MODEL');
  if (!rerankEnabled) {
    logger.info('Rerank lane explicitly disabled by environment flag', {
      lane: 'rerank',
      provider: base.provider,
      env: 'RERANK_ENABLED',
    });
  } else {
    warnIfLaneDisabled('rerank', base.provider, missing);
  }

  return {
    ...base,
    enabled: rerankEnabled && missing.length === 0,
    model,
    timeoutMs: parseInt(firstNonEmpty(['RERANK_TIMEOUT_MS', 'RERANKER_TIMEOUT_MS']) || '30000', 10),
    rerankPath: (firstNonEmpty(['RERANK_PATH', 'RERANKER_GATEWAY_RERANK_PATH']) || '/rerank').trim() || '/rerank',
    topN: Number.isFinite(topN) && topN > 0 ? topN : DEFAULT_RERANK_TOP_N,
  };
}

function validateEnv(): Config {
  const requiredEnvVars = [
    'RABBITMQ_URL',
    'CHANNEL_SERVICE_URL',
    'CASE_SERVICE_URL',
    'INTERNAL_API_KEY',
  ];

  const missing = requiredEnvVars.filter(key => !process.env[key]);

  if (missing.length > 0) {
    logger.error('❌ Missing required environment variables', { missing });
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const llmLane = resolveLLMLaneConfig();
  const embedLane = resolveEmbedLaneConfig();
  const ragLane = resolveRAGLaneConfig();
  const rerankLane = resolveRerankLaneConfig();

  const config: Config = {
    port: parseInt(process.env.PORT || '3002', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    rabbitmqUrl: process.env.RABBITMQ_URL!,
    channelServiceUrl: process.env.CHANNEL_SERVICE_URL!,
    caseServiceUrl: process.env.CASE_SERVICE_URL!,
    dashboardServiceUrl: process.env.DASHBOARD_SERVICE_URL || 'http://dashboard:3000',
    internalApiKey: process.env.INTERNAL_API_KEY!,
    llmTemperature: parseFloat(process.env.LLM_TEMPERATURE || '0.3'),
    llmMaxTokens: parseInt(process.env.LLM_MAX_TOKENS || '3072', 10),
    llmTimeoutMs: llmLane.timeoutMs,
    maxHistoryMessages: parseInt(process.env.MAX_HISTORY_MESSAGES || '30', 10),
    rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',
    maxReportsPerDay: parseInt(process.env.MAX_REPORTS_PER_DAY || '5', 10),
    cooldownSeconds: parseInt(process.env.COOLDOWN_SECONDS || '30', 10),
    autoBlacklistViolations: parseInt(process.env.AUTO_BLACKLIST_VIOLATIONS || '10', 10),
    testingMode: process.env.TESTING_MODE === 'true',
    profileEncryptionKey: process.env.PROFILE_ENCRYPTION_KEY || '',
    aiGateway: llmLane,
    llmGateway: llmLane,
    embeddingGateway: embedLane,
    ragGateway: ragLane,
    rerankerGateway: rerankLane,
    rerankEnabled: process.env.RERANK_ENABLED !== 'false' && rerankLane.enabled,
    ragLLMRerankMaxCandidates: parseInt(process.env.RAG_LLM_RERANK_MAX_CANDIDATES || '12', 10),
    ragEnableRetrievalCache: process.env.RAG_ENABLE_RETRIEVAL_CACHE !== 'false',
    ragRetrievalCacheTTLSeconds: parseInt(process.env.RAG_RETRIEVAL_CACHE_TTL_SECONDS || '300', 10),
  };

  if (config.nodeEnv === 'production' && !config.profileEncryptionKey) {
    logger.warn('⚠️  PROFILE_ENCRYPTION_KEY not set — PII encryption disabled in production');
  }

  if (config.embeddingGateway.dimensions !== DEFAULT_EMBED_DIMENSIONS) {
    logger.warn('⚠️ EMBED_DIMENSIONS differs from current pgvector schema default', {
      embedDimensions: config.embeddingGateway.dimensions,
      expectedDimensions: DEFAULT_EMBED_DIMENSIONS,
    });
  }

  logger.info('✅ Environment configuration validated', {
    port: config.port,
    nodeEnv: config.nodeEnv,
    llmLane: {
      enabled: config.llmGateway.enabled,
      provider: config.llmGateway.provider,
      baseUrl: config.llmGateway.baseUrl,
      model: config.llmGateway.model,
    },
    embedLane: {
      enabled: config.embeddingGateway.enabled,
      provider: config.embeddingGateway.provider,
      baseUrl: config.embeddingGateway.baseUrl,
      model: config.embeddingGateway.model,
    },
    ragLane: {
      enabled: config.ragGateway.enabled,
      provider: config.ragGateway.provider,
      baseUrl: config.ragGateway.baseUrl,
      model: config.ragGateway.model,
    },
    rerankLane: {
      enabled: config.rerankerGateway.enabled,
      provider: config.rerankerGateway.provider,
      baseUrl: config.rerankerGateway.baseUrl,
      model: config.rerankerGateway.model,
    },
  });

  return config;
}

export const config = validateEnv();
