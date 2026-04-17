import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import promClient from 'prom-client';
import complaintRoutes from './routes/complaint.routes';
import statisticsRoutes from './routes/statistics.routes';
import healthRoutes from './routes/health.routes';
import userRoutes from './routes/user.routes';
import serviceCatalogRoutes from './routes/service-catalog.routes';
import complaintMetaRoutes from './routes/complaint-meta.routes';
import { errorHandler, notFoundHandler } from './middleware/error-handler.middleware';
import { config } from './config/env';
import { swaggerSpec } from './config/swagger';
import { internalApiKeyMatches } from './utils/internal-auth';
import logger from './utils/logger';

// Initialize Prometheus default metrics
promClient.collectDefaultMetrics({
  prefix: 'govconnect_',
  labels: { service: 'case-service' },
});

const app: Application = express();

// Middleware
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
app.use(helmet());

// Correlation ID middleware — must be before routes
import { correlationMiddleware } from './shared/correlation-context';
app.use(correlationMiddleware);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Fase 1.7: Internal auth guard for sensitive endpoints
const internalAuthGuard = (req: any, res: any, next: any) => {
  const apiKey = req.headers['x-internal-api-key'];
  if (!internalApiKeyMatches(apiKey, config.internalApiKey)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
};

// Prometheus Metrics endpoint (Fase 1.7: protected)
app.get('/metrics', internalAuthGuard, async (req, res) => {
  try {
    res.set('Content-Type', promClient.register.contentType);
    const metrics = await promClient.register.metrics();
    res.send(metrics);
  } catch (error) {
    res.status(500).send('Error collecting metrics');
  }
});

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
  next();
});

// Rate limiting for write endpoints
const writeRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Register routes
app.use('/health', healthRoutes);
app.use('/laporan', writeRateLimit, complaintRoutes);
app.use('/', serviceCatalogRoutes);
app.use('/', complaintMetaRoutes);
app.use('/statistics', statisticsRoutes);
app.use('/user', userRoutes);

// Swagger API Documentation (Fase 1.7: disabled in production, auth-gated otherwise)
if (process.env.NODE_ENV !== 'production') {
app.use('/api-docs', internalAuthGuard, swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  explorer: true,
  customSiteTitle: 'GovConnect Case Service API',
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
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});
} // end if NODE_ENV !== 'production'

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'GovConnect Case Service',
    version: '2.0.0',
    status: 'running',
    docs: '/api-docs',
    endpoints: {
      health: '/health',
      complaints: '/laporan',
      statistics: '/statistics',
      user: '/user/:wa_user_id/history'
    }
  });
});

// Export async initialization function
// IMPORTANT: This must be called BEFORE error handlers are registered
export async function initializeApp() {
  try {
    // Register error handlers AFTER all routes are set up
    app.use(notFoundHandler);
    app.use(errorHandler);
    logger.info('Error handlers registered');
  } catch (err: any) {
    logger.error('Failed to initialize app', { error: err.message });
    throw err;
  }
}

export default app;
