import {
  config,
  type ChatGatewayLaneConfig,
  type EmbeddingGatewayLaneConfig,
  type GatewayLaneKind,
  type RerankGatewayLaneConfig,
} from '../config/env';
import type { LLMMetrics } from '../types/llm-response.types';
import logger from '../utils/logger';
import { getRuntimeGatewayConfig } from './ai-runtime-config.service';
import { modelStatsService } from './model-stats.service';
import { recordTokenUsage, type CallType, type LayerType } from './token-usage.service';

export type PromptLaneKind = 'llm' | 'rag';

export type GatewayMessageRole = 'system' | 'user' | 'assistant';

export interface GatewayChatMessage {
  role: GatewayMessageRole;
  content: string;
}

interface GatewayUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface GatewayChoice {
  finish_reason?: string | null;
  message?: {
    role?: string;
    content?: unknown;
  };
}

interface GatewayResponseError {
  message?: string;
  code?: number | string;
  metadata?: Record<string, unknown>;
}

interface GatewayChatCompletionResponse {
  id?: string;
  model?: string;
  provider?: string;
  usage?: GatewayUsage;
  choices?: GatewayChoice[];
  error?: GatewayResponseError;
}

interface GatewayEmbeddingItem {
  index?: number;
  embedding?: number[];
}

interface GatewayEmbeddingResponse {
  id?: string;
  model?: string;
  provider?: string;
  data?: GatewayEmbeddingItem[];
  usage?: GatewayUsage;
  error?: GatewayResponseError;
}

interface GatewayRerankItem {
  index: number;
  relevance_score: number;
  document?: {
    text?: string;
  };
}

interface GatewayRerankUsage {
  total_tokens?: number;
  search_units?: number;
}

interface GatewayRerankResponse {
  id?: string;
  model?: string;
  provider?: string;
  results?: GatewayRerankItem[];
  usage?: GatewayRerankUsage;
  error?: GatewayResponseError;
}

interface TokenContext {
  village_id?: string | null;
  wa_user_id?: string | null;
  session_id?: string | null;
  channel?: string | null;
  intent?: string | null;
}

export interface GatewayPromptOptions {
  lane?: PromptLaneKind;
  modelPriority: string[];
  messages: GatewayChatMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  jsonMode?: boolean;
  layerType?: LayerType;
  callType?: CallType;
  context?: TokenContext;
  extraBody?: Record<string, unknown>;
}

export interface GatewayPromptResult {
  text: string;
  model: string;
  provider: string;
  responseId?: string;
  finishReason?: string | null;
  metrics: LLMMetrics;
}

export interface GatewayEmbeddingOptions {
  input: string | string[];
  model?: string;
  dimensions?: number;
  encodingFormat?: string;
  timeoutMs?: number;
  layerType?: LayerType;
  callType?: CallType;
  context?: TokenContext;
  extraBody?: Record<string, unknown>;
}

export interface GatewayEmbeddingResult {
  embeddings: number[][];
  model: string;
  provider: string;
  responseId?: string;
  metrics: LLMMetrics;
}

export interface GatewayRerankOptions {
  query: string;
  documents: string[];
  model?: string;
  topN?: number;
  timeoutMs?: number;
  layerType?: LayerType;
  callType?: CallType;
  context?: TokenContext;
  extraBody?: Record<string, unknown>;
}

export interface GatewayRerankResultItem {
  index: number;
  relevanceScore: number;
  documentText: string;
}

export interface GatewayRerankResult {
  items: GatewayRerankResultItem[];
  model: string;
  provider: string;
  responseId?: string;
  metrics: LLMMetrics;
}

interface GatewayApiKey {
  label: string;
  value: string;
}

const nextGatewayKeyIndex: Record<GatewayLaneKind, number> = {
  llm: 0,
  embed: 0,
  rag: 0,
  rerank: 0,
};

type AnyGatewayConfig = ChatGatewayLaneConfig | EmbeddingGatewayLaneConfig | RerankGatewayLaneConfig;

