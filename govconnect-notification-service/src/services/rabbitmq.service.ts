import amqp, { Channel, ConsumeMessage } from 'amqplib';
import axios from 'axios';
import config from '../config/env';
import { RABBITMQ_CONFIG } from '../config/rabbitmq';
import logger from '../utils/logger';

let connection: any = null;
let channel: Channel | null = null;

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

export async function connectRabbitMQ(): Promise<void> {
  try {
    await ensureRabbitMqVhost(config.rabbitmqUrl);
    logger.info('Connecting to RabbitMQ...', { url: config.rabbitmqUrl });

    const conn = await amqp.connect(config.rabbitmqUrl);
    connection = conn;
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

    // Handle connection errors
    connection.on('error', (err: any) => {
      logger.error('RabbitMQ connection error:', err);
    });

    connection.on('close', () => {
      logger.warn('RabbitMQ connection closed');
    });

  } catch (error: any) {
    logger.error('Failed to connect to RabbitMQ:', error);
    throw error;
  }
}

export async function startConsumer(
  handler: (routingKey: string, message: any) => Promise<void>
): Promise<void> {
  if (!channel) {
    throw new Error('RabbitMQ channel not initialized');
  }

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
    logger.error('Error closing RabbitMQ connection:', error);
  }
}

export function isConnected(): boolean {
  return connection !== null && channel !== null;
}
