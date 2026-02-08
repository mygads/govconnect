import amqp, { Channel, ConsumeMessage } from 'amqplib';
import axios from 'axios';
import config from '../config/env';
import { RABBITMQ_CONFIG } from '../config/rabbitmq';
import logger from '../utils/logger';

let connection: any = null;
let channel: Channel | null = null;
let activeHandler: ((routingKey: string, message: any) => Promise<void>) | null = null;

let isReconnecting = false;
let isShuttingDown = false;
let reconnectAttempts = 0;

// Reconnection configuration with exponential backoff
const RECONNECT_CONFIG = {
  BASE_DELAY_MS: 1000,       // Initial delay: 1 second
  MAX_DELAY_MS: 30000,       // Max delay: 30 seconds
  MAX_ATTEMPTS: 0,           // 0 = infinite attempts
  JITTER_FACTOR: 0.3,        // 30% random jitter
};

/**
 * Calculate exponential backoff delay with jitter
 */
function calculateReconnectDelay(attempt: number): number {
  const exponentialDelay = RECONNECT_CONFIG.BASE_DELAY_MS * Math.pow(2, Math.min(attempt, 10));
  const jitter = exponentialDelay * RECONNECT_CONFIG.JITTER_FACTOR * Math.random();
  return Math.min(RECONNECT_CONFIG.MAX_DELAY_MS, exponentialDelay + jitter);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureRabbitMqVhost(rabbitmqUrl: string): Promise<void> {
  try {
    const parsed = new URL(rabbitmqUrl);
    const vhost = decodeURIComponent(parsed.pathname.replace(/^\//, '')) || '/';

    if (!vhost || vhost === '/') return;

    const managementUrl = process.env.RABBITMQ_MANAGEMENT_URL || `http://${parsed.hostname}:15672`;
    const username = decodeURIComponent(parsed.username || process.env.RABBITMQ_USER || '');
    const password = decodeURIComponent(parsed.password || process.env.RABBITMQ_PASSWORD || '');

    if (!username || !password) {
      logger.warn('RabbitMQ management credentials not set, skipping vhost check');
      return;
    }

    const auth = { username, password };
    const vhostUrl = `${managementUrl}/api/vhosts/${encodeURIComponent(vhost)}`;

    await axios.get(vhostUrl, { auth, timeout: 5000 }).catch(async (error: any) => {
      if (error.response?.status === 404) {
        await axios.put(vhostUrl, {}, { auth, timeout: 5000 });
        logger.info('RabbitMQ vhost created', { vhost });
        return;
      }
      throw error;
    });
  } catch (error: any) {
    logger.warn('Failed to ensure RabbitMQ vhost', { error: error.message });
  }
}

/**
 * Handle reconnection with exponential backoff
 */
async function handleReconnect(): Promise<void> {
  if (isReconnecting) {
    logger.debug('Reconnection already in progress, skipping...');
    return;
  }
  if (isShuttingDown) {
    logger.info('Shutdown in progress, skipping reconnect');
    return;
  }

  isReconnecting = true;

  while (!isShuttingDown) {
    reconnectAttempts++;
    const delay = calculateReconnectDelay(reconnectAttempts);

    logger.warn(`🔄 Attempting RabbitMQ reconnection (attempt ${reconnectAttempts})`, {
      delayMs: delay,
      attempt: reconnectAttempts,
    });

    await sleep(delay);

    try {
      await connectRabbitMQ();

      // Reconnect successful - restart consumer if handler exists
      if (activeHandler) {
        await startConsumer(activeHandler);
      }

      logger.info('✅ RabbitMQ reconnected successfully after ' + reconnectAttempts + ' attempts');
      reconnectAttempts = 0;
      isReconnecting = false;
      return;
    } catch (error: any) {
      logger.error('❌ RabbitMQ reconnection failed', {
        attempt: reconnectAttempts,
        error: error.message,
        nextDelayMs: calculateReconnectDelay(reconnectAttempts + 1),
      });

      // Check max attempts (0 = infinite)
      if (RECONNECT_CONFIG.MAX_ATTEMPTS > 0 && reconnectAttempts >= RECONNECT_CONFIG.MAX_ATTEMPTS) {
        logger.error('🚨 Max reconnection attempts reached, giving up');
        isReconnecting = false;
        throw new Error('RabbitMQ reconnection failed after max attempts');
      }
    }
  }

  isReconnecting = false;
}

export async function connectRabbitMQ(): Promise<void> {
  try {
    await ensureRabbitMqVhost(config.rabbitmqUrl);

    // Close existing connections if any
    if (channel) {
      try { await channel.close(); } catch (e) { /* ignore */ }
      channel = null;
    }
    if (connection) {
      try { await connection.close(); } catch (e) { /* ignore */ }
      connection = null;
    }

    logger.info('Connecting to RabbitMQ...', { url: config.rabbitmqUrl.replace(/\/\/.*@/, '//***@') });

    connection = await amqp.connect(config.rabbitmqUrl);
    channel = await connection.createChannel();

    // Assert exchange
    if (channel) {
      await channel.assertExchange(
        RABBITMQ_CONFIG.exchange,
        RABBITMQ_CONFIG.exchangeType,
        { durable: RABBITMQ_CONFIG.durable }
      );
    }

    logger.info('✅ RabbitMQ connected successfully');

    // Handle connection errors - trigger reconnect
    connection.on('error', (err: any) => {
      logger.error('RabbitMQ connection error:', { error: err.message });
    });

    connection.on('close', () => {
      logger.warn('RabbitMQ connection closed unexpectedly');
      if (!isShuttingDown && !isReconnecting) {
        connection = null;
        channel = null;
        handleReconnect().catch(err => {
          logger.error('Failed to handle reconnection', { error: err.message });
        });
      }
    });

    // Handle channel errors
    if (channel) {
      channel.on('error', (err: Error) => {
        logger.error('RabbitMQ channel error', { error: err.message });
      });

      channel.on('close', () => {
        logger.warn('RabbitMQ channel closed');
      });
    }

  } catch (error: any) {
    logger.error('Failed to connect to RabbitMQ:', { error: error.message });
    throw error;
  }
}

export async function startConsumer(
  handler: (routingKey: string, message: any) => Promise<void>
): Promise<void> {
  if (!channel) {
    throw new Error('RabbitMQ channel not initialized');
  }

  // Store handler for reconnection
  activeHandler = handler;

  // Create queue for this service
  const queueName = 'notification-service-queue';

  await channel.assertQueue(queueName, {
    durable: true,
    arguments: {
      'x-message-ttl': 86400000 // 24 hours
    }
  });

  // Bind queue to exchange with routing keys
  const routingKeys = Object.values(RABBITMQ_CONFIG.routingKeys);

  for (const routingKey of routingKeys) {
    await channel.bindQueue(queueName, RABBITMQ_CONFIG.exchange, routingKey);
    logger.info(`Queue bound to routing key: ${routingKey}`);
  }

  // Set prefetch to process one message at a time
  await channel.prefetch(1);

  logger.info(`✅ Consumer started on queue: ${queueName}`);

  // Start consuming
  await channel.consume(
    queueName,
    async (msg: ConsumeMessage | null) => {
      if (!msg) {
        return;
      }

      const routingKey = msg.fields.routingKey;
      const content = msg.content.toString();

      try {
        const data = JSON.parse(content);

        logger.info('Received event', {
          routingKey,
          data
        });

        // Process message
        await handler(routingKey, data);

        // Acknowledge message
        channel!.ack(msg);

        logger.info('Event processed successfully', { routingKey });

      } catch (error: any) {
        logger.error('Error processing message', {
          routingKey,
          error: error.message,
          content
        });

        // Reject message and requeue if not a parsing error
        if (error instanceof SyntaxError) {
          // Don't requeue if JSON is invalid
          channel!.nack(msg, false, false);
          logger.warn('Message rejected (invalid JSON)', { routingKey });
        } else {
          // Requeue for retry
          channel!.nack(msg, false, true);
          logger.warn('Message requeued for retry', { routingKey });
        }
      }
    },
    { noAck: false }
  );
}

export async function disconnectRabbitMQ(): Promise<void> {
  isShuttingDown = true;

  try {
    if (channel) {
      await channel.close();
      logger.info('RabbitMQ channel closed');
    }

    if (connection) {
      await connection.close();
      logger.info('RabbitMQ connection closed');
    }
  } catch (error: any) {
    logger.error('Error closing RabbitMQ connection:', { error: error.message });
  }
}

export function isConnected(): boolean {
  return connection !== null && channel !== null;
}
