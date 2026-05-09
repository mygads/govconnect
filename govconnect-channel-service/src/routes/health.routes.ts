import { Router, Request, Response } from 'express';
import type { Router as ExpressRouter } from 'express';
import prisma from '../config/database';
import { isConnected } from '../services/rabbitmq.service';
import logger from '../utils/logger';
import { getCaseServiceMetrics } from '../clients/case-service.client';
import { checkObjectStorageHealth } from '../services/object-storage.service';
import { getSseMetrics } from '../services/livechat-events.service';

const router: ExpressRouter = Router();

router.get('/', (req: Request, res: Response) => {
  void req;
  res.json({
    status: 'ok',
    service: 'channel-service',
    timestamp: new Date().toISOString(),
  });
});

router.get('/db', async (req: Request, res: Response) => {
  try {
    void req;
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      database: 'connected',
    });
  } catch (error: any) {
    logger.error('Database health check failed', { error: error.message });
    res.status(503).json({
      status: 'error',
      database: 'disconnected',
      error: error.message,
    });
  }
});

router.get('/rabbitmq', (req: Request, res: Response) => {
  void req;
  const connected = isConnected();

  if (connected) {
    res.json({
      status: 'ok',
      rabbitmq: 'connected',
    });
  } else {
    res.status(503).json({
      status: 'error',
      rabbitmq: 'disconnected',
    });
  }
});

router.get('/object-storage', async (req: Request, res: Response) => {
  void req;
  const health = await checkObjectStorageHealth({ includeUsage: true });
  const payload = {
    ...health,
    status: health.status === 'connected' ? 'ok' : health.status,
    objectStorage: health.status === 'connected' ? 'connected' : health.status === 'not_configured' ? 'not_configured' : 'disconnected',
    timestamp: new Date().toISOString(),
  };

  if (health.status === 'error') {
    return res.status(503).json(payload);
  }

  return res.json(payload);
});

/**
 * Circuit breaker status endpoint
 */
router.get('/circuit-breakers', (req: Request, res: Response) => {
  try {
    void req;
    const caseServiceMetrics = getCaseServiceMetrics();

    res.json({
      circuitBreakers: {
        caseService: {
          state: caseServiceMetrics.state,
          failures: caseServiceMetrics.failures,
          successes: caseServiceMetrics.successes,
          totalRequests: caseServiceMetrics.totalRequests,
          totalFailures: caseServiceMetrics.totalFailures,
          totalSuccesses: caseServiceMetrics.totalSuccesses,
          successRate: caseServiceMetrics.totalRequests > 0
            ? ((caseServiceMetrics.totalSuccesses / caseServiceMetrics.totalRequests) * 100).toFixed(2) + '%'
            : 'N/A',
          lastFailureTime: caseServiceMetrics.lastFailureTime,
          lastSuccessTime: caseServiceMetrics.lastSuccessTime,
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to get circuit breaker status',
      message: error.message,
    });
  }
});

/**
 * SSE metrics endpoint
 */
router.get('/sse', (req: Request, res: Response) => {
  void req;
  const metrics = getSseMetrics();
  res.json({
    status: 'ok',
    sse: {
      activeListeners: metrics.activeListeners,
      totalEventsPublished: metrics.totalEventsPublished,
      lastEventPublishedAt: metrics.lastEventPublishedAt > 0
        ? new Date(metrics.lastEventPublishedAt).toISOString()
        : null,
    },
    timestamp: new Date().toISOString(),
  });
});

export default router;
