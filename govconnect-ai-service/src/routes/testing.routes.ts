import { Router, Request, Response } from 'express';
import logger from '../utils/logger';
import prisma from '../lib/prisma';
import { config } from '../config/env';
import {
  callAIGatewayEmbeddings,
  callAIGatewayPrompt,
  callAIGatewayRerank,
  getAIGatewayInfoAsync,
  getAllAIGatewayInfoAsync,
  getDefaultGatewayModels,
  getDefaultRAGRewriteModels,
  pingAIGateway,
} from '../services/ai-gateway.service';
import { processUnifiedMessage } from '../services/unified-message-processor.service';
import { firstHeader } from '../utils/http';
import { internalApiKeyMatches } from '../utils/internal-auth';
import { decryptSecret } from '../utils/crypto';
import { sanitizeProviderDefaultHeaders } from '../utils/provider-headers';

const router = Router();

type LanePingStatus = 'connected' | 'error' | 'disabled';

interface LanePingResult {
  lane: 'llm' | 'embed' | 'rag' | 'rerank';
  status: LanePingStatus;
  provider?: string;
  model?: string;
  responseTime?: number;
  details?: Record<string, unknown>;
  error?: string;
}

type ModelTestLane = 'llm' | 'embed' | 'rewrite' | 'rerank';

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}/${(path || '').replace(/^\/+/, '')}`;
}

async function postProviderJson(provider: any, endpointPath: string, apiKey: string, body: Record<string, unknown>, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = joinUrl(provider.base_url, endpointPath);
  try {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...sanitizeProviderDefaultHeaders(provider.default_headers_json),
    };
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as any;
    if (!response.ok) {
      throw new Error(payload?.error?.message || payload?.error || `Provider returned HTTP ${response.status}`);
    }
    return payload;
  } catch (error: any) {
    const cause = error?.cause?.message || error?.cause?.code;
    const message = error?.name === 'AbortError'
      ? `Provider request timed out after ${timeoutMs}ms`
      : cause
        ? `${error.message}: ${cause}`
        : error?.message || 'Provider request failed';
    logger.warn('AI provider model test request failed', {
      provider: provider.slug || provider.name,
      endpointPath,
      url,
      error: message,
    });
    throw new Error(message);
  } finally {
    clearTimeout(timeout);
  }
}

async function testModelById(modelId: string) {
  const model = await prisma.ai_models.findUnique({
    where: { id: modelId },
    include: { provider: true },
  });
  if (!model?.provider) throw new Error('Model not found');
  if (!model.is_active || !model.provider.is_active) throw new Error('Model or provider is inactive');
  if (!model.provider.api_key_encrypted) throw new Error('Provider API key is missing');

  const lane = model.lane_type as ModelTestLane;
  const apiKey = decryptSecret(model.provider.api_key_encrypted);
  const startTime = Date.now();
  let details: Record<string, unknown> = {};

  if (lane === 'embed') {
    const payload = await postProviderJson(
      model.provider,
      model.endpoint_path || config.embeddingGateway.embeddingsPath,
      apiKey,
      {
        model: model.upstream_model_name,
        input: 'ping embedding healthcheck',
        encoding_format: config.embeddingGateway.encodingFormat,
        dimensions: config.embeddingGateway.dimensions,
      },
      config.embeddingGateway.timeoutMs,
    );
    details = { dimensions: payload?.data?.[0]?.embedding?.length || 0 };
  } else if (lane === 'rerank') {
    try {
      const payload = await postProviderJson(
        model.provider,
        model.endpoint_path || config.rerankerGateway.rerankPath,
        apiKey,
        {
          model: model.upstream_model_name,
          query: 'cara bikin ktp baru',
          documents: ['Panduan pembuatan KTP baru.', 'Jadwal posyandu desa.', 'Syarat penggantian KK.'],
          top_n: 2,
        },
        config.rerankerGateway.timeoutMs,
      );
      details = { mode: 'native_rerank', resultCount: payload?.results?.length || 0, topScore: payload?.results?.[0]?.relevance_score };
    } catch (error: any) {
      if (!/Input required: specify "prompt" or "messages"|messages|prompt/i.test(error.message || '')) throw error;
      const payload = await postProviderJson(
        model.provider,
        model.endpoint_path || config.ragGateway.chatCompletionsPath || config.llmGateway.chatCompletionsPath,
        apiKey,
        {
          model: model.upstream_model_name,
          messages: [{ role: 'user', content: 'Rank these documents for the query "cara bikin ktp baru" and reply with OK only.' }],
          temperature: 0,
          max_tokens: 8,
        },
        config.rerankerGateway.timeoutMs,
      );
      details = {
        mode: 'prompt_fallback',
        response: payload?.choices?.[0]?.message?.content || payload?.choices?.[0]?.text || '',
      };
    }
  } else {
    const timeoutMs = lane === 'rewrite' ? config.ragGateway.timeoutMs : config.llmGateway.timeoutMs;
    const endpointPath = model.endpoint_path || (lane === 'rewrite' ? config.ragGateway.chatCompletionsPath : config.llmGateway.chatCompletionsPath);
    const payload = await postProviderJson(
      model.provider,
      endpointPath,
      apiKey,
      {
        model: model.upstream_model_name,
        messages: [{ role: 'user', content: lane === 'rewrite' ? 'Rewrite: cara bikin ktp baru' : 'Reply with OK only.' }],
        temperature: 0,
        max_tokens: 8,
      },
      timeoutMs,
    );
    details = { response: payload?.choices?.[0]?.message?.content || payload?.choices?.[0]?.text || '' };
  }

  return {
    success: true,
    lane,
    provider: model.provider.name,
    provider_slug: model.provider.slug,
    model: model.display_name,
    upstream_model: model.upstream_model_name,
    responseTime: Date.now() - startTime,
    details,
  };
}

function verifyInternalKey(req: Request, res: Response, next: Function) {
  const apiKey = firstHeader(req.headers['x-internal-api-key']);

  if (!internalApiKeyMatches(apiKey)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  next();
}

async function pingLLMLane(): Promise<LanePingResult> {
  const gateway = await getAIGatewayInfoAsync('llm');
  if (!gateway.enabled) {
    return { lane: 'llm', status: 'disabled', error: 'LLM lane is not configured' };
  }

  const models = getDefaultGatewayModels('micro');
  const result = await pingAIGateway(models, 'llm');

  if (!result) {
    return {
      lane: 'llm',
      status: 'error',
      error: 'All LLM lane ping attempts failed',
    };
  }

  return {
    lane: 'llm',
    status: 'connected',
    provider: result.provider,
    model: result.model,
    responseTime: result.metrics.durationMs,
    details: {
      response: result.text,
      gateway,
    },
  };
}

async function pingEmbedLane(): Promise<LanePingResult> {
  const gateway = await getAIGatewayInfoAsync('embed');
  if (!gateway.enabled) {
    return { lane: 'embed', status: 'disabled', error: 'Embed lane is not configured' };
  }

  const result = await callAIGatewayEmbeddings({
    input: 'ping embedding healthcheck',
    model: gateway.model || undefined,
    dimensions: gateway.dimensions,
    timeoutMs: gateway.timeoutMs || undefined,
    layerType: 'embedding',
    callType: 'embedding_single',
  });

  if (!result) {
    return {
      lane: 'embed',
      status: 'error',
      error: 'Embed lane request failed',
    };
  }

  return {
    lane: 'embed',
    status: 'connected',
    provider: result.provider,
    model: result.model,
    responseTime: result.metrics.durationMs,
    details: {
      dimensions: result.embeddings[0]?.length || 0,
      gateway,
    },
  };
}

async function pingRAGLane(): Promise<LanePingResult> {
  const gateway = await getAIGatewayInfoAsync('rag');
  if (!gateway.enabled) {
    return { lane: 'rag', status: 'disabled', error: 'RAG rewrite lane is not configured' };
  }

  const result = await callAIGatewayPrompt({
    lane: 'rag',
    modelPriority: gateway.model ? [gateway.model] : getDefaultRAGRewriteModels(),
    messages: [{ role: 'user', content: 'Rewrite this as a short retrieval query: cara bikin ktp baru' }],
    temperature: 0,
    maxTokens: 60,
    timeoutMs: gateway.timeoutMs || undefined,
    jsonMode: false,
    layerType: 'rag_expand',
    callType: 'rag_query_expand',
  });

  if (!result) {
    return {
      lane: 'rag',
      status: 'error',
      error: 'RAG rewrite lane request failed',
    };
  }

  return {
    lane: 'rag',
    status: 'connected',
    provider: result.provider,
    model: result.model,
    responseTime: result.metrics.durationMs,
    details: {
      response: result.text,
      gateway,
    },
  };
}

async function pingRerankLane(): Promise<LanePingResult> {
  const gateway = await getAIGatewayInfoAsync('rerank');
  if (!gateway.enabled) {
    return { lane: 'rerank', status: 'disabled', error: 'Rerank lane is not configured' };
  }

  const result = await callAIGatewayRerank({
    query: 'cara bikin ktp baru',
    documents: [
      'Panduan pembuatan KTP baru beserta syarat administrasi.',
      'Jadwal posyandu minggu depan di balai desa.',
      'Prosedur penggantian KK hilang dan dokumen pendukung.',
    ],
    model: gateway.model || undefined,
    topN: Math.min(3, gateway.topN || 3),
    timeoutMs: gateway.timeoutMs || undefined,
    layerType: 'rag_rerank',
    callType: 'rerank_documents',
  });

  if (!result) {
    return {
      lane: 'rerank',
      status: 'error',
      error: 'Rerank lane request failed',
    };
  }

  return {
    lane: 'rerank',
    status: 'connected',
    provider: result.provider,
    model: result.model,
    responseTime: result.metrics.durationMs,
    details: {
      topScore: result.items[0]?.relevanceScore,
      resultCount: result.items.length,
      gateway,
    },
  };
}

router.post('/ping', verifyInternalKey, async (_req: Request, res: Response) => {
  try {
    const startTime = Date.now();

    const [llm, embed, rag, rerank] = await Promise.all([
      pingLLMLane(),
      pingEmbedLane(),
      pingRAGLane(),
      pingRerankLane(),
    ]);

    const tests = { llm, embed, rag, rerank };
    const hasBlockingError = Object.values(tests).some(test => test.status === 'error');
    const statusCode = hasBlockingError ? 503 : 200;

    logger.info('AI gateway lanes ping completed', {
      tests,
      totalResponseTime: Date.now() - startTime,
    });

    return res.status(statusCode).json({
      success: !hasBlockingError,
      responseTime: Date.now() - startTime,
      gateways: await getAllAIGatewayInfoAsync(),
      tests,
    });
  } catch (error: any) {
    logger.error('AI gateway lanes ping error', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Ping failed',
      details: error.message,
      gateways: await getAllAIGatewayInfoAsync(),
    });
  }
});

router.post('/model', verifyInternalKey, async (req: Request, res: Response) => {
  try {
    const { model_id } = req.body || {};
    if (!model_id || typeof model_id !== 'string') {
      return res.status(400).json({ success: false, error: 'model_id is required' });
    }

    const result = await testModelById(model_id);
    logger.info('Targeted AI model test completed', {
      modelId: model_id,
      lane: result.lane,
      provider: result.provider_slug,
      responseTime: result.responseTime,
    });
    return res.json(result);
  } catch (error: any) {
    logger.warn('Targeted AI model test failed', { error: error.message });
    return res.status(400).json({
      success: false,
      error: error.message || 'Model test failed',
    });
  }
});

router.post('/chat', verifyInternalKey, async (req: Request, res: Response) => {
  try {
    const { message, village_id, villageId, user_id } = req.body || {};
    const resolvedVillageId: string | undefined = typeof village_id === 'string' && village_id.length > 0
      ? village_id
      : typeof villageId === 'string' && villageId.length > 0
        ? villageId
        : undefined;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message wajib diisi' });
    }

    const userId = typeof user_id === 'string' && user_id.length > 0
      ? user_id
      : `test_admin_${Date.now()}`;

    logger.info('Testing chat request', {
      userId,
      village_id: resolvedVillageId,
      messageLength: message.length,
      processor: 'UNIFIED',
    });

    const result = await processUnifiedMessage({
      userId,
      message,
      channel: 'webchat',
      villageId: resolvedVillageId,
      conversationHistory: [],
      isEvaluation: true,
      sideEffectMode: 'knowledge_test',
    });

    return res.json({
      success: result.success,
      data: result,
    });
  } catch (error: any) {
    logger.error('Testing chat error', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Testing chat failed',
      details: error.message,
    });
  }
});

export default router;