type RuntimeGatewayAttempt = {
  config: AnyGatewayConfig;
  modelId?: string;
  modelDisplayName?: string;
  providerId?: string;
};

type RuntimeGatewayResolved = {
  config: AnyGatewayConfig;
  attempts: RuntimeGatewayAttempt[];
  meta?: {
    source?: 'db';
    primaryModelId?: string;
    fallbackModelId?: string;
  };
};

type GatewayInfo = {
  kind: GatewayLaneKind;
  enabled: boolean;
  configured: boolean;
  provider: string | null;
  baseUrl: string | null;
  keyCount: number;
  path: string | null;
  model: string | null;
  timeoutMs: number | null;
  dimensions?: number;
  topN?: number;
  source: 'db' | 'unconfigured';
  primaryModelId?: string;
  fallbackModelId?: string;
  error?: string;
};

function getGatewayConfig(kind: GatewayLaneKind): AnyGatewayConfig {
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

async function resolveGateway(kind: GatewayLaneKind, villageId?: string | null): Promise<RuntimeGatewayResolved> {
  const resolved = await getRuntimeGatewayConfig(kind, villageId);
  return {
    config: resolved.config,
    attempts: resolved.attempts.map((attempt) => ({
      config: attempt.config,
      modelId: attempt.modelId,
      modelDisplayName: attempt.modelDisplayName,
      providerId: attempt.providerId,
    })),
    meta: resolved.meta,
  };
}

function getConfiguredModelFromConfig(gateway: AnyGatewayConfig): string {
  return gateway.model;
}

function getConfiguredModel(kind: GatewayLaneKind): string {
  return getConfiguredModelFromConfig(getGatewayConfig(kind));
}

function getGatewayPathFromConfig(kind: GatewayLaneKind, gateway: AnyGatewayConfig): string {
  switch (kind) {
    case 'embed':
      return (gateway as EmbeddingGatewayLaneConfig).embeddingsPath;
    case 'rerank':
      return (gateway as RerankGatewayLaneConfig).rerankPath;
    default:
      return (gateway as ChatGatewayLaneConfig).chatCompletionsPath;
  }
}

function getGatewayPath(kind: GatewayLaneKind): string {
  return getGatewayPathFromConfig(kind, getGatewayConfig(kind));
}

function getGatewayTimeoutFromConfig(gateway: AnyGatewayConfig): number {
  return gateway.timeoutMs;
}

function getGatewayTimeout(kind: GatewayLaneKind): number {
  return getGatewayTimeoutFromConfig(getGatewayConfig(kind));
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateEmbeddingTokens(input: string | string[]): number {
  const texts = Array.isArray(input) ? input : [input];
  return texts.reduce((sum, item) => sum + estimateTokens(item), 0);
}

function estimateRerankTokens(query: string, documents: string[]): number {
  return estimateTokens(query) + documents.reduce((sum, item) => sum + estimateTokens(item), 0);
}

function buildRerankPrompt(query: string, documents: string[]): GatewayChatMessage[] {
  return [
    {
      role: 'system',
      content: 'Rank documents by relevance to the query. Return only JSON: {"results":[{"index":0,"relevance_score":0.95}]} with one result per document.',
    },
    {
      role: 'user',
      content: JSON.stringify({ query, documents }),
    },
  ];
}

function parsePromptRerankResults(text: string, documents: string[], topN: number): GatewayRerankResultItem[] {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch?.[0] || text);
  const rawResults = Array.isArray(parsed?.results) ? parsed.results : [];

  return rawResults
    .map((item: any) => {
      const index = Number(item?.index);
      const relevanceScore = Number(item?.relevance_score ?? item?.score ?? item?.relevanceScore);
      return {
        index,
        relevanceScore: Number.isFinite(relevanceScore) ? relevanceScore : 0,
        documentText: Number.isInteger(index) ? documents[index] || '' : '',
      };
    })
    .filter((item: GatewayRerankResultItem) => Number.isInteger(item.index) && item.index >= 0 && item.index < documents.length)
    .sort((a: GatewayRerankResultItem, b: GatewayRerankResultItem) => b.relevanceScore - a.relevanceScore)
    .slice(0, topN);
}

export function isAIGatewayEnabled(_kind: GatewayLaneKind = 'llm'): boolean {
  return true;
}

export function getAIGatewayInfo(kind: GatewayLaneKind = 'llm'): GatewayInfo {
  return {
    kind,
    enabled: false,
    configured: false,
    provider: null,
    baseUrl: null,
    keyCount: 0,
    path: null,
    model: null,
    timeoutMs: null,
    dimensions: kind === 'embed' ? config.embeddingGateway.dimensions : undefined,
    topN: kind === 'rerank' ? config.rerankerGateway.topN : undefined,
    source: 'unconfigured',
    error: 'AI lane is not configured in the database',
  };
}

export async function getAIGatewayInfoAsync(kind: GatewayLaneKind = 'llm', villageId?: string | null): Promise<GatewayInfo> {
  try {
    const resolved = await resolveGateway(kind, villageId);
    const gateway = resolved.config;

    return {
      kind,
      enabled: gateway.enabled,
      configured: true,
      provider: gateway.provider,
      baseUrl: gateway.baseUrl,
      keyCount: gateway.apiKeys.length,
      path: getGatewayPathFromConfig(kind, gateway),
      model: getConfiguredModelFromConfig(gateway),
      timeoutMs: getGatewayTimeoutFromConfig(gateway),
      dimensions: kind === 'embed' ? (gateway as EmbeddingGatewayLaneConfig).dimensions : undefined,
      topN: kind === 'rerank' ? (gateway as RerankGatewayLaneConfig).topN : undefined,
      source: 'db',
      primaryModelId: resolved.meta?.primaryModelId,
      fallbackModelId: resolved.meta?.fallbackModelId,
    };
  } catch (error: any) {
    return {
      kind,
      enabled: false,
      configured: false,
      provider: null,
      baseUrl: null,
      keyCount: 0,
      path: null,
      model: null,
      timeoutMs: null,
      dimensions: kind === 'embed' ? config.embeddingGateway.dimensions : undefined,
      topN: kind === 'rerank' ? config.rerankerGateway.topN : undefined,
      source: 'unconfigured',
      error: error.message || 'AI lane is not configured in the database',
    };
  }
}

export function getAllAIGatewayInfo() {
  return {
    llm: getAIGatewayInfo('llm'),
    embed: getAIGatewayInfo('embed'),
    rag: getAIGatewayInfo('rag'),
    rerank: getAIGatewayInfo('rerank'),
  };
}

export async function getAllAIGatewayInfoAsync() {
  const [llm, embed, rag, rerank] = await Promise.all([
    getAIGatewayInfoAsync('llm'),
    getAIGatewayInfoAsync('embed'),
    getAIGatewayInfoAsync('rag'),
    getAIGatewayInfoAsync('rerank'),
  ]);

  return { llm, embed, rag, rerank };
}

export function getDefaultGatewayModels(kind: 'micro' | 'full'): string[] {
  void kind;
  return config.llmGateway.model ? [config.llmGateway.model] : [];
}

export function getDefaultRAGRewriteModels(): string[] {
  return config.ragGateway.model ? [config.ragGateway.model] : [];
}

export function parseModelListEnv(envValue: string | undefined, fallback: string[]): string[] {
  const raw = (envValue || '').trim();
  if (!raw) return [...fallback];

  const unique: string[] = [];
  for (const model of raw.split(',').map(item => item.trim()).filter(Boolean)) {
    if (!unique.includes(model)) {
      unique.push(model);
    }
  }

  return unique.length > 0 ? unique : [...fallback];
}

export function buildPromptMessages(prompt: string): GatewayChatMessage[] {
  return [{ role: 'user', content: prompt }];
}

function getGatewayApiKeysInAttemptOrder(kind: GatewayLaneKind, gateway: AnyGatewayConfig = getGatewayConfig(kind)): GatewayApiKey[] {
  const keys = gateway.apiKeys
    .map((value, index) => ({
      label: `${kind}-key-${index + 1}`,
      value,
    }))
    .filter(key => key.value.trim().length > 0);

  if (keys.length <= 1) {
    return keys;
  }

  const startIndex = nextGatewayKeyIndex[kind] % keys.length;
  nextGatewayKeyIndex[kind] = (nextGatewayKeyIndex[kind] + 1) % keys.length;
  return keys.slice(startIndex).concat(keys.slice(0, startIndex));
}

function getGatewayUrl(kind: GatewayLaneKind, gateway: AnyGatewayConfig = getGatewayConfig(kind)): string {
  const baseUrl = gateway.baseUrl.replace(/\/+$/, '');
  const rawPath = getGatewayPathFromConfig(kind, gateway);
  const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  return `${baseUrl}${path}`;
}

function buildHeaders(gateway: AnyGatewayConfig, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    ...gateway.defaultHeaders,
  };

  if (gateway.provider === 'openrouter') {
    if (gateway.openRouterSiteUrl) {
      headers['HTTP-Referer'] = gateway.openRouterSiteUrl;
    }
    if (gateway.openRouterAppName) {
      headers['X-OpenRouter-Title'] = gateway.openRouterAppName;
    }
  }

  return headers;
}

