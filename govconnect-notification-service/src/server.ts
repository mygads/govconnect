import app from './app';
import config from './config/env';
import logger from './utils/logger';
import prisma from './config/database';
import { connectRabbitMQ, startConsumer, disconnectRabbitMQ } from './services/rabbitmq.service';
import { handleEvent } from './handlers/event.handler';

async function startServer() {
  try {
    logger.info('🚀 Starting GovConnect Notification Service...');

    // Connect to database
    await prisma.$connect();
    logger.info('✅ Database connected successfully');

    const startEventConsumer = async () => {
      try {
        await connectRabbitMQ();
        await startConsumer(handleEvent);
        logger.info('✅ Event consumer started');
      } catch (error: any) {
        logger.warn('RabbitMQ event consumer unavailable; HTTP fallback remains active', {
          error: error.message,
        });
      }
    };

    void startEventConsumer();

    // Start HTTP server
    const server = app.listen(config.port, () => {
      logger.info(`✅ Server started on port ${config.port}`);
      logger.info(`Environment: ${config.nodeEnv}`);
      logger.info(`Health check: http://localhost:${config.port}/health`);
    });

    // Graceful shutdown
    const gracefulShutdown = async (signal: string) => {
      logger.info(`${signal} received. Starting graceful shutdown...`);

      server.close(async () => {
        logger.info('HTTP server closed');

        // Disconnect RabbitMQ
        await disconnectRabbitMQ();

        // Disconnect database
        await prisma.$disconnect();
        logger.info('Database disconnected');

        logger.info('✅ Graceful shutdown completed');
        process.exit(0);
      });

      // Force shutdown after 30 seconds
      setTimeout(() => {
        logger.error('Forceful shutdown due to timeout');
        process.exit(1);
      }, 30000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error: any) {
    logger.error('Failed to start server', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason: any, _promise) => {
  logger.error('Unhandled Rejection', { reason: reason?.message || reason, stack: reason?.stack });
  // Don't exit on unhandled rejections - log and continue
  // This prevents crash loops from transient DB/network errors
});

startServer();

