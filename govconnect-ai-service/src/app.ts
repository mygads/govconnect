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
  getFailedMessage,
  retryFailedMessage,
  retryAllFailedMessages,
  clearFailedMessages,
} from './services/rabbitmq.service';
import { checkCaseServiceHealth } from './services/case-client.service';
import { modelStatsService } from './services/model-stats.service';
import { rateLimiterService } from './services/rate-limiter.service';
import { aiAnalyticsService } from './services/ai-analytics.service';
import { getEmbeddingStats, getEmbeddingCacheStats } from './services/embedding.service';
import { getVectorDbStats } from './services/vector-db.service';
import { resilientHttp } from './services/circuit-breaker.service';
import { getTopCachedQueries, getCacheStats, clearCache as clearResponseCache } from './services/response-cache.service';
import { getRoutingStats, analyzeComplexity } from './services/smart-router.service';
import { getFSMStats, getAllActiveContexts } from './services/conversation-fsm.service';
import knowledgeRoutes from './routes/knowledge.routes';
import searchRoutes from './routes/search.routes';
import uploadRoutes from './routes/upload.routes';
import webchatRoutes from './routes/webchat.routes';
import statusRoutes from './routes/status.routes';
import testingRoutes from './routes/testing.routes';
import { swaggerSpec } from './config/swagger';
import axios from 'axios';
import { config } from './config/env';
import { getParam, getQuery } from './utils/http';
import { runGoldenSetEvaluation, getGoldenSetSummary } from './services/golden-set-eval.service';
import {
  getUsageByPeriod,
  getUsageByModel,
  getUsageByVillage,
  getLayerBreakdown,
  getAvgTokensPerChat,
  getResponseCountByVillage,
  getUsageByVillageAndModel,
  getUsageByPeriodAndLayer,
  getTokenUsageSummary,
  getTokenUsageBySource,
  recordTokenUsage,
} from './services/token-usage.service';
import { clearAllUMPCaches, clearUserCaches, getUMPCacheStats, getActiveProcessingCount } from './services/unified-message-processor.service';
import { clearVillageProfileCache } from './services/knowledge.service';
import { getEmbeddingCacheStats as getEmbCacheDetailStats } from './services/embedding.service';

// Initialize Prometheus default metrics
promClient.collectDefaultMetrics({
  prefix: 'govconnect_',
  labels: { service: 'ai-service' },
});

const app = express();

app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));
app.use(helmet());

const internalAuthMiddleware = (req: Request, res: Response, next: any) => {
  const apiKey = req.headers['x-internal-api-key'];
  if (!apiKey || apiKey !== config.internalApiKey) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
};

app.use(express.json());

// Prometheus Metrics endpoint
app.get('/metrics', async (req: Request, res: Response) => {
  try {
    res.set('Content-Type', promClient.register.contentType);
    const metrics = await promClient.register.metrics();
    res.send(metrics);
  } catch (error) {
    res.status(500).send('Error collecting metrics');
  }
});
// Swagger API Documentation
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

// OpenAPI spec as JSON
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'ai-orchestrator',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health/rabbitmq', (req: Request, res: Response) => {
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

