import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import config from './config/env';
import logger from './utils/logger';
import prisma from './config/database';
import { isConnected } from './services/rabbitmq.service';
import { swaggerSpec } from './config/swagger';

const app: Application = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent')
  });
  next();
});

// Swagger API Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  explorer: true,
  customSiteTitle: 'GovConnect Notification Service API',
  customCss: '.swagger-ui .topbar { display: none }',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    docExpansion: 'list',
  },
}));

// OpenAPI spec as JSON
app.get('/api-docs.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

/**
 * @swagger
 * /:
 *   get:
 *     tags: [Health]
 *     summary: Service info
 *     description: Returns service information and version
 *     responses:
 *       200:
 *         description: Service info
 */
app.get('/', (_req: Request, res: Response) => {
  res.json({
    service: 'govconnect-notification-service',
    version: '1.0.0',
    status: 'running',
    docs: '/api-docs',
    timestamp: new Date().toISOString()
  });
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
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'govconnect-notification-service',
    timestamp: new Date().toISOString()
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
 *       503:
 *         description: Database disconnected
 */
app.get('/health/database', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    logger.error('Database health check failed:', error);
    res.status(503).json({
      status: 'error',
      database: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString()
    });
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
 *       503:
 *         description: RabbitMQ disconnected
 */
app.get('/health/rabbitmq', (_req: Request, res: Response) => {
  const connected = isConnected();
  
  res.status(connected ? 200 : 503).json({
    status: connected ? 'ok' : 'error',
    rabbitmq: connected ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    path: req.path,
    method: req.method
  });
});

// Error handler
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error:', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });

  res.status(500).json({
    error: 'Internal Server Error',
    message: config.nodeEnv === 'development' ? err.message : undefined
  });
});

export default app;
