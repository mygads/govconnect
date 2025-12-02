import express, { Request, Response } from 'express';
import logger from './utils/logger';
import { isConnected as isRabbitMQConnected } from './services/rabbitmq.service';
import { checkCaseServiceHealth } from './services/case-client.service';
import { modelStatsService } from './services/model-stats.service';
import { rateLimiterService } from './services/rate-limiter.service';
import { aiAnalyticsService } from './services/ai-analytics.service';
import axios from 'axios';
import { config } from './config/env';

const app = express();

app.use(express.json());

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'ai-orchestrator',
    timestamp: new Date().toISOString(),
  });
});

// RabbitMQ health check
app.get('/health/rabbitmq', (req: Request, res: Response) => {
  const connected = isRabbitMQConnected();
  res.json({
    status: connected ? 'connected' : 'disconnected',
    service: 'ai-orchestrator',
  });
});

// Services health check
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

// LLM Model Statistics endpoint
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

// Detailed model stats (including error history)
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

// Get AI analytics summary
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

// Get intent distribution
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

// Get conversation flow patterns
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

// Get token usage breakdown
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

// Get all analytics data (for export)
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

// Get rate limiter config and stats
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

// Check rate limit for specific user
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

// Get blacklist
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

// Add to blacklist
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

// Remove from blacklist
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

// Reset user violations
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

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({
    service: 'GovConnect AI Orchestrator',
    version: '1.0.0',
    status: 'running',
    description: 'Stateless AI service for processing WhatsApp messages',
    endpoints: {
      health: '/health',
      modelStats: '/stats/models',
      modelStatsDetail: '/stats/models/:modelName',
      analytics: '/stats/analytics',
      analyticsIntents: '/stats/analytics/intents',
      analyticsFlow: '/stats/analytics/flow',
      analyticsTokens: '/stats/analytics/tokens',
      rateLimit: '/rate-limit',
      rateLimitCheck: '/rate-limit/check/:wa_user_id',
      blacklist: '/rate-limit/blacklist',
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
