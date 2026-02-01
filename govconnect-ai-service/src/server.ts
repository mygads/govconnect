import 'dotenv/config';
import app from './app';
import logger from './utils/logger';
import { config } from './config/env';
import { connectRabbitMQ, startConsuming, disconnectRabbitMQ } from './services/rabbitmq.service';
import { processTwoLayerMessage } from './services/two-layer-orchestrator.service';
import { processMessageWithNLU } from './services/nlu-message-processor.service';
import { initializeOptimizer } from './services/ai-optimizer.service';

// Feature flag to enable NLU-based message processing
// Set USE_NLU_PROCESSOR=true to use the new NLU-based processor
const USE_NLU_PROCESSOR = process.env.USE_NLU_PROCESSOR === 'true';

let server: any;

async function startServer() {
  try {
    logger.info('🚀 Starting AI Orchestrator Service...', {
      env: config.nodeEnv,
      port: config.port,
    });
    
    // Initialize AI Optimizer (cache pre-warming, etc.)
    initializeOptimizer();
    
    // Connect to RabbitMQ
    await connectRabbitMQ();
    
    // Full LLM mode: select processor based on feature flag
    const processorName = USE_NLU_PROCESSOR ? 'processMessageWithNLU (New NLU)' : 'processTwoLayerMessage (2-Layer)';
    const processor = USE_NLU_PROCESSOR ? processMessageWithNLU : processTwoLayerMessage;
    
    logger.info('🏗️ Architecture selected', {
      architecture: USE_NLU_PROCESSOR ? 'NLU-based (new)' : '2-Layer LLM',
      processor: processorName,
      featureFlag: 'USE_NLU_PROCESSOR=' + (USE_NLU_PROCESSOR ? 'true' : 'false'),
    });
    
    await startConsuming(processor);
    
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
    
    // Disconnect RabbitMQ
    await disconnectRabbitMQ();
    
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
