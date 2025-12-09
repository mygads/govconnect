import express, { Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';
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
import documentRoutes from './routes/document.routes';
import knowledgeRoutes from './routes/knowledge.routes';
import documentsRoutes from './routes/documents.routes';
import searchRoutes from './routes/search.routes';
import uploadRoutes from './routes/upload.routes';
import { swaggerSpec } from './config/swagger';
import axios from 'axios';
import { config } from './config/env';

const app = express();

app.use(express.json());

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
    const { messageId } = req.params;
    
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
    const { modelName } = req.params;
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

// Mount document processing routes (legacy)
app.use('/api/internal', documentRoutes);

// Mount new vector API routes
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/documents', documentsRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/upload', uploadRoutes);

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
// Circuit Breaker Endpoints
app.get('/stats/circuit-breaker', (req: Request, res: Response) => {
  try {
    const stats = resilientHttp.getStats();
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
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to get circuit breaker stats',
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
      circuitBreaker: '/stats/circuit-breaker',
      modelStats: '/stats/models',
      modelStatsDetail: '/stats/models/:modelName',
      analytics: '/stats/analytics',
      analyticsIntents: '/stats/analytics/intents',
      analyticsFlow: '/stats/analytics/flow',
      analyticsTokens: '/stats/analytics/tokens',
      embeddingStats: '/stats/embeddings',
      rateLimit: '/rate-limit',
      rateLimitCheck: '/rate-limit/check/:wa_user_id',
      blacklist: '/rate-limit/blacklist',
      // Vector API (new)
      knowledgeVectors: '/api/knowledge',
      documentVectors: '/api/documents',
      vectorSearch: '/api/search',
      // Legacy (deprecated)
      processDocument: '/api/internal/process-document',
      embedKnowledge: '/api/internal/embed-knowledge',
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
