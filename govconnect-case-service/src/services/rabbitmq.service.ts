import amqplib from 'amqplib';
import axios from 'axios';
import logger from '../utils/logger';
import { config } from '../config/env';
import { RABBITMQ_CONFIG } from '../config/rabbitmq';
import { getCorrelationId } from '../shared/correlation-context';

let connection: any = null;
let channel: any = null;
let isReconnecting = false;
let isShuttingDown = false;
let isClosingStaleConnection = false;
let reconnectAttempts = 0;

const RECONNECT_CONFIG = {
  BASE_DELAY_MS: 1000,
  MAX_DELAY_MS: 30000,
  MAX_ATTEMPTS: 0,
  JITTER_FACTOR: 0.3,
};

function calculateReconnectDelay(attempt: number): number {
  const exponentialDelay = RECONNECT_CONFIG.BASE_DELAY_MS * Math.pow(2, Math.min(attempt, 10));
  const jitter = exponentialDelay * RECONNECT_CONFIG.JITTER_FACTOR * Math.random();
  return Math.min(RECONNECT_CONFIG.MAX_DELAY_MS, exponentialDelay + jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function startRabbitMQReconnect(): void {
  handleReconnect().catch((error: any) => {
    logger.error('RabbitMQ reconnect handler failed', { error: error.message });
  });
}

async function handleReconnect(): Promise<void> {
  if (isReconnecting) {
    logger.debug('RabbitMQ reconnection already in progress');
    return;
  }
  if (isShuttingDown) {
    logger.info('Shutdown in progress, skipping RabbitMQ reconnect');
    return;
  }

  isReconnecting = true;

  while (!isShuttingDown) {
    reconnectAttempts += 1;
    const delay = calculateReconnectDelay(reconnectAttempts);

    logger.warn('Attempting RabbitMQ reconnection', {
      attempt: reconnectAttempts,
      delayMs: delay,
    });

    await sleep(delay);
    if (isShuttingDown) break;

    try {
      await connectRabbitMQ();
      logger.info('RabbitMQ reconnected successfully', { attempts: reconnectAttempts });
      reconnectAttempts = 0;
      isReconnecting = false;
      return;
    } catch (error: any) {
      logger.error('RabbitMQ reconnection failed', {
        attempt: reconnectAttempts,
        error: error.message,
      });

      if (RECONNECT_CONFIG.MAX_ATTEMPTS > 0 && reconnectAttempts >= RECONNECT_CONFIG.MAX_ATTEMPTS) {
        logger.error('RabbitMQ max reconnection attempts reached');
        isReconnecting = false;
        throw new Error('RabbitMQ reconnection failed after max attempts');
      }
    }
  }

  isReconnecting = false;
}

async function closeStaleConnection(): Promise<void> {
  isClosingStaleConnection = true;
  const staleChannel = channel;
  const staleConnection = connection;
  channel = null;
  connection = null;

  try {
    if (staleChannel) await staleChannel.close();
  } catch {
    // Ignore stale channel close errors.
  }

  try {
    if (staleConnection) await staleConnection.close();
  } catch {
    // Ignore stale connection close errors.
  } finally {
    isClosingStaleConnection = false;
  }
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
 * Connect to RabbitMQ and assert exchange
 */
export async function connectRabbitMQ(): Promise<void> {
  try {
    isShuttingDown = false;
    await ensureRabbitMqVhost(config.rabbitmqUrl);
    await closeStaleConnection();

    const conn: any = await amqplib.connect(config.rabbitmqUrl);
    connection = conn;
    channel = await conn.createChannel();

    await channel.assertExchange(
      RABBITMQ_CONFIG.EXCHANGE_NAME,
      RABBITMQ_CONFIG.EXCHANGE_TYPE,
      { durable: true }
    );

    connection.on('error', (error: Error) => {
      logger.error('RabbitMQ connection error', { error: error.message });
    });

    connection.on('close', () => {
      logger.warn('RabbitMQ connection closed');
      connection = null;
      channel = null;
      if (!isShuttingDown && !isReconnecting && !isClosingStaleConnection) {
        handleReconnect().catch((error: any) => {
          logger.error('RabbitMQ reconnect handler failed', { error: error.message });
        });
      }
    });

    channel.on('error', (error: Error) => {
      logger.error('RabbitMQ channel error', { error: error.message });
    });

    channel.on('close', () => {
      logger.warn('RabbitMQ channel closed');
      channel = null;
    });

    reconnectAttempts = 0;
    logger.info('✅ RabbitMQ connected successfully', {
      exchange: RABBITMQ_CONFIG.EXCHANGE_NAME,
    });
  } catch (error: any) {
    connection = null;
    channel = null;
    logger.error('❌ RabbitMQ connection failed', {
      error: error.message,
    });
    throw error;
  }
}

/**
 * Publish event to RabbitMQ
 */
export async function publishEvent(routingKey: string, data: any): Promise<void> {
  const correlationId = getCorrelationId();
  const payload = correlationId
    ? {
        ...data,
        _meta: {
          ...(data?._meta || {}),
          correlation_id: correlationId,
        },
      }
    : data;

  if (!channel) {
    // Fallback: deliver directly to Notification Service internal endpoint
    // so async citizen updates still work when RabbitMQ local env is unstable.
    try {
      const fallbackRoutingKey = routingKey.replace(/\./g, '_');
      await axios.post(
        `${config.notificationServiceUrl}/internal/events/${fallbackRoutingKey}`,
        payload,
        {
          headers: {
            'x-internal-api-key': config.internalApiKey,
            ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
          },
          timeout: 10000,
        }
      );
      logger.warn('RabbitMQ unavailable, event delivered via HTTP fallback', {
        routingKey,
        notificationServiceUrl: config.notificationServiceUrl,
      });
      return;
    } catch (fallbackError: any) {
      logger.error('Event delivery failed: RabbitMQ unavailable and HTTP fallback failed', {
        routingKey,
        error: fallbackError.message,
      });
      throw new Error('RabbitMQ channel not initialized');
    }
  }
  
  try {
    const message = Buffer.from(JSON.stringify(payload));
    
    channel.publish(
      RABBITMQ_CONFIG.EXCHANGE_NAME,
      routingKey,
      message,
      {
        persistent: true,
        headers: {
          ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
        },
      }
    );
    
    logger.info('📤 Event published', {
      routingKey,
      data: payload,
    });
  } catch (error: any) {
    logger.error('❌ Failed to publish event', {
      routingKey,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Disconnect from RabbitMQ
 */
export async function disconnectRabbitMQ(): Promise<void> {
  isShuttingDown = true;

  try {
    await closeStaleConnection();
    logger.info('🔌 RabbitMQ disconnected');
  } catch (error: any) {
    logger.error('Error disconnecting RabbitMQ', {
      error: error.message,
    });
  } finally {
    connection = null;
    channel = null;
  }
}

/**
 * Check if RabbitMQ is connected
 */
export function isConnected(): boolean {
  const streamDestroyed = Boolean(connection?.connection?.stream?.destroyed);
  return Boolean(connection && channel && !isShuttingDown && !streamDestroyed);
}