function buildOpenRouterProviderPreferences(gateway: AnyGatewayConfig): Record<string, unknown> | undefined {
  if (gateway.provider !== 'openrouter') {
    return undefined;
  }

  const providerPrefs: Record<string, unknown> = {};
  if (gateway.openRouterProviderOrder.length > 0) {
    providerPrefs.order = gateway.openRouterProviderOrder;
  }
  if (!gateway.openRouterAllowFallbacks) {
    providerPrefs.allow_fallbacks = false;
  }
  if (gateway.openRouterRequireParameters) {
    providerPrefs.require_parameters = true;
  }
  if (gateway.openRouterZDROnly) {
    providerPrefs.zdr = true;
  }

  return Object.keys(providerPrefs).length > 0 ? providerPrefs : undefined;
}

async function executeGatewayRequest<T>(
  kind: GatewayLaneKind,
  gateway: AnyGatewayConfig,
  apiKey: GatewayApiKey,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<T> {
  const response = await fetch(getGatewayUrl(kind, gateway), {
    method: 'POST',
    headers: buildHeaders(gateway, apiKey.value),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const responseText = await response.text();
  let parsed: any = null;

  try {
    parsed = responseText ? JSON.parse(responseText) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const errorMessage = parsed?.error?.message || responseText || `HTTP ${response.status}`;
    throw new Error(`${kind} gateway ${response.status}: ${errorMessage}`);
  }

  if (!parsed) {
    throw new Error(`${kind} gateway returned an empty response`);
  }

  return parsed as T;
}

function shouldRetryWithoutJsonMode(message: string): boolean {
  return /response_format|json_object|json schema|json_schema|structured output|unsupported/i.test(message);
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map(item => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'text' in item && typeof (item as { text?: unknown }).text === 'string') {
          return (item as { text: string }).text;
        }
        return '';
      })
      .join('');
  }

  return '';
}

