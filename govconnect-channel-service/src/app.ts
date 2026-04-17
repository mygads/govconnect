import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import path from 'path';
import webhookRoutes from './routes/webhook.routes';
import internalRoutes from './routes/internal.routes';
import healthRoutes from './routes/health.routes';
import { errorHandler, notFoundHandler } from './middleware/error-handler.middleware';
import { metricsHandler, metricsMiddleware } from './middleware/metrics.middleware';
import { swaggerSpec } from './config/swagger';
import logger from './utils/logger';

// Legacy local uploads path retained only to serve older records.
const LEGACY_MEDIA_UPLOADS_PATH = path.join(process.cwd(), 'uploads');

/**
 * Create Express application
 */
export function createApp(): Application {
  const app = express();

  // Security middleware
  app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }, // Allow images to be loaded from other origins
  }));
  app.use(cors());

  // Body parser
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Legacy local media serving for backward compatibility with older records.
  app.use('/uploads', express.static(LEGACY_MEDIA_UPLOADS_PATH, {
    maxAge: '7d', // Cache for 7 days
    etag: true,
  }));

  // Request logging
  app.use((req, res, next) => {
    void res;
    logger.info('Incoming request', {
      method: req.method,
      path: req.path,
      ip: req.ip,
    });
    next();
  });

  // Prometheus Metrics endpoint (before metricsMiddleware to avoid tracking itself)
  app.get('/metrics', metricsHandler);

  // Metrics middleware — MUST be before routes to track all requests
  app.use(metricsMiddleware('channel-service'));

  // Routes
  app.use('/webhook', webhookRoutes);
  app.use('/internal', internalRoutes);
  app.use('/health', healthRoutes);

  // Swagger API Documentation
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    explorer: true,
    customSiteTitle: 'GovConnect Channel Service API',
    customCss: '.swagger-ui .topbar { display: none }',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'list',
      filter: true,
    },
  }));

  // OpenAPI spec as JSON
  app.get('/api-docs.json', (req, res) => {
    void req;
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  // Root endpoint
  app.get('/', (req, res) => {
    void req;
    res.json({
      service: 'GovConnect Channel Service',
      version: '1.0.0',
      status: 'running',
      docs: '/api-docs',
    });
  });

  // Also mount webhook at root for backward compatibility
  // This allows webhook URL to be just the domain without /webhook/whatsapp
  app.use('/', webhookRoutes);

  // Error handlers (must be last)
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
