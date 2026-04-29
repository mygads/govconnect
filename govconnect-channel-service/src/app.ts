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
import { config } from './config/env';
import { internalApiKeyMatches } from './utils/internal-auth';
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

  // SEC-02 fix: fail-closed CORS — reject if ALLOWED_ORIGINS not configured
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()).filter(Boolean);
  if (!allowedOrigins || allowedOrigins.length === 0) {
    console.warn('⚠️  ALLOWED_ORIGINS not set — CORS will reject all cross-origin requests');
  }
  app.use(cors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins && allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
  }));

  // Correlation ID middleware — must be before routes
  const { correlationMiddleware } = require('./shared/correlation-context');
  app.use(correlationMiddleware);

  // Body parser — capture raw body so webhook HMAC verification can re-hash exactly what was sent.
  app.use(express.json({
    limit: '10mb',
    verify: (req: any, _res, buf) => {
      if (buf && buf.length) req.rawBody = Buffer.from(buf);
    },
  }));
  app.use(express.urlencoded({
    extended: true,
    limit: '10mb',
    verify: (req: any, _res, buf) => {
      if (buf && buf.length) req.rawBody = Buffer.from(buf);
    },
  }));

  // Legacy local media serving for backward compatibility with older records.
  // SEC-05 fix: require internal API key for uploaded media
  const internalAuthGuard = (req: any, res: any, next: any) => {
    const apiKey = req.headers['x-internal-api-key'];
    if (!internalApiKeyMatches(apiKey, config.INTERNAL_API_KEY)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
  app.use('/uploads', internalAuthGuard, express.static(LEGACY_MEDIA_UPLOADS_PATH, {
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

  // Prometheus Metrics endpoint (Fase 1.7: protected with internal auth)
  app.get('/metrics', internalAuthGuard, metricsHandler);

  // Metrics middleware — MUST be before routes to track all requests
  app.use(metricsMiddleware('channel-service'));

  // Routes
  app.use('/webhook', webhookRoutes);
  app.use('/internal', internalRoutes);
  app.use('/health', healthRoutes);

  // Swagger API Documentation (Fase 1.7: protected — disabled in production, auth-gated otherwise)
  if (process.env.NODE_ENV !== 'production') {
    app.use('/api-docs', internalAuthGuard, swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
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
  app.get('/api-docs.json', internalAuthGuard, (req, res) => {
    void req;
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
  } // end if NODE_ENV !== 'production'

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