app.use('/admin', internalAuthMiddleware);
app.use('/stats', internalAuthMiddleware);

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
        originalMessage: msg.event.is_batched
          ? `[Batched: ${msg.event.batched_message_ids?.length || 0} messages]`
          : msg.event.message?.substring(0, 100),
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
app.get('/admin/cache/stats', (req: Request, res: Response) => {
  const umpStats = getUMPCacheStats();
  const responseCacheStats = getCacheStats();

  res.json({
    cacheEnabled: _cacheEnabled,
    activeProcessing: getActiveProcessingCount(),
    umpCaches: umpStats,
    responseCache: responseCacheStats,
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /admin/cache/clear-all — Clear all in-memory caches
 */
app.post('/admin/cache/clear-all', (req: Request, res: Response) => {
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
app.post('/admin/cache/clear-user', (req: Request, res: Response) => {
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
app.get('/admin/cache/mode', (req: Request, res: Response) => {
  res.json({ cacheEnabled: _cacheEnabled });
});

/**
 * POST /admin/cache/mode — Toggle cache mode (dev/production)
 */
app.post('/admin/cache/mode', (req: Request, res: Response) => {
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

app.get('/health/services', async (req: Request, res: Response) => {
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
app.get('/stats/analytics', (req: Request, res: Response) => {
  try {
    const summary = aiAnalyticsService.getSummary();
    res.json(summary);
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to get analytics',
    });
  }
});

app.get('/stats/analytics/intents', (req: Request, res: Response) => {
  try {
    const distribution = aiAnalyticsService.getIntentDistribution();
    res.json(distribution);
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to get intent distribution',
    });
  }
});

app.get('/stats/analytics/flow', (req: Request, res: Response) => {
  try {
    const flow = aiAnalyticsService.getConversationFlow();
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

app.get('/stats/analytics/full', (req: Request, res: Response) => {
  try {
    const data = aiAnalyticsService.getAllAnalytics();
    res.json(data);
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to get full analytics',
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

// ===========================================
// AI Token Usage Endpoints (real Gemini usageMetadata)

// GET /stats/token-usage/summary — overview card data
app.get('/stats/token-usage/summary', async (req: Request, res: Response) => {
  try {
    const filters = {
      village_id: getQuery(req, 'village_id'),
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
      start: getQuery(req, 'start'),
      end: getQuery(req, 'end'),
    };
    const data = await getUsageByModel(filters);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get usage by model' });
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

// GET /stats/token-usage/layer-breakdown — micro vs full NLU detail
app.get('/stats/token-usage/layer-breakdown', async (req: Request, res: Response) => {
  try {
    const filters = {
      village_id: getQuery(req, 'village_id'),
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
      start: getQuery(req, 'start'),
      end: getQuery(req, 'end'),
    };
    const data = await getUsageByVillageAndModel(filters);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get village model detail' });
  }
});

// GET /stats/token-usage/by-source — BYOK vs ENV breakdown
app.get('/stats/token-usage/by-source', async (req: Request, res: Response) => {
  try {
    const slug = getQuery(req, 'village_id');
    const data = await getTokenUsageBySource(slug);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get token usage by source' });
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
    const stats = rateLimiterService.getStats();
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
    if (!wa_user_id) {
      res.status(400).json({
        error: 'wa_user_id is required',
      });
      return;
    }
    const result = rateLimiterService.checkRateLimit(wa_user_id);
    const userInfo = rateLimiterService.getUserInfo(wa_user_id);

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
    const blacklist = rateLimiterService.getBlacklist();
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
    const { wa_user_id, reason, expiresInDays } = req.body;

    if (!wa_user_id || !reason) {
      res.status(400).json({
        error: 'wa_user_id and reason are required',
      });
      return;
    }

    rateLimiterService.addToBlacklist(wa_user_id, reason, 'admin', expiresInDays);

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
    if (!wa_user_id) {
      res.status(400).json({
        error: 'wa_user_id is required',
      });
      return;
    }
    const removed = rateLimiterService.removeFromBlacklist(wa_user_id);

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

app.post('/rate-limit/reset/:wa_user_id', (req: Request, res: Response) => {
  try {
    const wa_user_id = getParam(req, 'wa_user_id');
    if (!wa_user_id) {
      res.status(400).json({
        error: 'wa_user_id is required',
      });
      return;
    }
    const reset = rateLimiterService.resetUserViolations(wa_user_id);

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

// Serve uploaded documents as static files
// Files are accessible at /uploads/documents/<filename>
import path from 'path';
const uploadsDir = path.join(process.cwd(), 'uploads', 'documents');
app.use('/uploads/documents', express.static(uploadsDir, {
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
app.use('/api/status', statusRoutes);
app.use('/api/testing', testingRoutes);

/**
 * Internal endpoint for cross-service token usage recording.
 * Used by case-service (and other services) that make their own Gemini LLM calls
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
    const routingStats = getRoutingStats();
    const fsmStats = getFSMStats();
    const modelStats = modelStatsService.getAllStats();
    const analyticsData = aiAnalyticsService.getSummary();

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
      routing: routingStats,
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

// Analyze message complexity (for testing smart router)
app.post('/stats/analyze-complexity', (req: Request, res: Response) => {
  try {
    const { message, conversationHistory } = req.body;

    if (!message) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const analysis = analyzeComplexity(message, conversationHistory);

    res.json({
      message: message.substring(0, 100),
      analysis,
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to analyze complexity',
    });
  }
});

// Smart Routing Stats
app.get('/stats/routing', (req: Request, res: Response) => {
  try {
    const stats = getRoutingStats();

    res.json({
      description: 'Message processing statistics',
      stats,
      architecture: 'NLU-based with Micro NLU',
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to get routing stats',
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

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({
    service: 'GovConnect AI Orchestrator',
    version: '1.0.0',
    status: 'running',
    docs: '/api-docs',
    description: 'Stateless AI service for processing WhatsApp messages',
    endpoints: {
      health: '/health',
      // Dashboard & Analytics
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
      goldenSetSummary: '/stats/golden-set',
      goldenSetRun: 'POST /stats/golden-set/run',
      embeddingStats: '/stats/embeddings',
      optimizationStats: '/stats/optimization',
      conversationFSM: '/stats/conversation-fsm',
      rateLimit: '/rate-limit',
      rateLimitCheck: '/rate-limit/check/:wa_user_id',
      blacklist: '/rate-limit/blacklist',
      // Vector API
      knowledgeVectors: '/api/knowledge',
      knowledgeEmbedAll: '/api/knowledge/embed-all',
      vectorSearch: '/api/search',
      documentUpload: '/api/upload',
      // Web Chat API
      webchat: '/api/webchat',
      // Processing Status API
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

// Error handler
app.use((err: Error, req: Request, res: Response, next: any) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
  });
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
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
