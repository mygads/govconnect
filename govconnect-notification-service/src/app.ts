import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import promClient from 'prom-client';
import crypto from 'crypto';
import config from './config/env';
import logger from './utils/logger';
import prisma from './config/database';
import { isConnected } from './services/rabbitmq.service';
import { swaggerSpec } from './config/swagger';
import { handleEvent } from './handlers/event.handler';
import { errorResponse, successResponse } from './shared/error-response';

// Initialize Prometheus default metrics
promClient.collectDefaultMetrics({
  prefix: 'govconnect_',
  labels: { service: 'notification-service' },
});

const app: Application = express();

function internalApiKeyMatches(value: string | string[] | undefined): boolean {
  const expected = config.internalApiKey?.trim();
  const provided = Array.isArray(value) ? value[0]?.trim() : value?.trim();
  if (!expected || !provided) return false;
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  return expectedBuf.length === providedBuf.length && crypto.timingSafeEqual(expectedBuf, providedBuf);
}

function internalAuthGuard(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-internal-api-key'] || req.headers['x-api-key'];
  if (!internalApiKeyMatches(apiKey)) {
    res.status(403).json(errorResponse('Forbidden'));
    return;
  }

  next();
}

const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(origin => origin.trim()).filter(Boolean);
if (!allowedOrigins || allowedOrigins.length === 0) {
  logger.warn('ALLOWED_ORIGINS not set — CORS will reject all cross-origin requests');
}

// Middleware
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins?.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS: origin ${origin} not allowed`));
  },
}));
app.use(helmet());

// Correlation ID middleware — must be before routes
import { correlationMiddleware } from './shared/correlation-context';
app.use(correlationMiddleware);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Prometheus Metrics endpoint
app.get('/metrics', internalAuthGuard, async (_req: Request, res: Response) => {
  try {
    res.set('Content-Type', promClient.register.contentType);
    const metrics = await promClient.register.metrics();
    res.send(metrics);
  } catch (error) {
    res.status(500).send('Error collecting metrics');
  }
});

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent')
  });
  next();
});

// Swagger API Documentation
app.use('/api-docs', internalAuthGuard, swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
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
app.get('/api-docs.json', internalAuthGuard, (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

app.post('/internal/send', internalAuthGuard, async (req: Request, res: Response) => {
  try {
    await handleEvent('notification.send', req.body);
    return res.json(successResponse());
  } catch (error: any) {
    logger.error('Internal direct notification failed', { error: error.message });
    return res.status(500).json(errorResponse('Internal direct notification failed'));
  }
});

app.post('/internal/events/:routingKey', internalAuthGuard, async (req: Request, res: Response) => {
  const routingKey = String(req.params.routingKey || '').replace(/_/g, '.');
  try {
    await handleEvent(routingKey, req.body);
    return res.json(successResponse());
  } catch (error: any) {
    logger.error('Internal event handling failed', {
      routingKey,
      error: error.message,
    });
    return res.status(500).json(errorResponse('Internal event handling failed'));
  }
});

app.get('/', (_req: Request, res: Response) => {
  res.json({
    service: 'govconnect-notification-service',
    version: '1.0.0',
    status: 'running',
    docs: '/api-docs',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'govconnect-notification-service',
    timestamp: new Date().toISOString()
  });
});

app.get('/health/database', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    logger.error('Database health check failed', { error: error.message });
    res.status(503).json({
      status: 'error',
      database: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

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
