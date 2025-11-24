import amqp from 'amqplib';
import logger from '../utils/logger';
import { config } from '../config/env';
import { rabbitmqConfig } from '../config/rabbitmq';

let connection: any = null;
let channel: any = null;

/**
 * Connect to RabbitMQ
 */
export async function connectRabbitMQ(): Promise<void> {
  try {
    connection = await amqp.connect(config.RABBITMQ_URL);
    channel = await connection.createChannel();

    // Declare exchange
    await channel.assertExchange(
      rabbitmqConfig.EXCHANGE_NAME,
      rabbitmqConfig.EXCHANGE_TYPE,
      { durable: rabbitmqConfig.OPTIONS.durable }
    );

    logger.info('✅ RabbitMQ connected successfully', {
      exchange: rabbitmqConfig.EXCHANGE_NAME,
    });

    // Handle connection errors
    connection.on('error', (err: Error) => {
      logger.error('RabbitMQ connection error', { error: err.message });
    });

    connection.on('close', () => {
      logger.warn('RabbitMQ connection closed');
    });
  } catch (error: any) {
    logger.error('❌ RabbitMQ connection failed', { error: error.message });
    throw error;
  }
}

/**
 * Publish event to RabbitMQ exchange
 */
export async function publishEvent(routingKey: string, payload: any): Promise<void> {
  if (!channel) {
    logger.error('RabbitMQ channel not initialized');
    throw new Error('RabbitMQ channel not available');
  }

  try {
    const message = Buffer.from(JSON.stringify(payload));
    
    channel.publish(
      rabbitmqConfig.EXCHANGE_NAME,
      routingKey,
      message,
      { persistent: rabbitmqConfig.OPTIONS.persistent }
    );

    logger.info('Event published', { routingKey, payload });
  } catch (error: any) {
    logger.error('Failed to publish event', {
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
  try {
    if (channel) await channel.close();
    if (connection) await connection.close();
    logger.info('RabbitMQ disconnected');
  } catch (error: any) {
    logger.error('Error disconnecting RabbitMQ', { error: error.message });
  }
}

/**
 * Get connection status
 */
export function isConnected(): boolean {
  return connection !== null && channel !== null;
}
