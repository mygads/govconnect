import { createApp } from './app';
import { config } from './config/env';
import { connectRabbitMQ, disconnectRabbitMQ, startConsumingAIReply, startConsumingAIError, startConsumingMessageStatus, startConsumingComplaintEvents, isRabbitMQConnected } from './services/rabbitmq.service';
import { loadSettingsFromDatabase } from './services/wa.service';
import { cleanupOldMessages } from './services/pending-message.service';
import { flushAllBatches } from './services/message-batcher.service';
import { reconcileWhatsAppSessionsBatch } from './services/wa-reconciliation.service';
import logger from './utils/logger';
import prisma from './config/database';

/**
 * Start server
 */
async function startServer() {
  try {
    // Load settings from database
    await loadSettingsFromDatabase();

    // Start periodic cleanup of old pending messages
    setInterval(async () => {
      try {
        await cleanupOldMessages();
      } catch (e) {
        // Ignore cleanup errors
      }
    }, 60 * 60 * 1000); // Every hour

    let waReconciliationRunning = false;
    const runWaReconciliation = async () => {
      if (waReconciliationRunning) return;
      waReconciliationRunning = true;
      try {
        const result = await reconcileWhatsAppSessionsBatch(config.WA_RECONCILIATION_BATCH_SIZE);
        if (result.checked > 0) {
          logger.info('WhatsApp reconciliation batch completed', {
            checked: result.checked,
            failed: result.failed,
          });
        }
      } catch (error: any) {
        logger.warn('WhatsApp reconciliation batch failed', { error: error.message });
      } finally {
        waReconciliationRunning = false;
      }
    };

    let waReconciliationInterval: NodeJS.Timeout | null = null;
    if (config.WA_RECONCILIATION_ENABLED) {
      void runWaReconciliation();
      waReconciliationInterval = setInterval(() => {
        void runWaReconciliation();
      }, config.WA_RECONCILIATION_INTERVAL_MS);
    }

    // Create Express app
    const app = createApp();

    // Start server
    const server = app.listen(config.PORT, () => {
      logger.info(`🚀 Server started on port ${config.PORT}`, {
        env: config.NODE_ENV,
        port: config.PORT,
      });
    });

    // RabbitMQ init in background (do not block HTTP server)
    const startRabbitMQConsumers = async () => {
      try {
        await connectRabbitMQ();
        await startConsumingAIReply();
        await startConsumingAIError();
        await startConsumingMessageStatus();
        await startConsumingComplaintEvents();
        logger.info('✅ RabbitMQ consumers started');
      } catch (error: any) {
        logger.warn('RabbitMQ init failed, will retry', { error: error.message });
      }
    };

    void startRabbitMQConsumers();
    const rabbitRetryInterval = setInterval(() => {
      if (!isRabbitMQConnected()) {
        void startRabbitMQConsumers();
      }
    }, 15000);

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received, shutting down gracefully...`);

      server.close(async () => {
        logger.info('HTTP server closed');

        clearInterval(rabbitRetryInterval);
        if (waReconciliationInterval) clearInterval(waReconciliationInterval);

        // Flush all pending message batches before shutdown
        await flushAllBatches();

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
