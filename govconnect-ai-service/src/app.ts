import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import promClient from 'prom-client';
import logger from './utils/logger';
import {
  isConnected as isRabbitMQConnected,
  getRetryQueueStatus,
  getAIRetryQueueStatus,
  getFailedMessages,
  retryFailedMessage,
  retryAllFailedMessages,
  clearFailedMessages,
} from './services/rabbitmq.service';
import { checkCaseServiceHealth } from './services/case-client.service';
import { modelStatsService } from './services/model-stats.service';
import { rateLimiterService } from './services/rate-limiter.service';
import { getSpamGuardStats as getAISpamGuardStats } from './services/spam-guard.service';
import { aiAnalyticsService } from './services/ai-analytics.service';
import { getGuardrailObservabilityDurable, getMemoryObservabilityDurable } from './services/runtime-observability.service';
import { getToolPolicyObservabilityDurable } from './services/agent/tool-policy.service';
import { exportObservabilityData, toNdjson, type ObservabilityExportKind } from './services/observability-export.service';
import { getEmbeddingStats, getEmbeddingCacheStats } from './services/embedding.service';
import { getVectorDbStats } from './services/vector-db.service';
import { resilientHttp } from './services/circuit-breaker.service';
import { getTopCachedQueries, getCacheStats, clearCache as clearResponseCache } from './services/response-cache.service';
import { getFSMStats, getAllActiveContexts } from './services/conversation-fsm.service';
import knowledgeRoutes from './routes/knowledge.routes';
import searchRoutes from './routes/search.routes';
import uploadRoutes from './routes/upload.routes';
import webchatRoutes from './routes/webchat.routes';
import statusRoutes from './routes/status.routes';
import testingRoutes from './routes/testing.routes';
import { swaggerSpec } from './config/swagger';
import axios from 'axios';
import { z } from 'zod';
import { config } from './config/env';
import prisma from './lib/prisma';
import { finalizeAiBillingTurn } from './services/ai-turn-billing.service';
import { getParam, getQuery } from './utils/http';
import { runGoldenSetEvaluation, getGoldenSetSummary } from './services/golden-set-eval.service';
import {
  getUsageByPeriod,
  getUsageByModel,
  getUsageByProvider,
  getUsageByVillage,
  getUsageByIntentFamily,
  getUsageByTenantFlow,
  getLayerBreakdown,
  getAvgTokensPerChat,
  getResponseCountByVillage,
  getUsageByVillageAndModel,
  getUsageByPeriodAndLayer,
  getTokenUsageSummary,
  getTokenUsageBySource,
  recordTokenUsage,
  resetAllTokenUsage,
} from './services/token-usage.service';
import { clearAllUMPCaches, clearUserCaches, getUMPCacheStats, getActiveProcessingCount } from './services/unified-message-processor.service';
import { clearVillageProfileCache, getVillageProfileCacheStats } from './services/knowledge.service';
import { getEmbeddingCacheStats as getEmbCacheDetailStats } from './services/embedding.service';
import { getAllAIGatewayInfoAsync } from './services/ai-gateway.service';
import { matchComplaintType } from './services/micro-llm-matcher.service';
import { requireInternalApiKey } from './utils/internal-auth';
import { errorResponse, successResponse } from './shared/error-response';
import {
  adjustVillageWallet,
  canProcessVillageAI,
  createTopupVoucher,
  getWalletLedger,
  getWalletSummary,
  listTopupVouchers,
  listVillageWallets,
  redeemTopupVoucher,
  topupVillageWallet,
} from './services/ai-wallet.service';
import {
  createAIModel,
  createAIProvider,
  deleteAIModel,
  deleteAIProvider,
  listAILaneAssignments,
  listAIModels,
  listAIProviders,
  updateAIModel,
  updateAIProvider,
  upsertAILaneAssignment,
} from './services/ai-admin-config.service';

// Initialize Prometheus default metrics
promClient.collectDefaultMetrics({
  prefix: 'govconnect_',
  labels: { service: 'ai-service' },
});

const app = express();

// SEC-02 fix: fail-closed CORS — reject if ALLOWED_ORIGINS not configured
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()).filter(Boolean);
if (!allowedOrigins || allowedOrigins.length === 0) {
  logger.warn('⚠️  ALLOWED_ORIGINS not set — CORS will reject all cross-origin requests');
}
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins && allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
}));
app.use(helmet());

// Correlation ID middleware — must be before routes
import { correlationMiddleware } from './shared/correlation-context';
app.use(correlationMiddleware);

const internalAuthMiddleware = requireInternalApiKey;

app.use(express.json({ limit: '2mb' }));

// Prometheus Metrics endpoint (protected — Temuan 3)
app.get('/metrics', internalAuthMiddleware, async (req: Request, res: Response) => {
  try {
    res.set('Content-Type', promClient.register.contentType);
    const metrics = await promClient.register.metrics();
    res.send(metrics);
  } catch (error) {
    res.status(500).send('Error collecting metrics');
  }
});
// Swagger API Documentation (protected in production — Temuan 4)
if (config.nodeEnv !== 'production') {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    explorer: true,
    customSiteTitle: 'GovConnect AI Service API',
    customCss: '.swagger-ui .topbar { display: none }',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'list',
    },
  }));
  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
} else {
  app.use('/api-docs', internalAuthMiddleware, swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    explorer: true,
    customSiteTitle: 'GovConnect AI Service API',
    customCss: '.swagger-ui .topbar { display: none }',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'list',
    },
  }));
  app.get('/api-docs.json', internalAuthMiddleware, (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
}

// Minimal health endpoint for Docker/K8s liveness probe (Temuan 12)
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'ai-orchestrator',
    timestamp: new Date().toISOString(),
  });
});

// Detailed health endpoint — protected (Temuan 12)
app.get('/admin/health/detailed', internalAuthMiddleware, (req: Request, res: Response) => {
  const cbStats = resilientHttp.getStats();
  const rabbitConnected = isRabbitMQConnected();
  res.json({
    status: rabbitConnected ? 'ok' : 'degraded',
    service: 'ai-orchestrator',
    rabbitmq: rabbitConnected ? 'connected' : 'disconnected',
    circuitBreaker: cbStats.state,
    timestamp: new Date().toISOString(),
  });
});

app.get('/admin/health/rabbitmq', internalAuthMiddleware, (req: Request, res: Response) => {
  const connected = isRabbitMQConnected();
  const publishRetryQueue = getRetryQueueStatus();
  const aiRetryQueue = getAIRetryQueueStatus();

  res.json({
    status: connected ? 'connected' : 'disconnected',
    service: 'ai-orchestrator',
    queues: {
      publishRetry: publishRetryQueue,
      aiMessageRetry: {
        queueSize: aiRetryQueue.queueSize,
        oldestItem: aiRetryQueue.oldestItem ? new Date(aiRetryQueue.oldestItem).toISOString() : null,
        pendingCount: aiRetryQueue.pendingMessages.length,
      },
    },
  });
});