function buildMetrics(
  kind: GatewayLaneKind,
  model: string,
  apiKey: GatewayApiKey,
  durationMs: number,
  usage: { inputTokens: number; outputTokens: number; totalTokens: number },
  startTime: number,
  attempt?: RuntimeGatewayAttempt,
): LLMMetrics {
  const provider = getGatewayConfig(kind).provider;
  const laneType = kind === 'rag' ? 'rewrite' : kind;

  return {
    startTime,
    endTime: startTime + durationMs,
    durationMs,
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    keySource: `gateway_${kind}`,
    keyId: apiKey.label,
    keyTier: provider,
    providerId: attempt?.providerId ?? null,
    modelConfigId: attempt?.modelId ?? null,
    laneType,
  };
}

function recordGatewayUsage(
  metrics: LLMMetrics,
  options: { layerType?: LayerType; callType?: CallType; context?: TokenContext },
): void {
  if (!options.layerType || !options.callType) {
    return;
  }

  recordTokenUsage({
    model: metrics.model,
    input_tokens: metrics.inputTokens,
    output_tokens: metrics.outputTokens,
    total_tokens: metrics.totalTokens,
    layer_type: options.layerType,
    call_type: options.callType,
    village_id: options.context?.village_id ?? null,
    wa_user_id: options.context?.wa_user_id ?? null,
    session_id: options.context?.session_id ?? null,
    channel: options.context?.channel ?? null,
    intent: options.context?.intent ?? null,
    success: true,
    duration_ms: metrics.durationMs,
    key_source: metrics.keySource,
    key_id: metrics.keyId,
    key_tier: metrics.keyTier,
    provider_id: metrics.providerId ?? null,
    model_config_id: metrics.modelConfigId ?? null,
    lane_type: metrics.laneType ?? null,
  }).catch(() => {});
}

