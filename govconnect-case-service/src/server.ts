import 'dotenv/config';
import app, { initializeApp } from './app';
import { config } from './config/env';
import { connectRabbitMQ, disconnectRabbitMQ } from './services/rabbitmq.service';
import prisma from './config/database';
import logger from './utils/logger';

const PORT = config.port;

/**
 * Start server
 */
async function startServer() {
  try {
    // Connect to database
    await prisma.$connect();
    logger.info('✅ Database connected');
    
    // Connect to RabbitMQ
    await connectRabbitMQ();
    
    // Initialize app (routes, services, etc.)
    await initializeApp();
    
    // Start Express server
    const server = app.listen(PORT, () => {
      logger.info(`🚀 Case Service running on port ${PORT}`);
      logger.info(`📍 Environment: ${config.nodeEnv}`);
      logger.info(`📍 Health check: http://localhost:${PORT}/health`);
    });

    return server;
  } catch (error: any) {
    logger.error('❌ Failed to start server', { error: error.message });
    process.exit(1);
  }
}

/**
 * Graceful shutdown
 */
async function gracefulShutdown(signal: string, server?: any) {
  logger.info(`🛑 ${signal} received, shutting down gracefully...`);
  
  try {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err: any) => {
          if (err) reject(err);
          else resolve();
        });
      });
      logger.info('✅ Server connection closed');
    }

    // Disconnect RabbitMQ
    await disconnectRabbitMQ();
    
    // Disconnect database
    await prisma.$disconnect();
    logger.info('✅ Database disconnected');
    
    logger.info('👋 Server shut down successfully');
    process.exit(0);
  } catch (error: any) {
    logger.error('❌ Error during shutdown', { error: error.message });
    process.exit(1);
  }
}

// Handle signals
let server: any;
startServer().then(s => server = s);

process.on('SIGTERM', () => gracefulShutdown('SIGTERM', server));
process.on('SIGINT', () => gracefulShutdown('SIGINT', server));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('❌ Uncaught Exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason: any) => {
  logger.error('❌ Unhandled Rejection', { reason: reason?.message || reason, stack: reason?.stack });
  // Don't exit on unhandled rejections - log and continue
  // This prevents crash loops from transient DB/network errors
});

// Start the server
startServer();