app.get('/admin/health/database', internalAuthMiddleware, async (req: Request, res: Response) => {
  void req;
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({
      status: 'ok',
      database: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('AI database health check failed', { error: error.message });
    return res.status(503).json({
      status: 'error',
      database: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

app.use('/admin', internalAuthMiddleware);
app.use('/stats', internalAuthMiddleware);
app.use('/rate-limit', internalAuthMiddleware);
app.use('/spam-guard', internalAuthMiddleware);

/**
 * Get AI message retry queue status
 * Shows messages that are waiting to be reprocessed after AI failures
 */
app.get('/stats/retry-queue', (req: Request, res: Response) => {
  try {
    const aiRetryQueue = getAIRetryQueueStatus();
    const publishRetryQueue = getRetryQueueStatus();

    res.json({
      aiMessageRetry: {
        queueSize: aiRetryQueue.queueSize,
        maxRetryAttempts: 10,
        pendingMessages: aiRetryQueue.pendingMessages.map(msg => ({
          wa_user_id: msg.wa_user_id,
          attempts: msg.attempts,
          maxAttempts: 10,
          willRetry: msg.attempts < 10,
        })),
      },
      publishRetry: {
        queueSize: publishRetryQueue.queueSize,
        oldestItem: publishRetryQueue.oldestItem ? new Date(publishRetryQueue.oldestItem).toISOString() : null,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to get retry queue status',
    });
  }
});

/**
 * ==================== ADMIN FAILED MESSAGES ENDPOINTS ====================
 * For Dashboard to manage messages that exceeded max retries
 */

/**
 * Get all failed messages (for admin dashboard)
 */
app.get('/admin/failed-messages', (req: Request, res: Response) => {
  try {
    const messages = getFailedMessages();

    res.json({
      count: messages.length,
      messages: messages.map(msg => ({
        message_id: msg.event.message_id,
        wa_user_id: msg.event.wa_user_id,
        attempts: msg.attempts,
        status: msg.status,
        lastError: msg.lastError,
        firstAttempt: new Date(msg.firstAttempt).toISOString(),
        lastAttempt: new Date(msg.lastAttempt).toISOString(),
        failedAt: new Date(msg.failedAt).toISOString(),
        originalMessage: msg.event.message?.substring(0, 100),
      })),
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to get failed messages',
    });
  }
});

/**
 * Retry a specific failed message (admin manual retry)
 */
app.post('/admin/failed-messages/:messageId/retry', async (req: Request, res: Response) => {
  try {
    const messageId = getParam(req, 'messageId');
    const clearAll = getQuery(req, 'all') === 'true';
    if (!messageId) {
      res.status(400).json({
        error: 'messageId is required',
      });
      return;
    }

    logger.info('Admin retry requested', { messageId });

    const result = await retryFailedMessage(messageId);

    if (result.success) {
      res.json({
        status: 'success',
        message: 'Message retried successfully',
        messageId,
      });
    } else {
      res.status(400).json({
        status: 'failed',
        message: result.error,
        messageId,
      });
    }
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to retry message',
    });
  }
});

/**
 * Retry all failed messages (admin bulk retry)
 */
app.post('/admin/failed-messages/retry-all', async (req: Request, res: Response) => {
  try {
    logger.info('Admin retry all requested');

    const results = await retryAllFailedMessages();

    res.json({
      status: 'completed',
      results,
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to retry all messages',
    });
  }
});

/**
 * Clear failed messages (admin cleanup)
 * Query param: all=true to clear all, otherwise only cleared resolved
 */
app.delete('/admin/failed-messages', (req: Request, res: Response) => {
  try {
    const clearAll = getQuery(req, 'all') === 'true';

    logger.info('Admin clear failed messages', { clearAll });

    const count = clearFailedMessages(clearAll);

    res.json({
      status: 'success',
      cleared: count,
      clearType: clearAll ? 'all' : 'resolved-only',
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to clear messages',
    });
  }
});

// ==================== ADMIN CACHE MANAGEMENT ====================

// Global cache mode: when false, caches are bypassed (dev mode)
let _cacheEnabled = true;

/** Check if caching is enabled (used by services) */
export function isCacheEnabled(): boolean {
  return _cacheEnabled;
}

/**
 * GET /admin/cache/stats — Get all cache statistics
 */
app.get('/admin/cache/stats', internalAuthMiddleware, (req: Request, res: Response) => {
  const umpStats = getUMPCacheStats();
  const responseCacheStats = getCacheStats();
  const villageProfileStats = getVillageProfileCacheStats();

  res.json({
    cacheEnabled: _cacheEnabled,
    activeProcessing: getActiveProcessingCount(),
    umpCaches: umpStats,
    villageProfileCache: villageProfileStats,
    responseCache: responseCacheStats,
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /admin/cache/clear-all — Clear all in-memory caches
 */
app.post('/admin/cache/clear-all', internalAuthMiddleware, (req: Request, res: Response) => {
  const umpResult = clearAllUMPCaches();
  clearResponseCache();
  clearVillageProfileCache();

  logger.info('All caches cleared via admin endpoint');

  res.json({
    status: 'success',
    message: 'All caches cleared',
    details: {
      umpCachesCleared: umpResult.cleared,
      umpCacheNames: umpResult.caches,
      responseCacheCleared: true,
      villageProfileCacheCleared: true,
    },
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /admin/cache/clear-user — Clear all in-memory caches for a specific user
 * Body: { userId: string }
 * Used when admin clears a conversation or webchat user resets session.
 */
app.post('/admin/cache/clear-user', internalAuthMiddleware, (req: Request, res: Response) => {
  const { userId } = req.body || {};
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }
  const result = clearUserCaches(userId);
  res.json({
    status: 'success',
    message: `Caches cleared for user ${userId}`,
    cleared: result.cleared,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /admin/cache/mode — Get current cache mode
 */
app.get('/admin/cache/mode', internalAuthMiddleware, (req: Request, res: Response) => {
  res.json({ cacheEnabled: _cacheEnabled });
});

/**
 * POST /admin/cache/mode — Toggle cache mode (dev/production)
 */
app.post('/admin/cache/mode', internalAuthMiddleware, (req: Request, res: Response) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled (boolean) is required' });
    return;
  }
  _cacheEnabled = enabled;
  logger.info(`Cache mode changed to: ${enabled ? 'ENABLED (production)' : 'DISABLED (dev)'}`);

  // If disabling cache, also clear existing caches
  if (!enabled) {
    clearAllUMPCaches();
    clearResponseCache();
    clearVillageProfileCache();
    logger.info('All caches cleared after switching to dev mode');
  }

  res.json({
    cacheEnabled: _cacheEnabled,
    message: enabled ? 'Cache enabled (production mode)' : 'Cache disabled (dev mode) — all caches cleared',
  });
});

app.get('/health/services', internalAuthMiddleware, async (req: Request, res: Response) => {
  try {
    // Check Channel Service
    const channelHealthy = await checkServiceHealth(
      `${config.channelServiceUrl}/health`
    );

    // Check Case Service
    const caseHealthy = await checkCaseServiceHealth();

    res.json({
      status: channelHealthy && caseHealthy ? 'ok' : 'degraded',
      services: {
        channelService: channelHealthy ? 'healthy' : 'unhealthy',
        caseService: caseHealthy ? 'healthy' : 'unhealthy',
      },
    });
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      error: error.message,
    });
  }
});

app.get('/stats/models', (req: Request, res: Response) => {
  try {
    const stats = modelStatsService.getAllStats();

    // Format for better readability
    const formattedStats = {
      summary: {
        totalRequests: stats.totalRequests,
        lastUpdated: stats.lastUpdated,
        totalModels: Object.keys(stats.models).length,
      },
      models: Object.values(stats.models).map(m => ({
        model: m.model,
        successRate: `${m.successRate}%`,
        totalCalls: m.totalCalls,
        successCalls: m.successCalls,
        failedCalls: m.failedCalls,
        avgResponseTimeMs: m.avgResponseTimeMs,
        lastUsed: m.lastUsed,
        lastError: m.lastError,
      })).sort((a, b) => {
        // Sort by success rate descending
        const rateA = parseInt(a.successRate);
        const rateB = parseInt(b.successRate);
        return rateB - rateA;
      }),
    };

    res.json(formattedStats);
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to get model stats',
    });
  }
});

app.get('/stats/models/:modelName', (req: Request, res: Response) => {
  try {
    const modelName = getParam(req, 'modelName');
    if (!modelName) {
      res.status(400).json({
        error: 'modelName is required',
      });
      return;
    }
    const stats = modelStatsService.getModelStats(modelName);

    if (!stats) {
      res.status(404).json({
        error: 'Model not found',
        model: modelName,
        message: 'No statistics recorded for this model yet',
      });
      return;
    }

    res.json(stats);
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to get model stats',
    });
  }
});

// ===========================================
// AI Analytics Endpoints
app.get('/stats/analytics', async (req: Request, res: Response) => {
  try {
    const summary = await aiAnalyticsService.getSummaryDurable({
      villageId: getQuery(req, 'village_id') || undefined,
      channel: getQuery(req, 'channel') || undefined,
    });
    res.json(summary);
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to get analytics',
    });
  }
});

app.get('/stats/analytics/intents', async (req: Request, res: Response) => {
  try {
    const distribution = await aiAnalyticsService.getIntentDistributionDurable({
      villageId: getQuery(req, 'village_id') || undefined,
      channel: getQuery(req, 'channel') || undefined,
    });
    res.json(distribution);
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to get intent distribution',
    });
  }
});

app.get('/stats/analytics/flow', async (req: Request, res: Response) => {
  try {
    const flow = await aiAnalyticsService.getConversationFlowDurable({
      villageId: getQuery(req, 'village_id') || undefined,
      channel: getQuery(req, 'channel') || undefined,
    });
    res.json(flow);
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to get conversation flow',
    });
  }
});

app.get('/stats/analytics/tokens', (req: Request, res: Response) => {
  try {
    const tokens = aiAnalyticsService.getTokenUsageBreakdown();
    res.json(tokens);
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to get token usage',
    });
  }
});

app.get('/stats/analytics/full', async (req: Request, res: Response) => {
  try {
    const filters = {
      villageId: getQuery(req, 'village_id') || undefined,
      channel: getQuery(req, 'channel') || undefined,
    };
    const [summary, intents, flow, knowledge, retrieval, memory, guardrails, toolPolicy] = await Promise.all([
      aiAnalyticsService.getSummaryDurable(filters),
      aiAnalyticsService.getIntentDistributionDurable(filters),
      aiAnalyticsService.getConversationFlowDurable(filters),
      aiAnalyticsService.getKnowledgeStatsDurable(filters),
      aiAnalyticsService.getRetrievalObservabilityDurable(filters),
      getMemoryObservabilityDurable(filters),
      getGuardrailObservabilityDurable(filters),
      getToolPolicyObservabilityDurable(filters),
    ]);

    res.json({
      summary,
      intents,
      flow,
      knowledge,
      retrieval,
      memory,
      guardrails,
      toolPolicy,
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to get full analytics',
    });
  }
});

app.get('/stats/analytics/categories', (req: Request, res: Response) => {
  try {
    const stats = aiAnalyticsService.getCategoryUsageStats();
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to get category usage stats',
    });
  }
});

app.post('/stats/analytics/reset', (req: Request, res: Response) => {
  try {
    aiAnalyticsService.resetAnalytics();
    res.json({ status: 'success', message: 'Analytics data has been reset' });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to reset analytics',
    });
  }
});

app.post('/stats/analytics/fix', (req: Request, res: Response) => {
  try {
    aiAnalyticsService.validateAndFixData();
    res.json({ status: 'success', message: 'Analytics data has been validated and fixed' });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to fix analytics',
    });
  }
});

// Knowledge analytics (hit/miss/gaps)
app.get('/stats/analytics/knowledge', async (req: Request, res: Response) => {
  try {
    const stats = await aiAnalyticsService.getKnowledgeStatsDurable({
      villageId: getQuery(req, 'village_id') || undefined,
      channel: getQuery(req, 'channel') || undefined,
    });
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get knowledge stats' });
  }
});

app.get('/stats/analytics/retrieval', async (req: Request, res: Response) => {
  try {
    const stats = await aiAnalyticsService.getRetrievalObservabilityDurable({
      villageId: getQuery(req, 'village_id') || undefined,
      channel: getQuery(req, 'channel') || undefined,
    });
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get retrieval observability' });
  }
});

app.get('/stats/analytics/memory', async (req: Request, res: Response) => {
  try {
    const stats = await getMemoryObservabilityDurable({
      villageId: getQuery(req, 'village_id') || undefined,
      channel: getQuery(req, 'channel') || undefined,
    });
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get memory observability' });
  }
});

app.get('/stats/analytics/guardrails', async (req: Request, res: Response) => {
  try {
    const stats = await getGuardrailObservabilityDurable({
      villageId: getQuery(req, 'village_id') || undefined,
      channel: getQuery(req, 'channel') || undefined,
    });
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get guardrail observability' });
  }
});

app.get('/stats/analytics/tool-policy', async (req: Request, res: Response) => {
  try {
    const stats = await getToolPolicyObservabilityDurable({
      villageId: getQuery(req, 'village_id') || undefined,
      channel: getQuery(req, 'channel') || undefined,
    });
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get tool policy observability' });
  }
});

app.get('/stats/analytics/export', async (req: Request, res: Response) => {
  try {
    const kind = (getQuery(req, 'kind') || 'all') as ObservabilityExportKind;
    const format = (getQuery(req, 'format') || 'json').toLowerCase();
    const payload = await exportObservabilityData(kind, {
      villageId: getQuery(req, 'village_id') || undefined,
      channel: getQuery(req, 'channel') || undefined,
      limit: Number(getQuery(req, 'limit') || 500),
    });

    if (format === 'ndjson') {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.send(toNdjson(payload));
      return;
    }

    res.json(payload);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to export observability analytics' });
  }
});

// ===========================================
// AI Token Usage Endpoints (generic LLM usage tracking)

// GET /stats/token-usage/summary — overview card data
app.get('/stats/token-usage/summary', async (req: Request, res: Response) => {
  try {
    const filters = {
      village_id: getQuery(req, 'village_id'),
      wa_user_id: getQuery(req, 'wa_user_id'),
      session_id: getQuery(req, 'session_id'),
      start: getQuery(req, 'start'),
      end: getQuery(req, 'end'),
    };
    const summary = await getTokenUsageSummary(filters);
    res.json(summary);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get token usage summary' });
  }
});