function buildPromptBody(
  gateway: AnyGatewayConfig,
  model: string,
  options: GatewayPromptOptions,
  jsonMode: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: options.messages,
    stream: false,
  };

  if (typeof options.temperature === 'number') {
    body.temperature = options.temperature;
  }
  if (typeof options.maxTokens === 'number') {
    body.max_tokens = options.maxTokens;
  }
  if (jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const openRouterProvider = buildOpenRouterProviderPreferences(gateway);
  if (openRouterProvider) {
    body.provider = openRouterProvider;
  }
  if (options.extraBody) {
    Object.assign(body, options.extraBody);
  }

  return body;
}

async function executePromptRequestWithJsonFallback(
  lane: PromptLaneKind,
  gateway: AnyGatewayConfig,
  apiKey: GatewayApiKey,
  model: string,
  options: GatewayPromptOptions,
): Promise<GatewayChatCompletionResponse> {
  try {
    return await executeGatewayRequest<GatewayChatCompletionResponse>(
      lane,
      gateway,
      apiKey,
      buildPromptBody(gateway, model, options, !!options.jsonMode),
      options.timeoutMs || getGatewayTimeoutFromConfig(gateway),
    );
  } catch (error: any) {
    if (options.jsonMode && shouldRetryWithoutJsonMode(error.message || '')) {
      logger.warn('Retrying gateway request without response_format json_object', {
        lane,
        model,
        provider: gateway.provider,
        keyLabel: apiKey.label,
      });

      return executeGatewayRequest<GatewayChatCompletionResponse>(
        lane,
        gateway,
        apiKey,
        buildPromptBody(gateway, model, options, false),
        options.timeoutMs || getGatewayTimeoutFromConfig(gateway),
      );
    }

    throw error;
  }
}

