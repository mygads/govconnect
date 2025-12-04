import express, { Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import logger from './utils/logger';
import { isConnected as isRabbitMQConnected } from './services/rabbitmq.service';
import { checkCaseServiceHealth } from './services/case-client.service';
import { modelStatsService } from './services/model-stats.service';
import { rateLimiterService } from './services/rate-limiter.service';
import { aiAnalyticsService } from './services/ai-analytics.service';
import { getEmbeddingStats } from './services/embedding.service';
import { getVectorCacheStats } from './services/vector-store.service';
import { resilientHttp } from './services/circuit-breaker.service';
import documentRoutes from './routes/document.routes';
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

/**
 * @swagger
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Basic health check
 *     description: Returns basic service health status
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthResponse'
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'ai-orchestrator',
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /health/rabbitmq:
 *   get:
 *     tags: [Health]
 *     summary: RabbitMQ health check
 *     description: Check RabbitMQ connectivity status
 *     responses:
 *       200:
 *         description: RabbitMQ status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [connected, disconnected]
 *                 service:
 *                   type: string
 */
app.get('/health/rabbitmq', (req: Request, res: Response) => {
  const connected = isRabbitMQConnected();
  res.json({
    status: connected ? 'connected' : 'disconnected',
    service: 'ai-orchestrator',
  });
});

/**
 * @swagger
 * /health/services:
 *   get:
 *     tags: [Health]
 *     summary: Dependent services health check
 *     description: Check connectivity to Channel Service and Case Service
 *     responses:
 *       200:
 *         description: Services status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [ok, degraded]
 *                 services:
 *                   type: object
 *                   properties:
 *                     channelService:
 *                       type: string
 *                       enum: [healthy, unhealthy]
 *                     caseService:
 *                       type: string
 *                       enum: [healthy, unhealthy]
 */
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

/**
 * @swagger
 * /stats/models:
 *   get:
 *     tags: [Model Stats]
 *     summary: Get all LLM model statistics
 *     description: Returns statistics for all LLM models used by the AI service
 *     responses:
 *       200:
 *         description: Model statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 summary:
 *                   type: object
 *                   properties:
 *                     totalRequests:
 *                       type: integer
 *                     lastUpdated:
 *                       type: string
 *                     totalModels:
 *                       type: integer
 *                 models:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       model:
 *                         type: string
 *                       successRate:
 *                         type: string
 *                       totalCalls:
 *                         type: integer
 *                       avgResponseTimeMs:
 *                         type: number
 */
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

/**
 * @swagger
 * /stats/models/{modelName}:
 *   get:
 *     tags: [Model Stats]
 *     summary: Get detailed model statistics
 *     description: Returns detailed stats including error history for a specific model
 *     parameters:
 *       - in: path
 *         name: modelName
 *         required: true
 *         schema:
 *           type: string
 *         description: Model name (e.g., gemini-1.5-flash)
 *     responses:
 *       200:
 *         description: Detailed model statistics
 *       404:
 *         description: Model not found
 */
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
// ===========================================

/**
 * @swagger
 * /stats/analytics:
 *   get:
 *     tags: [Analytics]
 *     summary: Get AI analytics summary
 *     description: Returns overall AI processing analytics summary
 *     responses:
 *       200:
 *         description: Analytics summary
 */
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

/**
 * @swagger
 * /stats/analytics/intents:
 *   get:
 *     tags: [Analytics]
 *     summary: Get intent distribution
 *     description: Returns distribution of detected intents
 *     responses:
 *       200:
 *         description: Intent distribution data
 */
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

/**
 * @swagger
 * /stats/analytics/flow:
 *   get:
 *     tags: [Analytics]
 *     summary: Get conversation flow patterns
 *     description: Returns analysis of conversation flow patterns
 *     responses:
 *       200:
 *         description: Conversation flow data
 */
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

/**
 * @swagger
 * /stats/analytics/tokens:
 *   get:
 *     tags: [Analytics]
 *     summary: Get token usage breakdown
 *     description: Returns breakdown of token usage by model
 *     responses:
 *       200:
 *         description: Token usage data
 */
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

/**
 * @swagger
 * /stats/analytics/full:
 *   get:
 *     tags: [Analytics]
 *     summary: Get full analytics data
 *     description: Returns all analytics data for export purposes
 *     responses:
 *       200:
 *         description: Full analytics data
 */
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
// ===========================================

/**
 * @swagger
 * /rate-limit:
 *   get:
 *     tags: [Rate Limit]
 *     summary: Get rate limiter config and stats
 *     description: Returns rate limiter configuration and current statistics
 *     responses:
 *       200:
 *         description: Rate limit configuration and stats
 */
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

/**
 * @swagger
 * /rate-limit/check/{wa_user_id}:
 *   get:
 *     tags: [Rate Limit]
 *     summary: Check rate limit for user
 *     description: Check rate limit status for a specific WhatsApp user
 *     parameters:
 *       - in: path
 *         name: wa_user_id
 *         required: true
 *         schema:
 *           type: string
 *         description: WhatsApp User ID
 *     responses:
 *       200:
 *         description: User rate limit status
 */
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

/**
 * @swagger
 * /rate-limit/blacklist:
 *   get:
 *     tags: [Rate Limit]
 *     summary: Get blacklist
 *     description: Returns all blacklisted users
 *     responses:
 *       200:
 *         description: Blacklist entries
 */
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

/**
 * @swagger
 * /rate-limit/blacklist:
 *   post:
 *     tags: [Rate Limit]
 *     summary: Add user to blacklist
 *     description: Add a WhatsApp user to the blacklist
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - wa_user_id
 *               - reason
 *             properties:
 *               wa_user_id:
 *                 type: string
 *               reason:
 *                 type: string
 *               expiresInDays:
 *                 type: integer
 *     responses:
 *       200:
 *         description: User added to blacklist
 *       400:
 *         description: Missing required fields
 */
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

/**
 * @swagger
 * /rate-limit/blacklist/{wa_user_id}:
 *   delete:
 *     tags: [Rate Limit]
 *     summary: Remove user from blacklist
 *     description: Remove a WhatsApp user from the blacklist
 *     parameters:
 *       - in: path
 *         name: wa_user_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User removed from blacklist
 *       404:
 *         description: User not in blacklist
 */
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

/**
 * @swagger
 * /rate-limit/reset/{wa_user_id}:
 *   post:
 *     tags: [Rate Limit]
 *     summary: Reset user violations
 *     description: Reset violation count for a WhatsApp user
 *     parameters:
 *       - in: path
 *         name: wa_user_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Violations reset successfully
 *       404:
 *         description: User not found
 */
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

// Mount document processing routes
app.use('/api/internal', documentRoutes);

/**
 * @swagger
 * /stats/embeddings:
 *   get:
 *     tags: [Embeddings]
 *     summary: Get embedding stats
 *     description: Returns embedding service and vector cache statistics
 *     responses:
 *       200:
 *         description: Embedding statistics
 */
app.get('/stats/embeddings', (req: Request, res: Response) => {
  try {
    const embeddingStats = getEmbeddingStats();
    const vectorCacheStats = getVectorCacheStats();
    
    res.json({
      embedding: embeddingStats,
      vectorCache: vectorCacheStats,
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
// ===========================================

/**
 * @swagger
 * /stats/circuit-breaker:
 *   get:
 *     tags: [Circuit Breaker]
 *     summary: Get circuit breaker status
 *     description: Returns circuit breaker state and statistics
 *     responses:
 *       200:
 *         description: Circuit breaker status
 */
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
      processDocument: '/api/internal/process-document',
      embedKnowledge: '/api/internal/embed-knowledge',
      embedAllKnowledge: '/api/internal/embed-all-knowledge',
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
