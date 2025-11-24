import { createApp } from './app';
import { config } from './config/env';
import { connectRabbitMQ, disconnectRabbitMQ } from './services/rabbitmq.service';
import logger from './utils/logger';
import prisma from './config/database';

/**
 * Start server
 */
async function startServer() {
  try {
    // Connect to RabbitMQ
    await connectRabbitMQ();

    // Create Express app
    const app = createApp();

    // Start server
    const server = app.listen(config.PORT, () => {
      logger.info(`🚀 Server started on port ${config.PORT}`, {
        env: config.NODE_ENV,
        port: config.PORT,
      });
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received, shutting down gracefully...`);

      server.close(async () => {
        logger.info('HTTP server closed');

        // Disconnect RabbitMQ
        await disconnectRabbitMQ();

        // Disconnect Prisma
        await prisma.$disconnect();

        logger.info('All connections closed');
        process.exit(0);
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    // Listen for termination signals
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error: any) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
}

// Start the server
startServer();
