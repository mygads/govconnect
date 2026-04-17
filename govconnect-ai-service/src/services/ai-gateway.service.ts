import { config, type GatewayLaneKind } from '../config/env';
import type { LLMMetrics } from '../types/llm-response.types';
import logger from '../utils/logger';
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

function getGatewayConfig(kind: GatewayLaneKind) {
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

function getConfiguredModel(kind: GatewayLaneKind): string {
  switch (kind) {
    case 'embed':
      return config.embeddingGateway.model;
    case 'rag':
      return config.ragGateway.model;
    case 'rerank':
      return config.rerankerGateway.model;
    default:
      return config.llmGateway.model;
  }
}

function getGatewayPath(kind: GatewayLaneKind): string {
  switch (kind) {
    case 'embed':
      return config.embeddingGateway.embeddingsPath;
    case 'rag':
      return config.ragGateway.chatCompletionsPath;
    case 'rerank':
      return config.rerankerGateway.rerankPath;
    default:
      return config.llmGateway.chatCompletionsPath;
  }
}

function getGatewayTimeout(kind: GatewayLaneKind): number {
  switch (kind) {
    case 'embed':
      return config.embeddingGateway.timeoutMs;
    case 'rag':
      return config.ragGateway.timeoutMs;
    case 'rerank':
      return config.rerankerGateway.timeoutMs;
    default:
      return config.llmGateway.timeoutMs;
  }
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

export function isAIGatewayEnabled(kind: GatewayLaneKind = 'llm'): boolean {
  return getGatewayConfig(kind).enabled;
}

export function getAIGatewayInfo(kind: GatewayLaneKind = 'llm') {
  const gateway = getGatewayConfig(kind);

  return {
    kind,
    enabled: gateway.enabled,
    provider: gateway.provider,
    baseUrl: gateway.baseUrl,
    keyCount: gateway.apiKeys.length,
    path: getGatewayPath(kind),
    model: getConfiguredModel(kind),
    timeoutMs: getGatewayTimeout(kind),
    dimensions: kind === 'embed' ? config.embeddingGateway.dimensions : undefined,
    topN: kind === 'rerank' ? config.rerankerGateway.topN : undefined,
  };
}

export function getAllAIGatewayInfo() {
  return {
    llm: getAIGatewayInfo('llm'),
    embed: getAIGatewayInfo('embed'),
    rag: getAIGatewayInfo('rag'),
    rerank: getAIGatewayInfo('rerank'),
  };
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

function getGatewayApiKeysInAttemptOrder(kind: GatewayLaneKind): GatewayApiKey[] {
  const gateway = getGatewayConfig(kind);
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

function getGatewayUrl(kind: GatewayLaneKind): string {
  const gateway = getGatewayConfig(kind);
  const baseUrl = gateway.baseUrl.replace(/\/+$/, '');
  const rawPath = getGatewayPath(kind);
  const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  return `${baseUrl}${path}`;
}

function buildHeaders(kind: GatewayLaneKind, apiKey: string): Record<string, string> {
  const gateway = getGatewayConfig(kind);
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

function buildOpenRouterProviderPreferences(kind: GatewayLaneKind): Record<string, unknown> | undefined {
  const gateway = getGatewayConfig(kind);
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
  apiKey: GatewayApiKey,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<T> {
  const response = await fetch(getGatewayUrl(kind), {
    method: 'POST',
    headers: buildHeaders(kind, apiKey.value),
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
): LLMMetrics {
  const provider = getGatewayConfig(kind).provider;

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
  }).catch(() => {});
}

function buildPromptBody(
  lane: PromptLaneKind,
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

  const openRouterProvider = buildOpenRouterProviderPreferences(lane);
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
  apiKey: GatewayApiKey,
  model: string,
  options: GatewayPromptOptions,
): Promise<GatewayChatCompletionResponse> {
  try {
    return await executeGatewayRequest<GatewayChatCompletionResponse>(
      lane,
      apiKey,
      buildPromptBody(lane, model, options, !!options.jsonMode),
      options.timeoutMs || getGatewayTimeout(lane),
    );
  } catch (error: any) {
    if (options.jsonMode && shouldRetryWithoutJsonMode(error.message || '')) {
      logger.warn('Retrying gateway request without response_format json_object', {
        lane,
        model,
        provider: getGatewayConfig(lane).provider,
        keyLabel: apiKey.label,
      });

      return executeGatewayRequest<GatewayChatCompletionResponse>(
        lane,
        apiKey,
        buildPromptBody(lane, model, options, false),
        options.timeoutMs || getGatewayTimeout(lane),
      );
    }

    throw error;
  }
}

export async function callAIGatewayPrompt(options: GatewayPromptOptions): Promise<GatewayPromptResult | null> {
  const lane = options.lane || 'llm';
  if (!isAIGatewayEnabled(lane)) {
    return null;
  }

  const models = options.modelPriority.filter(Boolean);
  if (models.length === 0) {
    logger.warn('AI gateway call skipped: no models configured', { lane });
    return null;
  }

  const apiKeys = getGatewayApiKeysInAttemptOrder(lane);
  if (apiKeys.length === 0) {
    logger.error('AI gateway enabled but no API keys are available', { lane });
    return null;
  }

  let lastError = 'Unknown gateway error';

  for (const model of models) {
    for (const apiKey of apiKeys) {
      const startTime = Date.now();

      try {
        const result = await executePromptRequestWithJsonFallback(lane, apiKey, model, options);
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
        );

        modelStatsService.recordSuccess(resolvedModel, durationMs);
        recordGatewayUsage(metrics, options);

        logger.info('AI gateway call successful', {
          lane,
          provider: getGatewayConfig(lane).provider,
          model: resolvedModel,
          keyLabel: apiKey.label,
          durationMs,
          inputTokens,
          outputTokens,
          totalTokens,
        });

        return {
          text,
          model: resolvedModel,
          provider: result.provider || getGatewayConfig(lane).provider,
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
          provider: getGatewayConfig(lane).provider,
          model,
          keyLabel: apiKey.label,
          durationMs,
          error: lastError,
        });
      }
    }
  }

  logger.error('All AI gateway attempts failed', {
    lane,
    provider: getGatewayConfig(lane).provider,
    models,
    lastError,
  });

  return null;
}

export async function callAIGatewayEmbeddings(options: GatewayEmbeddingOptions): Promise<GatewayEmbeddingResult | null> {
  const lane: GatewayLaneKind = 'embed';
  if (!isAIGatewayEnabled(lane)) {
    return null;
  }

  const model = (options.model || config.embeddingGateway.model).trim();
  const apiKeys = getGatewayApiKeysInAttemptOrder(lane);
  if (!model || apiKeys.length === 0) {
    logger.error('Embedding gateway configuration is incomplete', {
      model,
      apiKeyCount: apiKeys.length,
    });
    return null;
  }

  const body: Record<string, unknown> = {
    model,
    input: options.input,
    encoding_format: options.encodingFormat || config.embeddingGateway.encodingFormat,
    dimensions: options.dimensions || config.embeddingGateway.dimensions,
  };

  const openRouterProvider = buildOpenRouterProviderPreferences(lane);
  if (openRouterProvider) {
    body.provider = openRouterProvider;
  }
  if (options.extraBody) {
    Object.assign(body, options.extraBody);
  }

  let lastError = 'Unknown embedding gateway error';

  for (const apiKey of apiKeys) {
    const startTime = Date.now();

    try {
      const result = await executeGatewayRequest<GatewayEmbeddingResponse>(
        lane,
        apiKey,
        body,
        options.timeoutMs || getGatewayTimeout(lane),
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
      );

      modelStatsService.recordSuccess(resolvedModel, durationMs);
      recordGatewayUsage(metrics, options);

      logger.info('Embedding gateway call successful', {
        provider: config.embeddingGateway.provider,
        model: resolvedModel,
        keyLabel: apiKey.label,
        durationMs,
        embeddingCount: embeddings.length,
        dimensions: embeddings[0]?.length,
      });

      return {
        embeddings,
        model: resolvedModel,
        provider: result.provider || config.embeddingGateway.provider,
        responseId: result.id,
        metrics,
      };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      lastError = error.message || 'Unknown embedding gateway error';
      modelStatsService.recordFailure(model, lastError, durationMs);

      logger.warn('Embedding gateway call failed', {
        provider: config.embeddingGateway.provider,
        model,
        keyLabel: apiKey.label,
        durationMs,
        error: lastError,
      });
    }
  }

  logger.error('All embedding gateway attempts failed', {
    provider: config.embeddingGateway.provider,
    model,
    lastError,
  });

  return null;
}

export async function callAIGatewayRerank(options: GatewayRerankOptions): Promise<GatewayRerankResult | null> {
  const lane: GatewayLaneKind = 'rerank';
  if (!isAIGatewayEnabled(lane)) {
    return null;
  }

  const model = (options.model || config.rerankerGateway.model).trim();
  const apiKeys = getGatewayApiKeysInAttemptOrder(lane);
  if (!model || apiKeys.length === 0) {
    logger.error('Rerank gateway configuration is incomplete', {
      model,
      apiKeyCount: apiKeys.length,
    });
    return null;
  }

  const body: Record<string, unknown> = {
    model,
    query: options.query,
    documents: options.documents,
    top_n: options.topN || config.rerankerGateway.topN,
  };

  const openRouterProvider = buildOpenRouterProviderPreferences(lane);
  if (openRouterProvider) {
    body.provider = openRouterProvider;
  }
  if (options.extraBody) {
    Object.assign(body, options.extraBody);
  }

  let lastError = 'Unknown rerank gateway error';

  for (const apiKey of apiKeys) {
    const startTime = Date.now();

    try {
      const result = await executeGatewayRequest<GatewayRerankResponse>(
        lane,
        apiKey,
        body,
        options.timeoutMs || getGatewayTimeout(lane),
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
      );

      modelStatsService.recordSuccess(resolvedModel, durationMs);
      recordGatewayUsage(metrics, options);

      logger.info('Rerank gateway call successful', {
        provider: config.rerankerGateway.provider,
        model: resolvedModel,
        keyLabel: apiKey.label,
        durationMs,
        resultCount: items.length,
        topScore: items[0]?.relevanceScore,
      });

      return {
        items,
        model: resolvedModel,
        provider: result.provider || config.rerankerGateway.provider,
        responseId: result.id,
        metrics,
      };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      lastError = error.message || 'Unknown rerank gateway error';
      modelStatsService.recordFailure(model, lastError, durationMs);

      logger.warn('Rerank gateway call failed', {
        provider: config.rerankerGateway.provider,
        model,
        keyLabel: apiKey.label,
        durationMs,
        error: lastError,
      });
    }
  }

  logger.error('All rerank gateway attempts failed', {
    provider: config.rerankerGateway.provider,
    model,
    lastError,
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
