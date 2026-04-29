import { Router, Request, Response } from 'express';
import { getChannelServiceMetrics, resetChannelServiceCircuitBreaker } from '../clients/channel-service.client';
import { getCaseServiceMetrics, resetCaseServiceCircuitBreaker } from '../clients/case-service.client';
import { requireInternalApiKey } from '../utils/internal-auth';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'ai-service',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Circuit breaker status endpoint
 */
router.get('/circuit-breakers', (req: Request, res: Response) => {
  try {
    const channelServiceMetrics = getChannelServiceMetrics();
    const caseServiceMetrics = getCaseServiceMetrics();

    res.json({
      circuitBreakers: {
        channelService: {
          state: channelServiceMetrics.state,
          failures: channelServiceMetrics.failures,
          successes: channelServiceMetrics.successes,
          totalRequests: channelServiceMetrics.totalRequests,
          totalFailures: channelServiceMetrics.totalFailures,
          totalSuccesses: channelServiceMetrics.totalSuccesses,
          successRate: channelServiceMetrics.totalRequests > 0
            ? ((channelServiceMetrics.totalSuccesses / channelServiceMetrics.totalRequests) * 100).toFixed(2) + '%'
            : 'N/A',
        },
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
 * Reset circuit breakers endpoint
 */
router.post('/circuit-breakers/reset', requireInternalApiKey, (req: Request, res: Response) => {
  try {
    const { service } = req.body;
    
    if (service === 'case-service' || service === 'all') {
      resetCaseServiceCircuitBreaker();
    }
    if (service === 'channel-service' || service === 'all') {
      resetChannelServiceCircuitBreaker();
    }
    
    if (!service) {
      // Reset all by default
      resetCaseServiceCircuitBreaker();
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

export default router;