// GET /stats/token-usage/by-period?period=day|week|month
app.get('/stats/token-usage/by-period', async (req: Request, res: Response) => {
  try {
    const period = (getQuery(req, 'period') || 'day') as 'day' | 'week' | 'month';
    const filters = {
      village_id: getQuery(req, 'village_id'),
      model: getQuery(req, 'model'),
      wa_user_id: getQuery(req, 'wa_user_id'),
      session_id: getQuery(req, 'session_id'),
      start: getQuery(req, 'start'),
      end: getQuery(req, 'end'),
    };
    const data = await getUsageByPeriod(period, filters);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get usage by period' });
  }
});

// GET /stats/token-usage/by-period-layer?period=day|week|month (stacked chart)
app.get('/stats/token-usage/by-period-layer', async (req: Request, res: Response) => {
  try {
    const period = (getQuery(req, 'period') || 'day') as 'day' | 'week' | 'month';
    const filters = {
      village_id: getQuery(req, 'village_id'),
      wa_user_id: getQuery(req, 'wa_user_id'),
      session_id: getQuery(req, 'session_id'),
      start: getQuery(req, 'start'),
      end: getQuery(req, 'end'),
    };
    const data = await getUsageByPeriodAndLayer(period, filters);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get usage by period and layer' });
  }
});

// GET /stats/token-usage/by-model
app.get('/stats/token-usage/by-model', async (req: Request, res: Response) => {
  try {
    const filters = {
      village_id: getQuery(req, 'village_id'),
      wa_user_id: getQuery(req, 'wa_user_id'),
      session_id: getQuery(req, 'session_id'),
      start: getQuery(req, 'start'),
      end: getQuery(req, 'end'),
    };
    const data = await getUsageByModel(filters);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get usage by model' });
  }
});

// GET /stats/token-usage/by-provider
app.get('/stats/token-usage/by-provider', async (req: Request, res: Response) => {
  try {
    const filters = {
      village_id: getQuery(req, 'village_id'),
      wa_user_id: getQuery(req, 'wa_user_id'),
      session_id: getQuery(req, 'session_id'),
      start: getQuery(req, 'start'),
      end: getQuery(req, 'end'),
    };
    const data = await getUsageByProvider(filters);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get usage by provider' });
  }
});

// GET /stats/token-usage/by-village
app.get('/stats/token-usage/by-village', async (req: Request, res: Response) => {
  try {
    const filters = {
      model: getQuery(req, 'model'),
      start: getQuery(req, 'start'),
      end: getQuery(req, 'end'),
    };
    const data = await getUsageByVillage(filters);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get usage by village' });
  }
});

// GET /stats/token-usage/by-intent-family
app.get('/stats/token-usage/by-intent-family', async (req: Request, res: Response) => {
  try {
    const filters = {
      village_id: getQuery(req, 'village_id'),
      wa_user_id: getQuery(req, 'wa_user_id'),
      session_id: getQuery(req, 'session_id'),
      start: getQuery(req, 'start'),
      end: getQuery(req, 'end'),
    };
    const data = await getUsageByIntentFamily(filters);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get usage by intent family' });
  }
});

// GET /stats/token-usage/by-tenant-flow
app.get('/stats/token-usage/by-tenant-flow', async (req: Request, res: Response) => {
  try {
    const filters = {
      village_id: getQuery(req, 'village_id'),
      wa_user_id: getQuery(req, 'wa_user_id'),
      session_id: getQuery(req, 'session_id'),
      start: getQuery(req, 'start'),
      end: getQuery(req, 'end'),
    };
    const data = await getUsageByTenantFlow(filters);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get usage by tenant flow' });
  }
});

// GET /stats/token-usage/layer-breakdown — micro vs full NLU detail
app.get('/stats/token-usage/layer-breakdown', async (req: Request, res: Response) => {
  try {
    const filters = {
      village_id: getQuery(req, 'village_id'),
      wa_user_id: getQuery(req, 'wa_user_id'),
      session_id: getQuery(req, 'session_id'),
      start: getQuery(req, 'start'),
      end: getQuery(req, 'end'),
    };
    const data = await getLayerBreakdown(filters);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get layer breakdown' });
  }
});

// GET /stats/token-usage/avg-per-chat — average input/output per main_chat call
app.get('/stats/token-usage/avg-per-chat', async (req: Request, res: Response) => {
  try {
    const filters = {
      village_id: getQuery(req, 'village_id'),
      wa_user_id: getQuery(req, 'wa_user_id'),
      session_id: getQuery(req, 'session_id'),
      start: getQuery(req, 'start'),
      end: getQuery(req, 'end'),
    };
    const data = await getAvgTokensPerChat(filters);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get avg tokens per chat' });
  }
});

// GET /stats/token-usage/responses-by-village — AI response count per village (main_chat only)
app.get('/stats/token-usage/responses-by-village', async (req: Request, res: Response) => {
  try {
    const filters = {
      start: getQuery(req, 'start'),
      end: getQuery(req, 'end'),
    };
    const data = await getResponseCountByVillage(filters);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get response count by village' });
  }
});

// GET /stats/token-usage/village-model-detail — per village + model breakdown
app.get('/stats/token-usage/village-model-detail', async (req: Request, res: Response) => {
  try {
    const filters = {
      village_id: getQuery(req, 'village_id'),
      wa_user_id: getQuery(req, 'wa_user_id'),
      session_id: getQuery(req, 'session_id'),
      start: getQuery(req, 'start'),
      end: getQuery(req, 'end'),
    };
    const data = await getUsageByVillageAndModel(filters);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get village model detail' });
  }
});

// GET /stats/token-usage/by-source — gateway lane / source breakdown
app.get('/stats/token-usage/by-source', async (req: Request, res: Response) => {
  try {
    const slug = getQuery(req, 'village_id');
    const data = await getTokenUsageBySource(slug);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get token usage by source' });
  }
});

app.get('/admin/ai-usage/village/:villageId/users', async (req: Request, res: Response) => {
  try {
    const villageId = getParam(req, 'villageId');
    if (!villageId) {
      res.status(400).json({ error: 'villageId is required' });
      return;
    }

    const start = getQuery(req, 'start');
    const end = getQuery(req, 'end');
    const range: any = {};
    if (start) range.gte = new Date(start);
    if (end) range.lte = new Date(end);

    const users = await prisma.ai_message_billings.groupBy({
      by: ['wa_user_id', 'session_id'],
      where: {
        village_id: villageId,
        ...(Object.keys(range).length ? { created_at: range } : {}),
      },
      _count: { _all: true },
      _sum: {
        call_count: true,
        input_tokens: true,
        output_tokens: true,
        total_tokens: true,
        actual_cost_usd: true,
        adjusted_cost_usd: true,
        margin_usd: true,
      },
      orderBy: { _sum: { adjusted_cost_usd: 'desc' } },
    });

    res.json(users.map(row => ({
      wa_user_id: row.wa_user_id,
      session_id: row.session_id,
      message_count: row._count._all,
      call_count: row._sum.call_count ?? 0,
      input_tokens: row._sum.input_tokens ?? 0,
      output_tokens: row._sum.output_tokens ?? 0,
      total_tokens: row._sum.total_tokens ?? 0,
      actual_cost_usd: row._sum.actual_cost_usd ?? 0,
      adjusted_cost_usd: row._sum.adjusted_cost_usd ?? 0,
      margin_usd: row._sum.margin_usd ?? 0,
    })));
  } catch (error: any) {
    logger.error('Failed to get village AI usage users', { error: error.message });
    res.status(500).json({ error: 'Failed to get village AI usage users' });
  }
});

app.get('/admin/ai-usage/village/:villageId/messages', async (req: Request, res: Response) => {
  try {
    const villageId = getParam(req, 'villageId');
    if (!villageId) {
      res.status(400).json({ error: 'villageId is required' });
      return;
    }

    const limit = Math.min(Math.max(Number(getQuery(req, 'limit') || 50), 1), 200);
    const offset = Math.max(Number(getQuery(req, 'offset') || 0), 0);
    const start = getQuery(req, 'start');
    const end = getQuery(req, 'end');
    const dateFilter: any = {};
    if (start) dateFilter.gte = new Date(start);
    if (end) dateFilter.lte = new Date(end);

    const where = {
      village_id: villageId,
      ...(getQuery(req, 'wa_user_id') ? { wa_user_id: getQuery(req, 'wa_user_id') } : {}),
      ...(getQuery(req, 'session_id') ? { session_id: getQuery(req, 'session_id') } : {}),
      ...(Object.keys(dateFilter).length ? { created_at: dateFilter } : {}),
    };

    const [total, rows, totals] = await Promise.all([
      prisma.ai_message_billings.count({ where }),
      prisma.ai_message_billings.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: offset,
        take: limit,
        select: {
          id: true,
          message_id: true,
          trace_id: true,
          billing_group_id: true,
          channel: true,
          wa_user_id: true,
          session_id: true,
          input_tokens: true,
          output_tokens: true,
          total_tokens: true,
          call_count: true,
          actual_cost_usd: true,
          adjusted_cost_usd: true,
          margin_usd: true,
          status: true,
          ledger_entry_id: true,
          error_message: true,
          created_at: true,
          billed_at: true,
        },
      }),
      prisma.ai_message_billings.aggregate({
        where,
        _sum: { actual_cost_usd: true, adjusted_cost_usd: true, margin_usd: true, total_tokens: true, call_count: true },
        _count: { _all: true },
      }),
    ]);

    res.json({
      metric_scope: 'message_billing',
      metric_description: 'One row per finalized user message/turn. Wallet debits use adjusted_cost_usd from these rows.',
      total,
      limit,
      offset,
      totals: {
        messages: totals._count._all,
        actual_cost_usd: totals._sum.actual_cost_usd ?? 0,
        adjusted_cost_usd: totals._sum.adjusted_cost_usd ?? 0,
        margin_usd: totals._sum.margin_usd ?? 0,
        total_tokens: totals._sum.total_tokens ?? 0,
        call_count: totals._sum.call_count ?? 0,
      },
      data: rows,
    });
  } catch (error: any) {
    logger.error('Failed to get village AI usage messages', { error: error.message });
    res.status(500).json({ error: 'Failed to get village AI usage messages' });
  }
});