export async function callAIGatewayPrompt(options: GatewayPromptOptions): Promise<GatewayPromptResult | null> {
  const lane = options.lane || 'llm';
  const resolved = await resolveGateway(lane, options.context?.village_id);
  const configuredModels = options.modelPriority.filter(Boolean);
  let lastError = 'Unknown gateway error';
  const attemptedModels: string[] = [];

  for (const attempt of resolved.attempts) {
    const gateway = attempt.config;
    if (!gateway.enabled) {
      continue;
    }

    const models = resolved.meta?.source === 'db'
      ? [getConfiguredModelFromConfig(gateway)].filter(Boolean)
      : (configuredModels.length > 0 ? configuredModels : [getConfiguredModelFromConfig(gateway)].filter(Boolean));
    const apiKeys = getGatewayApiKeysInAttemptOrder(lane, gateway);

    if (models.length === 0 || apiKeys.length === 0) {
      lastError = models.length === 0 ? 'No models configured' : 'No API keys available';
      logger.warn('AI gateway attempt skipped: incomplete configuration', {
        lane,
        provider: gateway.provider,
        modelId: attempt.modelId,
        modelDisplayName: attempt.modelDisplayName,
        modelCount: models.length,
        apiKeyCount: apiKeys.length,
        source: resolved.meta?.source,
      });
      continue;
    }

    for (const model of models) {
      attemptedModels.push(model);
      for (const apiKey of apiKeys) {
        const startTime = Date.now();

        try {
          const result = await executePromptRequestWithJsonFallback(lane, gateway, apiKey, model, options);
          const durationMs = Date.now() - startTime;
          const choice = result.choices?.[0];
          const text = extractTextContent(choice?.message?.content).trim();

          if (!text) {
            throw new Error('AI gateway returned empty message content');
          }

          const inputTokens = result.usage?.prompt_tokens ?? 0;
          const outputTokens = result.usage?.completion_tokens ?? 0;
          const totalTokens = result.usage?.total_tokens ?? (inputTokens + outputTokens);
          const resolvedModel = result.model || model;
          const metrics = buildMetrics(
            lane,
            resolvedModel,
            apiKey,
            durationMs,
            { inputTokens, outputTokens, totalTokens },
            startTime,
            attempt,
          );

          modelStatsService.recordSuccess(resolvedModel, durationMs);
          recordGatewayUsage(metrics, options);

          logger.info('AI gateway call successful', {
            lane,
            provider: gateway.provider,
            model: resolvedModel,
            modelId: attempt.modelId,
            modelDisplayName: attempt.modelDisplayName,
            keyLabel: apiKey.label,
            durationMs,
            inputTokens,
            outputTokens,
            totalTokens,
            source: resolved.meta?.source,
            fallbackUsed: Boolean(attempt.modelId && resolved.meta?.fallbackModelId === attempt.modelId),
          });

          return {
            text,
            model: resolvedModel,
            provider: result.provider || gateway.provider,
            responseId: result.id,
            finishReason: choice?.finish_reason,
            metrics,
          };
        } catch (error: any) {
          const durationMs = Date.now() - startTime;
          lastError = error.message || 'Unknown gateway error';
          modelStatsService.recordFailure(model, lastError, durationMs);

          logger.warn('AI gateway call failed', {
            lane,
            provider: gateway.provider,
            model,
            modelId: attempt.modelId,
            modelDisplayName: attempt.modelDisplayName,
            keyLabel: apiKey.label,
            durationMs,
            error: lastError,
            source: resolved.meta?.source,
          });
        }
      }
    }
  }

  logger.error('All AI gateway attempts failed', {
    lane,
    models: attemptedModels,
    lastError,
    source: resolved.meta?.source,
  });

  return null;
}

