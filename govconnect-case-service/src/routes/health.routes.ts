import { Router } from 'express';
import { prisma } from '../config/database';
import { isConnected } from '../services/rabbitmq.service';

const router: Router = Router();

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
 *               $ref: '#/components/schemas/HealthCheck'
 */
router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'govconnect-case-service',
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /health/database:
 *   get:
 *     tags: [Health]
 *     summary: Database health check
 *     description: Check database connectivity status
 *     responses:
 *       200:
 *         description: Database connected
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 database:
 *                   type: string
 *                   example: connected
 *       503:
 *         description: Database disconnected
 */
router.get('/database', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'connected' });
  } catch (error: any) {
    res.status(503).json({ status: 'error', database: 'disconnected', error: error.message });
  }
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
 *         description: RabbitMQ connected
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 rabbitmq:
 *                   type: string
 *                   example: connected
 *       503:
 *         description: RabbitMQ disconnected
 */
router.get('/rabbitmq', async (req, res) => {
  try {
    const connected = isConnected();
    
    if (connected) {
      res.json({ status: 'ok', rabbitmq: 'connected' });
    } else {
      res.status(503).json({ status: 'error', rabbitmq: 'disconnected' });
    }
  } catch (error: any) {
    res.status(503).json({ status: 'error', rabbitmq: 'error', error: error.message });
  }
});

export default router;
