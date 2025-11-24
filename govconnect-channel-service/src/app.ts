import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import webhookRoutes from './routes/webhook.routes';
import internalRoutes from './routes/internal.routes';
import healthRoutes from './routes/health.routes';
import { errorHandler, notFoundHandler } from './middleware/error-handler.middleware';
import logger from './utils/logger';

/**
 * Create Express application
 */
export function createApp(): Application {
  const app = express();

  // Security middleware
  app.use(helmet());
  app.use(cors());

  // Body parser
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Request logging
  app.use((req, res, next) => {
    logger.info('Incoming request', {
      method: req.method,
      path: req.path,
      ip: req.ip,
    });
    next();
  });

  // Routes
  app.use('/webhook', webhookRoutes);
  app.use('/internal', internalRoutes);
  app.use('/health', healthRoutes);

  // Root endpoint
  app.get('/', (req, res) => {
    res.json({
      service: 'GovConnect Channel Service',
      version: '1.0.0',
      status: 'running',
    });
  });

  // Error handlers (must be last)
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