export async function callAIGatewayEmbeddings(options: GatewayEmbeddingOptions): Promise<GatewayEmbeddingResult | null> {
  const lane: GatewayLaneKind = 'embed';
  const resolved = await resolveGateway(lane, options.context?.village_id);
  let lastError = 'Unknown embedding gateway error';

  for (const attempt of resolved.attempts) {
    const gateway = attempt.config as EmbeddingGatewayLaneConfig;
    if (!gateway.enabled) {
      continue;
    }

    const model = (options.model || gateway.model).trim();
    const apiKeys = getGatewayApiKeysInAttemptOrder(lane, gateway);
    if (!model || apiKeys.length === 0) {
      lastError = !model ? 'No model configured' : 'No API keys available';
      logger.warn('Embedding gateway attempt skipped: incomplete configuration', {
        provider: gateway.provider,
        modelId: attempt.modelId,
        modelDisplayName: attempt.modelDisplayName,
        model,
        apiKeyCount: apiKeys.length,
        source: resolved.meta?.source,
      });
      continue;
    }

    const body: Record<string, unknown> = {
      model,
      input: options.input,
      encoding_format: options.encodingFormat || gateway.encodingFormat,
      dimensions: options.dimensions || gateway.dimensions,
    };

    const openRouterProvider = buildOpenRouterProviderPreferences(gateway);
    if (openRouterProvider) {
      body.provider = openRouterProvider;
    }
    if (options.extraBody) {
      Object.assign(body, options.extraBody);
    }

    for (const apiKey of apiKeys) {
      const startTime = Date.now();

      try {
        const result = await executeGatewayRequest<GatewayEmbeddingResponse>(
          lane,
          gateway,
          apiKey,
          body,
          options.timeoutMs || gateway.timeoutMs,
        );
        const durationMs = Date.now() - startTime;
        const embeddings = (result.data || [])
          .map(item => item.embedding)
          .filter((item): item is number[] => Array.isArray(item) && item.length > 0);

        if (embeddings.length === 0) {
          throw new Error('Embedding gateway returned no embeddings');
        }

        const inputTokens = result.usage?.prompt_tokens ?? estimateEmbeddingTokens(options.input);
        const totalTokens = result.usage?.total_tokens ?? inputTokens;
        const resolvedModel = result.model || model;
        const metrics = buildMetrics(
          lane,
          resolvedModel,
          apiKey,
          durationMs,
          { inputTokens, outputTokens: 0, totalTokens },
          startTime,
          attempt,
        );

        modelStatsService.recordSuccess(resolvedModel, durationMs);
        recordGatewayUsage(metrics, options);

        logger.info('Embedding gateway call successful', {
          provider: gateway.provider,
          model: resolvedModel,
          modelId: attempt.modelId,
          modelDisplayName: attempt.modelDisplayName,
          keyLabel: apiKey.label,
          durationMs,
          embeddingCount: embeddings.length,
          dimensions: embeddings[0]?.length,
          source: resolved.meta?.source,
          fallbackUsed: Boolean(attempt.modelId && resolved.meta?.fallbackModelId === attempt.modelId),
        });

        return {
          embeddings,
          model: resolvedModel,
          provider: result.provider || gateway.provider,
          responseId: result.id,
          metrics,
        };
      } catch (error: any) {
        const durationMs = Date.now() - startTime;
        lastError = error.message || 'Unknown embedding gateway error';
        modelStatsService.recordFailure(model, lastError, durationMs);

        logger.warn('Embedding gateway call failed', {
          provider: gateway.provider,
          model,
          modelId: attempt.modelId,
          modelDisplayName: attempt.modelDisplayName,
          keyLabel: apiKey.label,
          durationMs,
          error: lastError,
          source: resolved.meta?.source,
        });
      }
    }
  }

  logger.error('All embedding gateway attempts failed', {
    lane,
    lastError,
    source: resolved.meta?.source,
  });

  return null;
}

