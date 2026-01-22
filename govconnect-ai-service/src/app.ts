import express, { Request, Response } from 'express';
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
import { getTopCachedQueries, getCacheStats } from './services/response-cache.service';
import { getRoutingStats, analyzeComplexity } from './services/smart-router.service';
import { getFSMStats, getAllActiveContexts } from './services/conversation-fsm.service';
import knowledgeRoutes from './routes/knowledge.routes';
import searchRoutes from './routes/search.routes';
import uploadRoutes from './routes/upload.routes';
import webchatRoutes from './routes/webchat.routes';
import statusRoutes from './routes/status.routes';
import { swaggerSpec } from './config/swagger';
import axios from 'axios';
import { config } from './config/env';

// Initialize Prometheus default metrics
promClient.collectDefaultMetrics({
  prefix: 'govconnect_',
  labels: { service: 'ai-service' },
});

const app = express();

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
          message_id: msg.message_id,
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
      message: error.message,
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
      message: error.message,
    });
  }
});

/**
 * Retry a specific failed message (admin manual retry)
 */
app.post('/admin/failed-messages/:messageId/retry', async (req: Request, res: Response) => {
  try {
    const messageId = req.params.messageId as string;

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
      message: error.message,
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
      message: error.message,
    });
  }
});

/**
 * Clear failed messages (admin cleanup)
 * Query param: all=true to clear all, otherwise only cleared resolved
 */
app.delete('/admin/failed-messages', (req: Request, res: Response) => {
  try {
    const clearAll = req.query.all === 'true';

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
      message: error.message,
    });
  }
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
      message: error.message,
    });
  }
});

app.get('/stats/models/:modelName', (req: Request, res: Response) => {
  try {
    const modelName = req.params.modelName as string;
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
      message: error.message,
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
      message: error.message,
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
      message: error.message,
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
      message: error.message,
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
      message: error.message,
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
      message: error.message,
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
      message: error.message,
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
      message: error.message,
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
      message: error.message,
    });
  }
});

app.get('/rate-limit/check/:wa_user_id', (req: Request, res: Response) => {
  try {
    const { wa_user_id } = req.params;
    const result = rateLimiterService.checkRateLimit(wa_user_id);
    const userInfo = rateLimiterService.getUserInfo(wa_user_id);

    res.json({
      ...result,
      user: userInfo,
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to check rate limit',
      message: error.message,
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
      message: error.message,
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
      message: error.message,
    });
  }
});

app.delete('/rate-limit/blacklist/:wa_user_id', (req: Request, res: Response) => {
  try {
    const { wa_user_id } = req.params;
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
      message: error.message,
    });
  }
});

app.post('/rate-limit/reset/:wa_user_id', (req: Request, res: Response) => {
  try {
    const { wa_user_id } = req.params;
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
      message: error.message,
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
      message: error.message,
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
      architecture: process.env.USE_2_LAYER_ARCHITECTURE === 'true' ? '2-Layer LLM' : 'Single Layer',
      description: 'AI optimization stats including response caching, fast intent classification, and conversation FSM',
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to get optimization stats',
      message: error.message,
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
      message: error.message,
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

    const architecture = process.env.USE_2_LAYER_ARCHITECTURE === 'true' ? '2-Layer LLM' : 'Single Layer';

    res.json({
      architecture: {
        current: architecture,
        envVar: 'USE_2_LAYER_ARCHITECTURE',
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
      message: error.message,
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
      message: error.message,
    });
  }
});

// Smart Routing Stats
app.get('/stats/routing', (req: Request, res: Response) => {
  try {
    const stats = getRoutingStats();

    res.json({
      description: 'Smart routing statistics - how messages are routed between architectures',
      stats,
      architecture: process.env.USE_2_LAYER_ARCHITECTURE === 'true' ? '2-Layer LLM' : 'Single Layer',
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to get routing stats',
      message: error.message,
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
      message: error.message,
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
      message: error.message,
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
