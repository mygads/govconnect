import { Router, Request, Response } from 'express';
import logger from '../utils/logger';
import { config } from '../config/env';
import {
  callAIGatewayEmbeddings,
  callAIGatewayPrompt,
  callAIGatewayRerank,
  getAIGatewayInfo,
  getAllAIGatewayInfo,
  getDefaultGatewayModels,
  getDefaultRAGRewriteModels,
  isAIGatewayEnabled,
  pingAIGateway,
} from '../services/ai-gateway.service';
import { processUnifiedMessage } from '../services/unified-message-processor.service';
import { firstHeader } from '../utils/http';

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

function verifyInternalKey(req: Request, res: Response, next: Function) {
  const apiKey = firstHeader(req.headers['x-internal-api-key']);

  if (!apiKey || apiKey !== config.internalApiKey) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  next();
}

async function pingLLMLane(): Promise<LanePingResult> {
  if (!isAIGatewayEnabled('llm')) {
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
      gateway: getAIGatewayInfo('llm'),
    },
  };
}

async function pingEmbedLane(): Promise<LanePingResult> {
  if (!isAIGatewayEnabled('embed')) {
    return { lane: 'embed', status: 'disabled', error: 'Embed lane is not configured' };
  }

  const result = await callAIGatewayEmbeddings({
    input: 'ping embedding healthcheck',
    model: config.embeddingGateway.model,
    dimensions: config.embeddingGateway.dimensions,
    timeoutMs: config.embeddingGateway.timeoutMs,
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
      gateway: getAIGatewayInfo('embed'),
    },
  };
}

async function pingRAGLane(): Promise<LanePingResult> {
  if (!isAIGatewayEnabled('rag')) {
    return { lane: 'rag', status: 'disabled', error: 'RAG rewrite lane is not configured' };
  }

  const result = await callAIGatewayPrompt({
    lane: 'rag',
    modelPriority: getDefaultRAGRewriteModels(),
    messages: [{ role: 'user', content: 'Rewrite this as a short retrieval query: cara bikin ktp baru' }],
    temperature: 0,
    maxTokens: 60,
    timeoutMs: config.ragGateway.timeoutMs,
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
      gateway: getAIGatewayInfo('rag'),
    },
  };
}

async function pingRerankLane(): Promise<LanePingResult> {
  if (!isAIGatewayEnabled('rerank')) {
    return { lane: 'rerank', status: 'disabled', error: 'Rerank lane is not configured' };
  }

  const result = await callAIGatewayRerank({
    query: 'cara bikin ktp baru',
    documents: [
      'Panduan pembuatan KTP baru beserta syarat administrasi.',
      'Jadwal posyandu minggu depan di balai desa.',
      'Prosedur penggantian KK hilang dan dokumen pendukung.',
    ],
    model: config.rerankerGateway.model,
    topN: Math.min(3, config.rerankerGateway.topN),
    timeoutMs: config.rerankerGateway.timeoutMs,
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
      gateway: getAIGatewayInfo('rerank'),
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
      gateways: getAllAIGatewayInfo(),
      tests,
    });
  } catch (error: any) {
    logger.error('AI gateway lanes ping error', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Ping failed',
      details: error.message,
      gateways: getAllAIGatewayInfo(),
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
