import { Router, Request, Response } from 'express';
import prisma from '../config/database';
import { isConnected } from '../services/rabbitmq.service';
import logger from '../utils/logger';

const router = Router();

/**
 * @swagger
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Basic health check
 *     description: Returns basic health status of the service
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "ok"
 *                 service:
 *                   type: string
 *                   example: "channel-service"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 */
router.get('/', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'channel-service',
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /health/db:
 *   get:
 *     tags: [Health]
 *     summary: Database health check
 *     description: Check PostgreSQL database connectivity
 *     responses:
 *       200:
 *         description: Database is connected
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "ok"
 *                 database:
 *                   type: string
 *                   example: "connected"
 *       503:
 *         description: Database is disconnected
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "error"
 *                 database:
 *                   type: string
 *                   example: "disconnected"
 *                 error:
 *                   type: string
 */
router.get('/db', async (req: Request, res: Response) => {
  try {
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

/**
 * @swagger
 * /health/rabbitmq:
 *   get:
 *     tags: [Health]
 *     summary: RabbitMQ health check
 *     description: Check RabbitMQ message queue connectivity
 *     responses:
 *       200:
 *         description: RabbitMQ is connected
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "ok"
 *                 rabbitmq:
 *                   type: string
 *                   example: "connected"
 *       503:
 *         description: RabbitMQ is disconnected
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "error"
 *                 rabbitmq:
 *                   type: string
 *                   example: "disconnected"
 */
router.get('/rabbitmq', (req: Request, res: Response) => {
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

export default router;
