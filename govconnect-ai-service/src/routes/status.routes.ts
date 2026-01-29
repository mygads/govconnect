/**
 * Processing Status Routes
 * 
 * API endpoints for real-time processing status:
 * - GET /status/summary - Get overall processing summary (for dashboard)
 * - GET /status/active - Get all active processing statuses
 * - GET /status/stream/:userId - SSE for real-time updates
 * - GET /status/:userId - Get current processing status for a user
 * 
 * IMPORTANT: Static routes (/summary, /active) MUST be defined BEFORE dynamic routes (/:userId)
 */

import { Router, Request, Response } from 'express';
import logger from '../utils/logger';
import { getParam } from '../utils/http';
import {
  getStatus,
  isProcessing,
  getAllActiveStatuses,
  getStatusSummary,
  onStatusUpdate,
} from '../services/processing-status.service';

const router = Router();

/**
 * GET /status/summary
 * Get overall processing summary for dashboard
 * MUST be before /:userId to avoid being caught by dynamic route
 */
router.get('/summary', (_req: Request, res: Response) => {
  try {
    const summary = getStatusSummary();
    
    return res.json({
      success: true,
      data: summary,
    });
  } catch (error: any) {
    logger.error('[StatusRoutes] Error getting summary', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Failed to get processing summary',
    });
  }
});

/**
 * GET /status/active
 * Get all active processing statuses (for monitoring)
 */
router.get('/active', (_req: Request, res: Response) => {
  try {
    const activeStatuses = getAllActiveStatuses();
    
    const formattedStatuses = activeStatuses.map(status => ({
      userId: status.userId,
      stage: status.stage,
      message: status.message,
      progress: status.progress,
      elapsedMs: Date.now() - status.startTime,
      estimatedTimeMs: status.estimatedTimeMs,
    }));
    
    return res.json({
      success: true,
      data: {
        count: formattedStatuses.length,
        statuses: formattedStatuses,
      },
    });
  } catch (error: any) {
    logger.error('[StatusRoutes] Error getting active statuses', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Failed to get active statuses',
    });
  }
});

/**
 * GET /status/stream/:userId
 * Server-Sent Events (SSE) for real-time status updates
 */
router.get('/stream/:userId', (req: Request, res: Response) => {
  const userId = getParam(req, 'userId');
  if (!userId) {
    res.status(400).json({
      success: false,
      error: 'userId is required',
    });
    return;
  }
  
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  
  // Send initial status
  const initialStatus = getStatus(userId);
  if (initialStatus) {
    res.write(`data: ${JSON.stringify({
      stage: initialStatus.stage,
      message: initialStatus.message,
      progress: initialStatus.progress,
    })}\n\n`);
  }
  
  // Subscribe to updates
  const unsubscribe = onStatusUpdate(userId, (status) => {
    res.write(`data: ${JSON.stringify({
      stage: status.stage,
      message: status.message,
      progress: status.progress,
    })}\n\n`);
    
    // Close connection when completed or error
    if (status.stage === 'completed' || status.stage === 'error') {
      setTimeout(() => {
        res.end();
      }, 1000);
    }
  });
  
  // Cleanup on client disconnect
  req.on('close', () => {
    unsubscribe();
    logger.debug('[StatusRoutes] SSE connection closed', { userId });
  });
  
  // Keep connection alive with heartbeat
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);
  
  req.on('close', () => {
    clearInterval(heartbeat);
  });
});

/**
 * GET /status/:userId
 * Get current processing status for a specific user
 * MUST be LAST because it's a catch-all dynamic route
 */
router.get('/:userId', (req: Request, res: Response) => {
  const userId = getParam(req, 'userId');
  if (!userId) {
    return res.status(400).json({
      success: false,
      error: 'userId is required',
    });
  }
  
  try {
    const status = getStatus(userId);
    
    if (!status) {
      return res.json({
        success: true,
        data: {
          userId,
          isProcessing: false,
          status: null,
        },
      });
    }
    
    return res.json({
      success: true,
      data: {
        userId,
        isProcessing: isProcessing(userId),
        status: {
          stage: status.stage,
          message: status.message,
          progress: status.progress,
          elapsedMs: Date.now() - status.startTime,
          estimatedTimeMs: status.estimatedTimeMs,
        },
      },
    });
  } catch (error: any) {
    logger.error('[StatusRoutes] Error getting status', { userId, error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Failed to get processing status',
    });
  }
});

export default router;
