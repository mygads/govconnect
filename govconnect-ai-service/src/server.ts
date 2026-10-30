import 'dotenv/config';
import app from './app';
import logger from './utils/logger';
import { config } from './config/env';
import { connectRabbitMQ, startConsuming, disconnectRabbitMQ } from './services/rabbitmq.service';
import { processMessage } from './services/ai-orchestrator.service';
import { drainActiveProcessing } from './services/unified-message-processor.service';
import { clearAllTimers } from './utils/timer-registry';
import { getAllAIGatewayInfoAsync } from './services/ai-gateway.service';
import { startDocumentOcrWorker } from './services/document-ingest.service';
import { installMicroAssessor } from './pipeline/micro-assessor';
import { assertVaultKeyConfigured } from './pipeline/pii-vault';
import { startLaporDrainScheduler } from './pipeline/lapor-bridge';
import { startKbSuggesterScheduler } from './services/kb-suggester-scheduler';

// UNIFIED PROCESSOR - same architecture for WhatsApp and Webchat
// No more pattern matching, full LLM understanding

let server: any;

async function startServer() {
  try {
    // Track A2: fail-closed NIK vault guard FIRST — refuse to boot in
    // production without a valid NIK_VAULT_KEY. Local/dev may opt into
    // explicit degraded mode via NIK_VAULT_ALLOW_INSECURE_MEMORY=true.
    assertVaultKeyConfigured();

    // Track A2: install the micro-assessor's LLM hook once at startup so
    // fuzzy stage transitions in v2 get LLM assessment with deterministic
    // fallback (best-effort; gateway failures degrade gracefully).
    installMicroAssessor();

    const gateways = await getAllAIGatewayInfoAsync();

    logger.info('🚀 Starting AI Orchestrator Service...', {
      env: config.nodeEnv,
      port: config.port,
      gateways,
      rerankEnabled: config.rerankEnabled,
    });
    
    // Connect to RabbitMQ
    await connectRabbitMQ();
    
    // Use UNIFIED processor (same as webchat - full LLM, no pattern matching)
    logger.info('🏗️ Architecture: UNIFIED PROCESSOR (same as Webchat)', {
      processor: 'processMessage → processUnifiedMessage',
    });
    
    await startConsuming(processMessage);
    startDocumentOcrWorker();
    // W17: start the LAPOR! outbox drain scheduler (no-op unless LAPOR_ENABLED).
    startLaporDrainScheduler();
    // R5: start the KB suggester scheduler (no-op unless KB_SUGGESTER_ENABLED).
    startKbSuggesterScheduler();

    // Start Express server (for health checks)
    server = app.listen(config.port, () => {
      logger.info('✅ Server started', {
        port: config.port,
        env: config.nodeEnv,
      });
      logger.info('🎧 Listening for whatsapp.message.received events');
    });
    
    // Graceful shutdown
    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
  } catch (error: any) {
    logger.error('❌ Failed to start server', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

async function gracefulShutdown() {
  logger.info('🛑 Graceful shutdown initiated...');
  
  try {
    // Stop accepting new connections
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => {
          logger.info('Express server closed');
          resolve();
        });
      });
    }

    // Wait for in-flight message processing to complete (max 15s)
    await drainActiveProcessing(15_000);
    
    // Disconnect RabbitMQ
    await disconnectRabbitMQ();
    
    // Clear all registered interval timers
    clearAllTimers();
    
    logger.info('✅ Graceful shutdown completed');
    process.exit(0);
  } catch (error: any) {
    logger.error('Error during shutdown', {
      error: error.message,
    });
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', {
    error: error.message,
    stack: error.stack,
  });
  // Only exit on critical errors, not recoverable ones
  if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason: any, promise) => {
  logger.error('Unhandled Rejection', {
    reason: reason?.message || reason,
    stack: reason?.stack,
  });
  // Don't exit on unhandled rejections - log and continue
  // This prevents crash loops from transient errors
});

// Start the server
startServer();