app.get('/admin/ai-usage/village/:villageId/messages/:billingId', async (req: Request, res: Response) => {
  try {
    const villageId = getParam(req, 'villageId');
    const billingId = getParam(req, 'billingId');
    if (!villageId || !billingId) {
      res.status(400).json({ error: 'villageId and billingId are required' });
      return;
    }

    const billing = await prisma.ai_message_billings.findFirst({
      where: { id: billingId, village_id: villageId },
    });
    if (!billing) {
      res.status(404).json({ error: 'Message billing not found' });
      return;
    }

    const [ledgerEntry, tokenUsageRows] = await Promise.all([
      billing.ledger_entry_id
        ? prisma.ai_wallet_ledger_entries.findUnique({ where: { id: billing.ledger_entry_id } })
        : Promise.resolve(null),
      prisma.ai_token_usage.findMany({
        where: { billing_group_id: billing.billing_group_id, village_id: villageId },
        orderBy: { created_at: 'asc' },
        select: {
          id: true,
          model: true,
          layer_type: true,
          call_type: true,
          input_tokens: true,
          output_tokens: true,
          total_tokens: true,
          actual_cost_usd: true,
          adjusted_cost_usd: true,
          margin_usd: true,
          billing_status: true,
          success: true,
          duration_ms: true,
          created_at: true,
        },
      }),
    ]);

    res.json({ billing, ledger_entry: ledgerEntry, token_usage: tokenUsageRows });
  } catch (error: any) {
    logger.error('Failed to get village AI usage message detail', { error: error.message });
    res.status(500).json({ error: 'Failed to get village AI usage message detail' });
  }
});

app.get('/admin/ai-usage/generations', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(Number(getQuery(req, 'limit') || 50), 1), 200);
    const offset = Math.max(Number(getQuery(req, 'offset') || 0), 0);
    const start = getQuery(req, 'start');
    const end = getQuery(req, 'end');
    const search = getQuery(req, 'search');
    const dateFilter: any = {};
    if (start) dateFilter.gte = new Date(start);
    if (end) dateFilter.lte = new Date(end);

    const commonWhere: any = {
      ...(getQuery(req, 'village_id') ? { village_id: getQuery(req, 'village_id') } : {}),
      ...(getQuery(req, 'provider_id') ? { provider_id: getQuery(req, 'provider_id') } : {}),
      ...(getQuery(req, 'lane_type') ? { lane_type: getQuery(req, 'lane_type') } : {}),
      ...(getQuery(req, 'layer_type') ? { layer_type: getQuery(req, 'layer_type') } : {}),
      ...(getQuery(req, 'call_type') ? { call_type: getQuery(req, 'call_type') } : {}),
      ...(getQuery(req, 'status') ? { status: getQuery(req, 'status') } : {}),
      ...(Object.keys(dateFilter).length ? { created_at: dateFilter } : {}),
    };
    const searchWhere = search ? {
      OR: [
        { trace_id: { contains: search, mode: 'insensitive' } },
        { message_id: { contains: search, mode: 'insensitive' } },
        { wa_user_id: { contains: search, mode: 'insensitive' } },
        { session_id: { contains: search, mode: 'insensitive' } },
      ],
    } : {};

    const generationWhere = { ...commonWhere, ...searchWhere };
    const usageWhereBase: any = { ...commonWhere, ...searchWhere };
    if (usageWhereBase.status) {
      usageWhereBase.success = usageWhereBase.status === 'success';
      delete usageWhereBase.status;
    }
    const usageWhere = usageWhereBase;
    const [generationTotal, generationRows, usageRows] = await Promise.all([
      (prisma as any).ai_generation_logs.count({ where: generationWhere }),
      (prisma as any).ai_generation_logs.findMany({
        where: generationWhere,
        orderBy: { created_at: 'desc' },
        take: limit + offset,
      }),
      prisma.ai_token_usage.findMany({
        where: usageWhere,
        orderBy: { created_at: 'desc' },
        take: limit + offset,
        select: {
          id: true,
          village_id: true,
          wa_user_id: true,
          session_id: true,
          channel: true,
          message_id: true,
          trace_id: true,
          billing_group_id: true,
          lane_type: true,
          layer_type: true,
          call_type: true,
          provider_id: true,
          model_config_id: true,
          key_source: true,
          key_tier: true,
          model: true,
          input_tokens: true,
          output_tokens: true,
          total_tokens: true,
          actual_cost_usd: true,
          adjusted_cost_usd: true,
          duration_ms: true,
          success: true,
          created_at: true,
        },
      }),
    ]);

    const loggedTokenIds = new Set(generationRows.map((row: any) => row.token_usage_id).filter(Boolean));
    const usageMap = new Map(usageRows.map((row) => [row.id, row]));
    const providerIds = Array.from(new Set([...generationRows, ...usageRows].map((row: any) => row.provider_id).filter(Boolean))) as string[];
    const modelIds = Array.from(new Set([...generationRows, ...usageRows].map((row: any) => row.model_config_id).filter(Boolean))) as string[];
    const [providers, models] = await Promise.all([
      providerIds.length ? prisma.ai_providers.findMany({ where: { id: { in: providerIds } }, select: { id: true, name: true, slug: true, provider_kind: true } }) : Promise.resolve([]),
      modelIds.length ? prisma.ai_models.findMany({ where: { id: { in: modelIds } }, select: { id: true, display_name: true, upstream_model_name: true, lane_type: true } }) : Promise.resolve([]),
    ]);
    const providerMap = new Map(providers.map((provider) => [provider.id, provider]));
    const modelMap = new Map(models.map((model) => [model.id, model]));

    const fallbackRows = usageRows.filter((row) => !loggedTokenIds.has(row.id));
    const rows = [
      ...generationRows.map((row: any) => {
        const usage = row.token_usage_id ? usageMap.get(row.token_usage_id) : null;
        const providerId = usage?.provider_id ?? row.provider_id;
        const modelConfigId = usage?.model_config_id ?? row.model_config_id;
        return {
          ...row,
          village_id: usage?.village_id ?? row.village_id,
          wa_user_id: usage?.wa_user_id ?? row.wa_user_id,
          session_id: usage?.session_id ?? row.session_id,
          channel: usage?.channel ?? row.channel,
          message_id: usage?.message_id ?? row.message_id,
          trace_id: usage?.trace_id ?? row.trace_id,
          billing_group_id: usage?.billing_group_id ?? row.billing_group_id,
          lane_type: usage?.lane_type ?? row.lane_type,
          layer_type: usage?.layer_type ?? row.layer_type,
          call_type: usage?.call_type ?? row.call_type,
          provider_id: providerId,
          model_config_id: modelConfigId,
          provider: usage?.key_tier ?? row.provider,
          model: usage?.model ?? row.model,
          gateway_source: usage?.key_source ?? row.gateway_source,
          input_tokens: usage?.input_tokens ?? row.input_tokens,
          output_tokens: usage?.output_tokens ?? row.output_tokens,
          total_tokens: usage?.total_tokens ?? row.total_tokens,
          actual_cost_usd: usage?.actual_cost_usd ?? row.actual_cost_usd,
          adjusted_cost_usd: usage?.adjusted_cost_usd ?? row.adjusted_cost_usd,
          duration_ms: usage?.duration_ms ?? row.duration_ms,
          status: usage ? (usage.success ? 'success' : 'failed') : row.status,
          has_raw_payload: Boolean(row.request_json || row.response_json || row.prompt_preview || row.completion_preview),
          provider_info: providerId ? providerMap.get(providerId) ?? null : null,
          model_info: modelConfigId ? modelMap.get(modelConfigId) ?? null : null,
        };
      }),
      ...fallbackRows.map((row) => ({
        id: `usage_${row.id}`,
        token_usage_id: row.id,
        village_id: row.village_id,
        wa_user_id: row.wa_user_id,
        session_id: row.session_id,
        channel: row.channel,
        message_id: row.message_id,
        trace_id: row.trace_id,
        billing_group_id: row.billing_group_id,
        lane_type: row.lane_type,
        layer_type: row.layer_type,
        call_type: row.call_type,
        provider_id: row.provider_id,
        model_config_id: row.model_config_id,
        provider: row.key_tier,
        model: row.model,
        gateway_source: row.key_source,
        response_id: null,
        finish_reason: null,
        streaming: false,
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        total_tokens: row.total_tokens,
        actual_cost_usd: row.actual_cost_usd,
        adjusted_cost_usd: row.adjusted_cost_usd,
        duration_ms: row.duration_ms,
        status: row.success ? 'success' : 'failed',
        error_message: null,
        created_at: row.created_at,
        has_raw_payload: false,
        provider_info: row.provider_id ? providerMap.get(row.provider_id) ?? null : null,
        model_info: row.model_config_id ? modelMap.get(row.model_config_id) ?? null : null,
      })),
    ].sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(offset, offset + limit);

    res.json({
      metric_scope: 'provider_call_audit',
      metric_description: 'One row per model/provider call. Use message billing endpoints for wallet debit totals.',
      total: generationTotal + fallbackRows.length,
      limit,
      offset,
      data: rows,
    });
  } catch (error: any) {
    logger.error('Failed to get AI generation logs', { error: error.message });
    res.status(500).json(errorResponse(error.message || 'Failed to get AI generation logs'));
  }
});

app.get('/admin/ai-usage/generations/:id', async (req: Request, res: Response) => {
  try {
    const id = getParam(req, 'id');
    if (!id) {
      res.status(400).json(errorResponse('Generation id is required'));
      return;
    }

    const usageId = id.startsWith('usage_') ? id.slice(6) : null;
    const log = usageId ? null : await (prisma as any).ai_generation_logs.findUnique({ where: { id } });
    const tokenUsageId = usageId || log?.token_usage_id;
    const tokenUsage = tokenUsageId ? await prisma.ai_token_usage.findUnique({ where: { id: tokenUsageId } }) : null;
    const billingGroupId = log?.billing_group_id || tokenUsage?.billing_group_id;
    const billing = billingGroupId ? await prisma.ai_message_billings.findUnique({ where: { billing_group_id: billingGroupId } }) : null;
    const [provider, model] = await Promise.all([
      (log?.provider_id || tokenUsage?.provider_id) ? prisma.ai_providers.findUnique({ where: { id: (log?.provider_id || tokenUsage?.provider_id) as string }, select: { id: true, name: true, slug: true, provider_kind: true, base_url: true } }) : Promise.resolve(null),
      (log?.model_config_id || tokenUsage?.model_config_id) ? prisma.ai_models.findUnique({ where: { id: (log?.model_config_id || tokenUsage?.model_config_id) as string }, select: { id: true, display_name: true, upstream_model_name: true, lane_type: true } }) : Promise.resolve(null),
    ]);

    if (!log && !tokenUsage) {
      res.status(404).json(errorResponse('Generation log not found'));
      return;
    }

    res.json(successResponse({
      log: log ? { ...log, has_raw_payload: Boolean(log.request_json || log.response_json || log.prompt_preview || log.completion_preview) } : null,
      token_usage: tokenUsage,
      billing,
      provider,
      model,
      has_raw_payload: Boolean(log?.request_json || log?.response_json || log?.prompt_preview || log?.completion_preview),
    }));
  } catch (error: any) {
    logger.error('Failed to get AI generation log detail', { error: error.message });
    res.status(500).json(errorResponse(error.message || 'Failed to get AI generation log detail'));
  }
});

