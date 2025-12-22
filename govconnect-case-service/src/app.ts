import express, { Application } from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import promClient from 'prom-client';
import complaintRoutes from './routes/complaint.routes';
import reservationRoutes from './routes/reservation.routes';
import statisticsRoutes from './routes/statistics.routes';
import healthRoutes from './routes/health.routes';
import userRoutes from './routes/user.routes';
import { createGraphQLRouter } from './routes/graphql.routes';
import { errorHandler, notFoundHandler } from './middleware/error-handler.middleware';
import { swaggerSpec } from './config/swagger';
import logger from './utils/logger';
import { initializeServices } from './services/reservation.service';

// Initialize Prometheus default metrics
promClient.collectDefaultMetrics({
  prefix: 'govconnect_',
  labels: { service: 'case-service' },
});

const app: Application = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Prometheus Metrics endpoint
app.get('/metrics', async (req, res) => {
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

// Register routes
app.use('/health', healthRoutes);
app.use('/laporan', complaintRoutes);
app.use('/reservasi', reservationRoutes);
app.use('/statistics', statisticsRoutes);
app.use('/user', userRoutes);

// Swagger API Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
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
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'GovConnect Case Service',
    version: '2.0.0',
    status: 'running',
    docs: '/api-docs',
    graphql: '/graphql',
    endpoints: {
      health: '/health',
      complaints: '/laporan',
      reservations: '/reservasi',
      services: '/reservasi/services',
      statistics: '/statistics',
      user: '/user/:wa_user_id/history',
      graphql: '/graphql'
    }
  });
});

// Export async initialization function
// IMPORTANT: This must be called BEFORE error handlers are registered
export async function initializeApp() {
  try {
    // Initialize government services
    await initializeServices();
    logger.info('Government services initialized');
    
    // Initialize GraphQL API
    const graphqlRouter = await createGraphQLRouter();
    app.use('/graphql', graphqlRouter);
    logger.info('GraphQL API mounted at /graphql');
    
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