export async function callAIGatewayRerank(options: GatewayRerankOptions): Promise<GatewayRerankResult | null> {
  const lane: GatewayLaneKind = 'rerank';
  const resolved = await resolveGateway(lane, options.context?.village_id);
  let lastError = 'Unknown rerank gateway error';

  for (const attempt of resolved.attempts) {
    const gateway = attempt.config as RerankGatewayLaneConfig;
    if (!gateway.enabled) {
      continue;
    }

    const model = (options.model || gateway.model).trim();
    const apiKeys = getGatewayApiKeysInAttemptOrder(lane, gateway);
    if (!model || apiKeys.length === 0) {
      lastError = !model ? 'No model configured' : 'No API keys available';
      logger.warn('Rerank gateway attempt skipped: incomplete configuration', {
        provider: gateway.provider,
        modelId: attempt.modelId,
        modelDisplayName: attempt.modelDisplayName,
        model,
        apiKeyCount: apiKeys.length,
        source: resolved.meta?.source,
      });
      continue;
    }

    const body: Record<string, unknown> = {
      model,
      query: options.query,
      documents: options.documents,
      top_n: options.topN || gateway.topN,
    };

    const openRouterProvider = buildOpenRouterProviderPreferences(gateway);
    if (openRouterProvider) {
      body.provider = openRouterProvider;
    }
    if (options.extraBody) {
      Object.assign(body, options.extraBody);
    }

    for (const apiKey of apiKeys) {
      const startTime = Date.now();

      try {
        const result = await executeGatewayRequest<GatewayRerankResponse>(
          lane,
          gateway,
          apiKey,
          body,
          options.timeoutMs || gateway.timeoutMs,
        );
        const durationMs = Date.now() - startTime;
        const items = (result.results || []).map(item => ({
          index: item.index,
          relevanceScore: item.relevance_score,
          documentText: item.document?.text || options.documents[item.index] || '',
        }));

        if (items.length === 0) {
          throw new Error('Rerank gateway returned no results');
        }

        const inputTokens = result.usage?.total_tokens ?? estimateRerankTokens(options.query, options.documents);
        const totalTokens = result.usage?.total_tokens ?? inputTokens;
        const resolvedModel = result.model || model;
        const metrics = buildMetrics(
          lane,
          resolvedModel,
          apiKey,
          durationMs,
          { inputTokens, outputTokens: 0, totalTokens },
          startTime,
          attempt,
        );

        modelStatsService.recordSuccess(resolvedModel, durationMs);
        recordGatewayUsage(metrics, options);

        logger.info('Rerank gateway call successful', {
          provider: gateway.provider,
          model: resolvedModel,
          modelId: attempt.modelId,
          modelDisplayName: attempt.modelDisplayName,
          keyLabel: apiKey.label,
          durationMs,
          resultCount: items.length,
          topScore: items[0]?.relevanceScore,
          source: resolved.meta?.source,
          fallbackUsed: Boolean(attempt.modelId && resolved.meta?.fallbackModelId === attempt.modelId),
        });

        return {
          items,
          model: resolvedModel,
          provider: result.provider || gateway.provider,
          responseId: result.id,
          metrics,
        };
      } catch (error: any) {
        const durationMs = Date.now() - startTime;
        lastError = error.message || 'Unknown rerank gateway error';

        if (/Input required: specify "prompt" or "messages"/i.test(lastError)) {
          try {
            const promptResult = await callAIGatewayPrompt({
              lane: 'rag',
              modelPriority: [model],
              messages: buildRerankPrompt(options.query, options.documents),
              temperature: 0,
              maxTokens: 300,
              timeoutMs: options.timeoutMs || gateway.timeoutMs,
              jsonMode: true,
              layerType: options.layerType,
              callType: options.callType,
              context: options.context,
            });

            if (promptResult?.text) {
              const items = parsePromptRerankResults(promptResult.text, options.documents, options.topN || gateway.topN);
              if (items.length > 0) {
                logger.info('Rerank gateway prompt fallback successful', {
                  provider: gateway.provider,
                  model,
                  modelId: attempt.modelId,
                  modelDisplayName: attempt.modelDisplayName,
                  keyLabel: apiKey.label,
                  durationMs,
                  resultCount: items.length,
                  source: resolved.meta?.source,
                });

                return {
                  items,
                  model: promptResult.model,
                  provider: promptResult.provider,
                  responseId: promptResult.responseId,
                  metrics: promptResult.metrics,
                };
              }
            }
          } catch (fallbackError: any) {
            lastError = fallbackError.message || lastError;
          }
        }

        modelStatsService.recordFailure(model, lastError, durationMs);

        logger.warn('Rerank gateway call failed', {
          provider: gateway.provider,
          model,
          modelId: attempt.modelId,
          modelDisplayName: attempt.modelDisplayName,
          keyLabel: apiKey.label,
          durationMs,
          error: lastError,
          source: resolved.meta?.source,
        });
      }
    }
  }

  logger.error('All rerank gateway attempts failed', {
    lane,
    lastError,
    source: resolved.meta?.source,
  });

  return null;
}

export async function pingAIGateway(modelPriority: string[], lane: PromptLaneKind = 'llm'): Promise<GatewayPromptResult | null> {
  return callAIGatewayPrompt({
    lane,
    modelPriority,
    messages: [{ role: 'user', content: 'Reply with just: OK' }],
    temperature: 0,
    maxTokens: 10,
    timeoutMs: getGatewayTimeout(lane),
    layerType: 'micro_nlu',
    callType: 'connection_test',
  });
}
