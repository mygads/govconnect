import express, { Request, Response } from 'express';
import logger from './utils/logger';
import { isConnected as isRabbitMQConnected } from './services/rabbitmq.service';
import { checkCaseServiceHealth } from './services/case-client.service';
import { modelStatsService } from './services/model-stats.service';
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