// ===========================================
// Golden Set Evaluation Endpoints
app.get('/stats/golden-set', (req: Request, res: Response) => {
  try {
    const data = getGoldenSetSummary();
    res.json(data);
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to get golden set summary',
    });
  }
});

app.post('/stats/golden-set/run', async (req: Request, res: Response) => {
  try {
    const { items, village_id } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'items is required' });
      return;
    }

    const result = await runGoldenSetEvaluation(items, village_id);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to run golden set evaluation',
    });
  }
});

// ===========================================
// Rate Limiter Endpoints
app.get('/rate-limit', (req: Request, res: Response) => {
  try {
    const villageId = typeof req.query.village_id === 'string' ? req.query.village_id : undefined;
    const stats = rateLimiterService.getStats(villageId);
    res.json({
      config: {
        enabled: config.rateLimitEnabled,
        maxReportsPerDay: config.maxReportsPerDay,
        cooldownSeconds: config.cooldownSeconds,
        autoBlacklistViolations: config.autoBlacklistViolations,
      },
      stats,
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to get rate limit stats',
    });
  }
});

app.get('/rate-limit/check/:wa_user_id', (req: Request, res: Response) => {
  try {
    const wa_user_id = getParam(req, 'wa_user_id');
    const villageId = typeof req.query.village_id === 'string' ? req.query.village_id : undefined;
    if (!wa_user_id) {
      res.status(400).json({
        error: 'wa_user_id is required',
      });
      return;
    }
    const result = rateLimiterService.checkRateLimit(wa_user_id, villageId);
    const userInfo = rateLimiterService.getUserInfo(wa_user_id, villageId);

    res.json({
      ...result,
      user: userInfo,
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to check rate limit',
    });
  }
});

app.get('/rate-limit/blacklist', (req: Request, res: Response) => {
  try {
    const villageId = typeof req.query.village_id === 'string' ? req.query.village_id : undefined;
    const blacklist = rateLimiterService.getBlacklist(villageId);
    res.json({
      total: blacklist.length,
      entries: blacklist,
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to get blacklist',
    });
  }
});

app.post('/rate-limit/blacklist', (req: Request, res: Response) => {
  try {
    const { wa_user_id, reason, expiresInDays, village_id } = req.body;

    if (!wa_user_id || !reason) {
      res.status(400).json({
        error: 'wa_user_id and reason are required',
      });
      return;
    }

    rateLimiterService.addToBlacklist(wa_user_id, reason, 'admin', expiresInDays, undefined, village_id);

    res.json({
      success: true,
      message: `User ${wa_user_id} added to blacklist`,
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to add to blacklist',
    });
  }
});

app.delete('/rate-limit/blacklist/:wa_user_id', (req: Request, res: Response) => {
  try {
    const wa_user_id = getParam(req, 'wa_user_id');
    const villageId = typeof req.query.village_id === 'string' ? req.query.village_id : undefined;
    if (!wa_user_id) {
      res.status(400).json({
        error: 'wa_user_id is required',
      });
      return;
    }
    const removed = rateLimiterService.removeFromBlacklist(wa_user_id, villageId);

    if (removed) {
      res.json({
        success: true,
        message: `User ${wa_user_id} removed from blacklist`,
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'User not found in blacklist',
      });
    }
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to remove from blacklist',
    });
  }
});

// ===========================================
// Spam Guard Endpoints
app.get('/spam-guard/stats', (req: Request, res: Response) => {
  try {
    const stats = getAISpamGuardStats();
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get spam guard stats' });
  }
});

app.post('/rate-limit/reset/:wa_user_id', (req: Request, res: Response) => {
  try {
    const wa_user_id = getParam(req, 'wa_user_id');
    if (!wa_user_id) {
      res.status(400).json({
        error: 'wa_user_id is required',
      });
      return;
    }
    const villageId = typeof req.query.village_id === 'string' ? req.query.village_id : undefined;
    const reset = rateLimiterService.resetUserViolations(wa_user_id, villageId);

    if (reset) {
      res.json({
        success: true,
        message: `Violations reset for user ${wa_user_id}`,
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to reset violations',
    });
  }
});

// ===========================================
// Embedding & RAG Endpoints
// ===========================================

// Legacy local document serving for backward compatibility with older records.
// SEC-05 fix: require internal auth for uploaded documents
import path from 'path';
const uploadsDir = path.join(process.cwd(), 'uploads', 'documents');
app.use('/uploads/documents', internalAuthMiddleware, express.static(uploadsDir, {
  setHeaders: (res, filePath) => {
    // Set appropriate content-type based on file extension
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.pdf') {
      res.setHeader('Content-Type', 'application/pdf');
    } else if (ext === '.docx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    } else if (ext === '.doc') {
      res.setHeader('Content-Type', 'application/msword');
    } else if (ext === '.pptx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    } else if (ext === '.ppt') {
      res.setHeader('Content-Type', 'application/vnd.ms-powerpoint');
    } else if (ext === '.txt' || ext === '.md') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    } else if (ext === '.csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    }
    // Allow inline viewing for PDFs
    res.setHeader('Content-Disposition', 'inline');
  }
}));

// Mount API routes
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/webchat', webchatRoutes);
app.use('/api/status', internalAuthMiddleware, statusRoutes);
app.use('/api/testing', testingRoutes);

/**
 * Internal NLU endpoint for other services that must reuse gateway-only
 * complaint type resolution without implementing their own provider clients.
 */
app.post('/admin/nlu/complaint-type-match', async (req: Request, res: Response) => {
  try {
    const { kategori, availableTypes, context } = req.body || {};

    if (typeof kategori !== 'string' || !kategori.trim()) {
      res.status(400).json({ error: 'kategori is required' });
      return;
    }

    if (!Array.isArray(availableTypes) || availableTypes.length === 0) {
      res.status(400).json({ error: 'availableTypes is required' });
      return;
    }

    const sanitizedTypes = availableTypes
      .filter((item: any) => item && typeof item.id === 'string' && typeof item.name === 'string')
      .map((item: any) => ({
        id: item.id,
        name: item.name,
        categoryName: typeof item.categoryName === 'string'
          ? item.categoryName
          : typeof item.category_name === 'string'
            ? item.category_name
            : '',
      }));

    if (sanitizedTypes.length === 0) {
      res.status(400).json({ error: 'availableTypes contains no valid entries' });
      return;
    }

    const result = await matchComplaintType(
      kategori,
      sanitizedTypes,
      context && typeof context === 'object' ? context : undefined,
    );

    res.json(result || {
      matched_id: null,
      confidence: 0,
      reason: 'no_match',
    });
  } catch (error: any) {
    logger.error('Complaint type match endpoint failed', { error: error.message });
    res.status(500).json({ error: 'Failed to resolve complaint type' });
  }
});

/**
 * Internal endpoint for cross-service token usage recording.
 * Used by other services that make their own AI gateway calls
 * but don't have direct access to the ai_token_usage table.
 */
app.post('/admin/record-token-usage', async (req: Request, res: Response) => {
  try {
    const { model, input_tokens, output_tokens, total_tokens, layer_type, call_type, village_id, wa_user_id, session_id, channel, intent, success, duration_ms, key_source, key_id, key_tier } = req.body;
    if (!model || typeof input_tokens !== 'number' || typeof output_tokens !== 'number') {
      res.status(400).json({ error: 'Missing required fields: model, input_tokens, output_tokens' });
      return;
    }
    await recordTokenUsage({
      model,
      input_tokens,
      output_tokens,
      total_tokens: total_tokens ?? (input_tokens + output_tokens),
      layer_type: layer_type || 'micro_nlu',
      call_type: call_type || 'complaint_type_match',
      village_id, wa_user_id, session_id, channel, intent,
      success: success ?? true,
      duration_ms: duration_ms ?? null,
      key_source, key_id, key_tier,
    });
    res.json({ ok: true });
  } catch (error: any) {
    logger.error('Failed to record external token usage', { error: error.message });
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * DELETE /admin/reset-token-usage
 * Truncates the ai_token_usage table. Used by superadmin to clear all AI usage data.
 */
app.delete('/admin/reset-token-usage', async (req: Request, res: Response) => {
  try {
    await resetAllTokenUsage();
    res.json({ ok: true, message: 'All token usage data has been reset' });
  } catch (error: any) {
    logger.error('Failed to reset token usage', { error: error.message });
    res.status(500).json({ error: 'Failed to reset token usage data' });
  }
});

app.get('/admin/ai-billing/trace/:traceId', async (req: Request, res: Response) => {
  try {
    const traceId = getParam(req, 'traceId');
    if (!traceId) {
      res.status(400).json(errorResponse('traceId is required'));
      return;
    }

    const [billings, tokenUsage, retrieval, memory, guardrails, toolPolicy] = await Promise.all([
      prisma.ai_message_billings.findMany({
        where: { trace_id: traceId },
        orderBy: { created_at: 'desc' },
      }),
      prisma.ai_token_usage.findMany({
        where: { trace_id: traceId },
        orderBy: { created_at: 'asc' },
      }),
      prisma.ai_retrieval_traces.findMany({
        where: { trace_id: traceId },
        orderBy: { created_at: 'asc' },
      }),
      prisma.ai_memory_traces.findMany({
        where: { trace_id: traceId },
        orderBy: { created_at: 'asc' },
      }),
      prisma.ai_guardrail_events.findMany({
        where: { trace_id: traceId },
        orderBy: { created_at: 'asc' },
      }),
      prisma.ai_tool_policy_events.findMany({
        where: { trace_id: traceId },
        orderBy: { created_at: 'asc' },
      }),
    ]);

    res.json(successResponse({ trace_id: traceId, billings, token_usage: tokenUsage, retrieval, memory, guardrails, tool_policy: toolPolicy }));
  } catch (error: any) {
    logger.error('Failed to load AI trace', { error: error.message });
    res.status(500).json(errorResponse(error.message || 'Failed to load AI trace'));
  }
});

app.get('/admin/ai-billing/reconciliation/:billingId', async (req: Request, res: Response) => {
  try {
    const billingId = getParam(req, 'billingId');
    if (!billingId) {
      res.status(400).json(errorResponse('billingId is required'));
      return;
    }

    const billing = await prisma.ai_message_billings.findUnique({
      where: { id: billingId },
    });

    if (!billing) {
      res.status(404).json(errorResponse('Message billing not found'));
      return;
    }

    const [ledgerEntry, tokenUsageRows] = await Promise.all([
      billing.ledger_entry_id
        ? prisma.ai_wallet_ledger_entries.findUnique({ where: { id: billing.ledger_entry_id } })
        : Promise.resolve(null),
      prisma.ai_token_usage.findMany({
        where: { billing_group_id: billing.billing_group_id },
        orderBy: { created_at: 'asc' },
        select: {
          id: true,
          model: true,
          layer_type: true,
          call_type: true,
          input_tokens: true,
          output_tokens: true,
          total_tokens: true,
          actual_cost_usd: true,
          adjusted_cost_usd: true,
          margin_usd: true,
          billing_status: true,
          success: true,
          duration_ms: true,
          created_at: true,
        },
      }),
    ]);

    res.json(successResponse({ billing, ledger_entry: ledgerEntry, token_usage: tokenUsageRows }));
  } catch (error: any) {
    logger.error('Failed to load AI billing detail', { error: error.message });
    res.status(500).json(errorResponse(error.message || 'Failed to load AI billing detail'));
  }
});

app.get('/admin/ai-billing/reconciliation', async (req: Request, res: Response) => {
  try {
    const villageId = getQuery(req, 'village_id') || undefined;
    const from = getQuery(req, 'from');
    const to = getQuery(req, 'to');
    const staleMinutes = Math.max(Number(getQuery(req, 'stale_minutes') || 10), 1);
    const staleBefore = new Date(Date.now() - staleMinutes * 60_000);
    const dateFilter: any = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) dateFilter.lte = new Date(to);
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    const billingWhere = {
      ...(villageId ? { village_id: villageId } : {}),
      ...(hasDateFilter ? { created_at: dateFilter } : {}),
    };
    const ledgerWhere = {
      ...(villageId ? { village_id: villageId } : {}),
      entry_type: 'usage_debit',
      reference_type: 'ai_message_billing',
      ...(hasDateFilter ? { created_at: dateFilter } : {}),
    };
    const usageWhere = {
      ...(villageId ? { village_id: villageId } : {}),
      billing_group_id: { not: null },
      success: true,
      ...(hasDateFilter ? { created_at: dateFilter } : {}),
    };

    const [billings, tokenUsage, ledger, unbilledUsage, staleUnbilledUsage, missingBillingGroupUsage, failedBillings, pendingBillings, billedWithoutLedger, billingIds, duplicateBillingGroups] = await Promise.all([
      prisma.ai_message_billings.aggregate({
        where: billingWhere,
        _sum: { adjusted_cost_usd: true, actual_cost_usd: true, margin_usd: true },
        _count: { _all: true },
      }),
      prisma.ai_token_usage.aggregate({
        where: usageWhere,
        _sum: { adjusted_cost_usd: true, actual_cost_usd: true, margin_usd: true },
        _count: { _all: true },
      }),
      prisma.ai_wallet_ledger_entries.aggregate({
        where: ledgerWhere,
        _sum: { amount_usd: true, adjusted_cost_usd: true, actual_cost_usd: true, margin_usd: true },
        _count: { _all: true },
      }),
      prisma.ai_token_usage.count({ where: { ...usageWhere, billing_status: 'unbilled' } }),
      prisma.ai_token_usage.count({ where: { ...usageWhere, billing_status: 'unbilled', created_at: { lt: staleBefore } } }),
      prisma.ai_token_usage.count({
        where: {
          ...(villageId ? { village_id: villageId } : {}),
          success: true,
          billing_group_id: null,
          billing_status: { not: 'not_billable' },
          ...(hasDateFilter ? { created_at: dateFilter } : {}),
        },
      }),
      prisma.ai_message_billings.count({ where: { ...billingWhere, status: { in: ['failed', 'failed_insufficient_balance'] } } }),
      prisma.ai_message_billings.count({ where: { ...billingWhere, status: 'pending' } }),
      prisma.ai_message_billings.count({ where: { ...billingWhere, status: 'billed', ledger_entry_id: null } }),
      prisma.ai_message_billings.findMany({ where: billingWhere, select: { id: true } }),
      prisma.ai_message_billings.groupBy({
        by: ['billing_group_id'],
        where: billingWhere,
        _count: { _all: true },
        having: { billing_group_id: { _count: { gt: 1 } } },
      }),
    ]);

    const billingIdList = billingIds.map(row => row.id);
    const [ledgerWithoutBilling, recentBillings] = await Promise.all([
      prisma.ai_wallet_ledger_entries.count({
        where: {
          ...ledgerWhere,
          OR: [
            { reference_id: null },
            ...(billingIdList.length > 0 ? [{ reference_id: { notIn: billingIdList } }] : []),
          ],
        },
      }),
      prisma.ai_message_billings.findMany({
        where: billingWhere,
        orderBy: { created_at: 'desc' },
        take: 25,
        select: {
          id: true,
          village_id: true,
          message_id: true,
          trace_id: true,
          billing_group_id: true,
          status: true,
          ledger_entry_id: true,
          call_count: true,
          adjusted_cost_usd: true,
          actual_cost_usd: true,
          margin_usd: true,
          error_message: true,
          created_at: true,
          billed_at: true,
        },
      }),
    ]);


    const tokenAdjusted = Number((tokenUsage._sum.adjusted_cost_usd ?? 0).toFixed(8));
    const billingAdjusted = Number((billings._sum.adjusted_cost_usd ?? 0).toFixed(8));
    const ledgerAdjusted = Number((ledger._sum.adjusted_cost_usd ?? 0).toFixed(8));
    const ledgerDebitAmount = Number((-(ledger._sum.amount_usd ?? 0)).toFixed(8));
    const mismatches = {
      token_vs_billing_usd: Number((tokenAdjusted - billingAdjusted).toFixed(8)),
      billing_vs_ledger_adjusted_usd: Number((billingAdjusted - ledgerAdjusted).toFixed(8)),
      billing_vs_ledger_amount_usd: Number((billingAdjusted - ledgerDebitAmount).toFixed(8)),
    };

    res.json(successResponse({
      filters: { village_id: villageId ?? null, from: from ?? null, to: to ?? null, stale_minutes: staleMinutes },
      counts: {
        token_usage_rows: tokenUsage._count._all,
        message_billings: billings._count._all,
        ledger_usage_debits: ledger._count._all,
        unbilled_usage: unbilledUsage,
        stale_unbilled_usage: staleUnbilledUsage,
        missing_billing_group_usage: missingBillingGroupUsage,
        failed_billings: failedBillings,
        pending_billings: pendingBillings,
        duplicate_billing_groups: duplicateBillingGroups.length,
        billed_without_ledger: billedWithoutLedger,
        ledger_without_billing: ledgerWithoutBilling,
      },
      totals: {
        token_usage_adjusted_usd: tokenAdjusted,
        token_usage_actual_usd: Number((tokenUsage._sum.actual_cost_usd ?? 0).toFixed(8)),
        token_usage_margin_usd: Number((tokenUsage._sum.margin_usd ?? 0).toFixed(8)),
        message_billing_adjusted_usd: billingAdjusted,
        message_billing_actual_usd: Number((billings._sum.actual_cost_usd ?? 0).toFixed(8)),
        message_billing_margin_usd: Number((billings._sum.margin_usd ?? 0).toFixed(8)),
        ledger_adjusted_usd: ledgerAdjusted,
        ledger_debit_amount_usd: ledgerDebitAmount,
      },
      mismatches,
      recent_billings: recentBillings,
      duplicate_billing_groups: duplicateBillingGroups.map(row => ({
        billing_group_id: row.billing_group_id,
        count: row._count._all,
      })),
      healthy: unbilledUsage === 0
        && staleUnbilledUsage === 0
        && missingBillingGroupUsage === 0
        && failedBillings === 0
        && pendingBillings === 0
        && duplicateBillingGroups.length === 0
        && billedWithoutLedger === 0
        && ledgerWithoutBilling === 0
        && Object.values(mismatches).every(value => Math.abs(value) < 0.000001),
    }));
  } catch (error: any) {
    logger.error('Failed to reconcile AI billing', { error: error.message });
    res.status(500).json(errorResponse(error.message || 'Failed to reconcile AI billing'));
  }
});


app.get('/admin/ai-wallet/:villageId', async (req: Request, res: Response) => {
  try {
    const villageId = getParam(req, 'villageId');
    if (!villageId) {
      res.status(400).json({ error: 'villageId is required' });
      return;
    }

    const summary = await getWalletSummary(villageId);
    res.json({ success: true, data: summary });
  } catch (error: any) {
    logger.error('Failed to get AI wallet summary', { error: error.message });
    res.status(500).json({ error: 'Failed to get AI wallet summary' });
  }
});

app.get('/admin/ai-wallet/:villageId/ledger', async (req: Request, res: Response) => {
  try {
    const villageId = getParam(req, 'villageId');
    if (!villageId) {
      res.status(400).json({ error: 'villageId is required' });
      return;
    }

    const limit = Number(getQuery(req, 'limit') || 50);
    const ledger = await getWalletLedger(villageId, Number.isFinite(limit) ? limit : 50);
    res.json({ success: true, data: ledger });
  } catch (error: any) {
    logger.error('Failed to get AI wallet ledger', { error: error.message });
    res.status(500).json({ error: 'Failed to get AI wallet ledger' });
  }
});

app.get('/admin/ai-wallets', async (_req: Request, res: Response) => {
  try {
    const wallets = await listVillageWallets();
    res.json({ success: true, data: wallets });
  } catch (error: any) {
    logger.error('Failed to list AI wallets', { error: error.message });
    res.status(500).json({ error: 'Failed to list AI wallets' });
  }
});

app.get('/admin/ai-wallet/:villageId/can-process', async (req: Request, res: Response) => {
  try {
    const villageId = getParam(req, 'villageId');
    if (!villageId) {
      res.status(400).json({ error: 'villageId is required' });
      return;
    }

    const result = await canProcessVillageAI(villageId);
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('Failed to check AI wallet processability', { error: error.message });
    res.status(500).json({ error: 'Failed to check AI wallet processability' });
  }
});

app.post('/admin/ai-wallet/:villageId/topup', async (req: Request, res: Response) => {
  try {
    const villageId = getParam(req, 'villageId');
    const { amount_usd, entry_type, reference_type, reference_id, metadata, created_by_admin_id } = req.body || {};
    if (!villageId) {
      res.status(400).json({ error: 'villageId is required' });
      return;
    }

    const result = await topupVillageWallet({
      villageId,
      amountUsd: Number(amount_usd),
      entryType: entry_type,
      referenceType: reference_type,
      referenceId: reference_id,
      metadata,
      createdByAdminId: created_by_admin_id,
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('Failed to topup AI wallet', { error: error.message });
    res.status(400).json({ error: error.message || 'Failed to topup AI wallet' });
  }
});

app.post('/admin/ai-wallet/:villageId/adjust', async (req: Request, res: Response) => {
  try {
    const villageId = getParam(req, 'villageId');
    const { amount_usd, direction, reason, status_text, reference_type, reference_id, metadata, created_by_admin_id } = req.body || {};
    if (!villageId) {
      res.status(400).json({ error: 'villageId is required' });
      return;
    }

    const result = await adjustVillageWallet({
      villageId,
      amountUsd: Number(amount_usd),
      direction,
      reason: reason || status_text || null,
      referenceType: reference_type,
      referenceId: reference_id,
      metadata,
      createdByAdminId: created_by_admin_id,
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('Failed to adjust AI wallet', { error: error.message });
    res.status(400).json({ error: error.message || 'Failed to adjust AI wallet' });
  }
});

app.get('/admin/ai-vouchers', async (_req: Request, res: Response) => {
  try {
    const vouchers = await listTopupVouchers();
    res.json({ success: true, data: vouchers });
  } catch (error: any) {
    logger.error('Failed to list AI vouchers', { error: error.message });
    res.status(500).json({ error: 'Failed to list AI vouchers' });
  }
});

app.post('/admin/ai-vouchers', async (req: Request, res: Response) => {
  try {
    const { code, amount_usd, expires_at, metadata, created_by_admin_id } = req.body || {};
    const voucher = await createTopupVoucher({
      code,
      amountUsd: Number(amount_usd),
      expiresAt: expires_at ? new Date(expires_at) : null,
      metadata,
      createdByAdminId: created_by_admin_id,
    });
    res.json({ success: true, data: voucher });
  } catch (error: any) {
    logger.error('Failed to create AI voucher', { error: error.message });
    res.status(400).json({ error: error.message || 'Failed to create AI voucher' });
  }
});

app.post('/admin/ai-wallet/:villageId/redeem-voucher', async (req: Request, res: Response) => {
  try {
    const villageId = getParam(req, 'villageId');
    const { code, admin_id } = req.body || {};
    if (!villageId) {
      res.status(400).json({ error: 'villageId is required' });
      return;
    }

    const result = await redeemTopupVoucher({
      villageId,
      code,
      adminId: admin_id ?? null,
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('Failed to redeem AI voucher', { error: error.message });
    res.status(400).json({ error: error.message || 'Failed to redeem AI voucher' });
  }
});

const aiProviderCreateSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  provider_kind: z.string().min(1).optional(),
  base_url: z.string().min(1),
  api_key: z.string().min(1),
  default_headers_json: z.unknown().optional(),
  is_active: z.boolean().optional(),
  priority: z.number().int().optional(),
});

const aiProviderUpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  provider_kind: z.string().min(1).optional(),
  base_url: z.string().min(1).optional(),
  api_key: z.string().min(1).optional(),
  default_headers_json: z.unknown().optional(),
  is_active: z.boolean().optional(),
  priority: z.number().int().optional(),
});

const nullableNumber = z.number().nullable();
const aiModelCreateSchema = z.object({
  provider_id: z.string().min(1),
  lane_type: z.enum(['llm', 'embed', 'rewrite', 'rerank']),
  display_name: z.string().min(1),
  upstream_model_name: z.string().min(1),
  endpoint_path: z.string().nullable().optional(),
  actual_pricing_type: z.string().min(1).optional(),
  actual_fixed_price_usd: nullableNumber.optional(),
  actual_input_price_per_million_usd: nullableNumber.optional(),
  actual_output_price_per_million_usd: nullableNumber.optional(),
  adjusted_pricing_type: z.string().min(1).optional(),
  adjusted_fixed_price_usd: nullableNumber.optional(),
  adjusted_input_price_per_million_usd: nullableNumber.optional(),
  adjusted_output_price_per_million_usd: nullableNumber.optional(),
  is_active: z.boolean().optional(),
  is_publicly_selectable: z.boolean().optional(),
  supports_vision: z.boolean().optional(),
  supports_audio: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  priority: z.number().int().optional(),
});

const aiModelUpdateSchema = z.object({
  id: z.string().min(1),
  provider_id: z.string().min(1).optional(),
  lane_type: z.enum(['llm', 'embed', 'rewrite', 'rerank']).optional(),
  display_name: z.string().min(1).optional(),
  upstream_model_name: z.string().min(1).optional(),
  endpoint_path: z.string().nullable().optional(),
  actual_pricing_type: z.string().min(1).optional(),
  actual_fixed_price_usd: nullableNumber.optional(),
  actual_input_price_per_million_usd: nullableNumber.optional(),
  actual_output_price_per_million_usd: nullableNumber.optional(),
  adjusted_pricing_type: z.string().min(1).optional(),
  adjusted_fixed_price_usd: nullableNumber.optional(),
  adjusted_input_price_per_million_usd: nullableNumber.optional(),
  adjusted_output_price_per_million_usd: nullableNumber.optional(),
  is_active: z.boolean().optional(),
  is_publicly_selectable: z.boolean().optional(),
  supports_vision: z.boolean().optional(),
  supports_audio: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  priority: z.number().int().optional(),
});

const aiLaneAssignmentSchema = z.object({
  lane_type: z.enum(['llm', 'embed', 'rewrite', 'rerank']),
  primary_model_id: z.string().min(1),
  fallback_model_id: z.string().min(1).nullable().optional(),
  village_id: z.string().min(1).nullable().optional(),
  is_global_default: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

app.get('/admin/ai-providers', async (_req: Request, res: Response) => {
  try {
    const providers = await listAIProviders();
    res.json(successResponse(providers));
  } catch (error: any) {
    logger.error('Failed to list AI providers', { error: error.message });
    res.status(500).json(errorResponse('Failed to list AI providers'));
  }
});

app.post('/admin/ai-providers', async (req: Request, res: Response) => {
  try {
    const provider = await createAIProvider(aiProviderCreateSchema.parse(req.body || {}));
    res.json(successResponse(provider));
  } catch (error: any) {
    logger.error('Failed to create AI provider', { error: error.message });
    res.status(400).json(errorResponse(error.message || 'Failed to create AI provider'));
  }
});

app.put('/admin/ai-providers/:id', async (req: Request, res: Response) => {
  try {
    const provider = await updateAIProvider(aiProviderUpdateSchema.parse({
      ...(req.body || {}),
      id: getParam(req, 'id'),
    }));
    res.json(successResponse(provider));
  } catch (error: any) {
    logger.error('Failed to update AI provider', { error: error.message });
    res.status(400).json(errorResponse(error.message || 'Failed to update AI provider'));
  }
});

app.delete('/admin/ai-providers/:id', async (req: Request, res: Response) => {
  try {
    const id = getParam(req, 'id');
    if (!id) throw new Error('Provider id is required');

    const result = await deleteAIProvider(id);
    res.json(successResponse(result));
  } catch (error: any) {
    logger.error('Failed to delete AI provider', { error: error.message });
    res.status(400).json(errorResponse(error.message || 'Failed to delete AI provider'));
  }
});

app.get('/admin/ai-models', async (_req: Request, res: Response) => {
  try {
    const models = await listAIModels();
    res.json(successResponse(models));
  } catch (error: any) {
    logger.error('Failed to list AI models', { error: error.message });
    res.status(500).json(errorResponse('Failed to list AI models'));
  }
});

app.post('/admin/ai-models', async (req: Request, res: Response) => {
  try {
    const model = await createAIModel(aiModelCreateSchema.parse(req.body || {}));
    res.json(successResponse(model));
  } catch (error: any) {
    logger.error('Failed to create AI model', { error: error.message });
    res.status(400).json(errorResponse(error.message || 'Failed to create AI model'));
  }
});

app.put('/admin/ai-models/:id', async (req: Request, res: Response) => {
  try {
    const model = await updateAIModel(aiModelUpdateSchema.parse({
      ...(req.body || {}),
      id: getParam(req, 'id'),
    }));
    res.json(successResponse(model));
  } catch (error: any) {
    logger.error('Failed to update AI model', { error: error.message });
    res.status(400).json(errorResponse(error.message || 'Failed to update AI model'));
  }
});

app.delete('/admin/ai-models/:id', async (req: Request, res: Response) => {
  try {
    const id = getParam(req, 'id');
    if (!id) throw new Error('Model id is required');

    const result = await deleteAIModel(id);
    res.json(successResponse(result));
  } catch (error: any) {
    logger.error('Failed to delete AI model', { error: error.message });
    res.status(400).json(errorResponse(error.message || 'Failed to delete AI model'));
  }
});

app.get('/admin/ai-lane-assignments', async (_req: Request, res: Response) => {
  try {
    const assignments = await listAILaneAssignments();
    res.json(successResponse(assignments));
  } catch (error: any) {
    logger.error('Failed to list AI lane assignments', { error: error.message });
    res.status(500).json(errorResponse('Failed to list AI lane assignments'));
  }
});

app.post('/admin/ai-lane-assignments', async (req: Request, res: Response) => {
  try {
    const assignment = await upsertAILaneAssignment(aiLaneAssignmentSchema.parse(req.body || {}));
    res.json(successResponse(assignment));
  } catch (error: any) {
    logger.error('Failed to upsert AI lane assignment', { error: error.message });
    res.status(400).json(errorResponse(error.message || 'Failed to upsert AI lane assignment'));
  }
});

app.post('/admin/ai-lane-assignments/activate', async (req: Request, res: Response) => {
  try {
    const assignment = await upsertAILaneAssignment({ ...aiLaneAssignmentSchema.parse(req.body || {}), is_active: true });
    res.json(successResponse(assignment));
  } catch (error: any) {
    logger.error('Failed to activate AI lane assignment', { error: error.message });
    res.status(400).json(errorResponse(error.message || 'Failed to activate AI lane assignment'));
  }
});

app.post('/admin/ai-lane-assignments/deactivate', async (req: Request, res: Response) => {
  try {
    const assignment = await upsertAILaneAssignment({ ...aiLaneAssignmentSchema.parse(req.body || {}), is_active: false });
    res.json(successResponse(assignment));
  } catch (error: any) {
    logger.error('Failed to deactivate AI lane assignment', { error: error.message });
    res.status(400).json(errorResponse(error.message || 'Failed to deactivate AI lane assignment'));
  }
});

app.post('/admin/ai-wallet/:villageId/retry-pending', async (req: Request, res: Response) => {
  try {
    const villageId = getParam(req, 'villageId');
    if (!villageId) {
      res.status(400).json({ error: 'villageId is required' });
      return;
    }

    const pendingBillings = await prisma.ai_message_billings.findMany({
      where: {
        village_id: villageId,
        status: { in: ['pending', 'failed', 'failed_insufficient_balance', 'skipped_zero_cost'] },
      },
      orderBy: { created_at: 'asc' },
      take: Math.min(Math.max(Number(req.body?.limit) || 50, 1), 200),
    });

    const results = [];
    for (const billing of pendingBillings) {
      try {
        const updated = await finalizeAiBillingTurn({
          village_id: billing.village_id,
          message_id: billing.message_id,
          trace_id: billing.trace_id,
          billing_group_id: billing.billing_group_id,
          batched_message_ids: billing.batched_message_ids,
          wa_user_id: billing.wa_user_id,
          session_id: billing.session_id,
          channel: billing.channel,
        });
        results.push({ id: billing.id, status: updated?.status ?? billing.status });
      } catch (error: any) {
        results.push({ id: billing.id, status: 'failed', error: error?.message || 'Retry failed' });
      }
    }

    res.json(successResponse({
      village_id: villageId,
      attempted: pendingBillings.length,
      results,
    }));
  } catch (error: any) {
    logger.error('Failed to trigger AI pending retry', { error: error.message });
    res.status(400).json({ error: error.message || 'Failed to trigger AI pending retry' });
  }
});

app.get('/healthz', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.get('/stats/embeddings', async (req: Request, res: Response) => {
  try {
    const embeddingStats = getEmbeddingStats();
    const embeddingCacheStats = getEmbeddingCacheStats();
    const vectorDbStats = await getVectorDbStats();

    res.json({
      embedding: embeddingStats,
      embeddingCache: embeddingCacheStats,
      vectorDb: vectorDbStats,
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to get embedding stats',
    });
  }
});

// ===========================================
// AI Optimization Stats Endpoints
// ===========================================
app.get('/stats/optimization', (req: Request, res: Response) => {
  try {
    const cacheStats = getCacheStats();
    const topQueries = getTopCachedQueries(10);
    const fsmStats = getFSMStats();

    res.json({
      cache: {
        ...cacheStats,
        hitRatePercent: `${(cacheStats.hitRate * 100).toFixed(1)}%`,
      },
      topCachedQueries: topQueries,
      conversationFSM: fsmStats,
      architecture: '2-Layer LLM (forced)',
      description: 'AI stats (full LLM mode, without fast intent/template/cache)',
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to get optimization stats',
    });
  }
});

// Conversation FSM Stats
app.get('/stats/conversation-fsm', (req: Request, res: Response) => {
  try {
    const stats = getFSMStats();
    const activeContexts = getAllActiveContexts();

    res.json({
      stats,
      activeContexts: activeContexts.map(ctx => ({
        userId: ctx.userId.substring(0, 8) + '...', // Mask user ID
        state: ctx.state,
        messageCount: ctx.messageCount,
        lastIntent: ctx.lastIntent,
        missingFields: ctx.missingFields,
        createdAt: new Date(ctx.createdAt).toISOString(),
        updatedAt: new Date(ctx.updatedAt).toISOString(),
      })),
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to get FSM stats',
    });
  }
});

// ===========================================
// Architecture Dashboard - Comprehensive Stats
// ===========================================
app.get('/stats/dashboard', async (req: Request, res: Response) => {
  try {
    const cacheStats = getCacheStats();
    const fsmStats = getFSMStats();
    const modelStats = modelStatsService.getAllStats();
    const analyticsData = await aiAnalyticsService.getSummaryDurable();

    const architecture = 'NLU Processor (Micro NLU + Full NLU)';

    res.json({
      architecture: {
        current: architecture,
        description: 'Micro NLU for intent detection, Full NLU for response generation',
        appliesTo: ['WhatsApp', 'Webchat'],
      },
      performance: {
        avgResponseTimeMs: analyticsData.avgProcessingTimeMs || 0,
        totalRequests: analyticsData.totalRequests || 0,
        successRate: Object.values(modelStats.models).length > 0
          ? `${Math.round(Object.values(modelStats.models).reduce((acc, m) => acc + m.successRate, 0) / Object.values(modelStats.models).length)}%`
          : 'N/A',
      },
      cache: {
        hitRate: `${(cacheStats.hitRate * 100).toFixed(1)}%`,
        totalHits: cacheStats.totalHits,
        totalMisses: cacheStats.totalMisses,
        cacheSize: cacheStats.cacheSize,
      },
      routing: { architecture: 'NLU-based with Micro NLU' },
      conversationFSM: {
        activeContexts: fsmStats.activeContexts || 0,
        avgMessageCount: fsmStats.avgMessageCount || 0,
      },
      intents: analyticsData.topIntents || [],
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to get dashboard stats',
    });
  }
});



// ===========================================
// Circuit Breaker Endpoints
import { getCaseServiceMetrics, resetCaseServiceCircuitBreaker } from './clients/case-service.client';
import { getChannelServiceMetrics, resetChannelServiceCircuitBreaker } from './clients/channel-service.client';

app.get('/stats/circuit-breaker', (req: Request, res: Response) => {
  try {
    const stats = resilientHttp.getStats();
    const caseMetrics = getCaseServiceMetrics();
    const channelMetrics = getChannelServiceMetrics();

    res.json({
      status: stats.state,
      description: getCircuitBreakerDescription(stats.state),
      stats: {
        successful: stats.stats.successes,
        failed: stats.stats.failures,
        rejected: stats.stats.rejects,
        timeout: stats.stats.timeouts,
        fallback: stats.stats.fallbacks,
        cacheHits: stats.stats.cacheHits,
        cacheMisses: stats.stats.cacheMisses,
      },
      services: {
        caseService: {
          state: caseMetrics.state,
          failures: caseMetrics.failures,
          totalRequests: caseMetrics.totalRequests,
        },
        channelService: {
          state: channelMetrics.state,
          failures: channelMetrics.failures,
          totalRequests: channelMetrics.totalRequests,
        },
      },
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to get circuit breaker stats',
    });
  }
});

// Reset circuit breakers
app.post('/stats/circuit-breaker/reset', (req: Request, res: Response) => {
  try {
    const { service } = req.body;

    // Reset main resilientHttp circuit breaker (used by case-client.service.ts)
    resilientHttp.reset();

    if (service === 'case-service' || service === 'all' || !service) {
      resetCaseServiceCircuitBreaker();
    }
    if (service === 'channel-service' || service === 'all' || !service) {
      resetChannelServiceCircuitBreaker();
    }

    res.json({
      success: true,
      message: `Circuit breaker(s) reset successfully`,
      service: service || 'all',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to reset circuit breaker',
    });
  }
});

function getCircuitBreakerDescription(state: string): string {
  switch (state) {
    case 'CLOSED':
      return 'All systems operational. Requests are being processed normally.';
    case 'OPEN':
      return 'Circuit is open! Case Service is unavailable. Requests will fail fast.';
    case 'HALF-OPEN':
      return 'Testing recovery. Some requests being sent to check if service recovered.';
    default:
      return 'Unknown state';
  }
}

// Root endpoint — minimal info only (Temuan 32)
app.get('/', (req: Request, res: Response) => {
  res.json({
    service: 'GovConnect AI Orchestrator',
    version: '1.0.0',
    status: 'running',
  });
});

// Full endpoint map — protected (Temuan 32)
app.get('/admin/routes', internalAuthMiddleware, async (req: Request, res: Response) => {
  const gateways = await getAllAIGatewayInfoAsync();

  res.json({
    service: 'GovConnect AI Orchestrator',
    version: '1.0.0',
    status: 'running',
    docs: '/api-docs',
    description: 'Stateless AI service for processing WhatsApp messages',
    gateways: {
      ...gateways,
      rerankEnabled: config.rerankEnabled,
      ragLLMRerankMaxCandidates: config.ragLLMRerankMaxCandidates,
      retrievalCacheEnabled: config.ragEnableRetrievalCache,
      retrievalCacheTTLSeconds: config.ragRetrievalCacheTTLSeconds,
    },
    llm: {
      chatProvider: config.llmGateway.provider,
      ragRewriteProvider: config.ragGateway.provider,
      embedProvider: config.embeddingGateway.provider,
      rerankProvider: config.rerankerGateway.provider,
    },
    endpoints: {
      health: '/health',
      healthDetailed: '/admin/health/detailed',
      healthRabbitmq: '/admin/health/rabbitmq',
      dashboard: '/stats/dashboard',
      routing: '/stats/routing',
      analyzeComplexity: 'POST /stats/analyze-complexity',
      circuitBreaker: '/stats/circuit-breaker',
      modelStats: '/stats/models',
      modelStatsDetail: '/stats/models/:modelName',
      analytics: '/stats/analytics',
      analyticsIntents: '/stats/analytics/intents',
      analyticsFlow: '/stats/analytics/flow',
      analyticsTokens: '/stats/analytics/tokens',
      analyticsMemory: '/stats/analytics/memory',
      analyticsGuardrails: '/stats/analytics/guardrails',
      analyticsToolPolicy: '/stats/analytics/tool-policy',
      analyticsExport: '/stats/analytics/export',
      goldenSetSummary: '/stats/golden-set',
      goldenSetRun: 'POST /stats/golden-set/run',
      embeddingStats: '/stats/embeddings',
      optimizationStats: '/stats/optimization',
      conversationFSM: '/stats/conversation-fsm',
      rateLimit: '/rate-limit',
      rateLimitCheck: '/rate-limit/check/:wa_user_id',
      blacklist: '/rate-limit/blacklist',
      knowledgeVectors: '/api/knowledge',
      knowledgeEmbedAll: '/api/knowledge/embed-all',
      vectorSearch: '/api/search',
      documentUpload: '/api/upload',
      webchat: '/api/webchat',
      processingStatus: '/api/status/:userId',
      processingStatusSummary: '/api/status/summary',
      processingStatusActive: '/api/status/active',
      processingStatusStream: '/api/status/stream/:userId',
    },
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  logger.warn('Route not found', {
    path: req.path,
    method: req.method,
  });
  res.status(404).json({
    error: 'Route not found',
    path: req.path,
  });
});

// Error handler (Temuan 19 — hide details in production)
app.use((err: Error, req: Request, res: Response, next: any) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
  });
  res.status(500).json({
    error: 'Internal server error',
    message: config.nodeEnv === 'production'
      ? 'Terjadi kesalahan pada server'
      : err.message,
  });
});

async function checkServiceHealth(url: string): Promise<boolean> {
  try {
    const response = await axios.get(url, { timeout: 3000 });
    return response.status === 200;
  } catch (error) {
    return false;
  }
}

export default app;
// Build trigger: 2025-12-13 23.41.48
