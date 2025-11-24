import amqplib from 'amqplib';
import logger from '../utils/logger';
import { config } from '../config/env';
import { RABBITMQ_CONFIG } from '../config/rabbitmq';
import { MessageReceivedEvent, AIReplyEvent } from '../types/event.types';

let connection: any = null;
let channel: any = null;

/**
 * Connect to RabbitMQ
 */
export async function connectRabbitMQ(): Promise<void> {
  try {
    const conn: any = await amqplib.connect(config.rabbitmqUrl);
    connection = conn;
    channel = await conn.createChannel();
    
    // Assert exchange
    await channel.assertExchange(
      RABBITMQ_CONFIG.EXCHANGE_NAME,
      RABBITMQ_CONFIG.EXCHANGE_TYPE,
      { durable: true }
    );
    
    logger.info('✅ RabbitMQ connected successfully', {
      exchange: RABBITMQ_CONFIG.EXCHANGE_NAME,
    });
  } catch (error: any) {
    logger.error('❌ RabbitMQ connection failed', {
      error: error.message,
    });
    throw error;
  }
}

/**
 * Start consuming messages from queue
 */
export async function startConsuming(
  onMessage: (event: MessageReceivedEvent) => Promise<void>
): Promise<void> {
  if (!channel) {
    throw new Error('RabbitMQ channel not initialized');
  }
  
  try {
    // Assert queue
    const queue = await channel.assertQueue(
      RABBITMQ_CONFIG.QUEUE_NAME,
      RABBITMQ_CONFIG.QUEUE_OPTIONS
    );
    
    // Bind queue to exchange
    await channel.bindQueue(
      queue.queue,
      RABBITMQ_CONFIG.EXCHANGE_NAME,
      RABBITMQ_CONFIG.ROUTING_KEY_CONSUME
    );
    
    logger.info('🎧 Started consuming messages', {
      queue: queue.queue,
      routingKey: RABBITMQ_CONFIG.ROUTING_KEY_CONSUME,
    });
    
    // Set prefetch to process one message at a time
    await channel.prefetch(1);
    
    // Start consuming
    await channel.consume(
      queue.queue,
      async (msg: amqplib.ConsumeMessage | null) => {
        if (!msg) return;
        
        try {
          const content = msg.content.toString();
          const event: MessageReceivedEvent = JSON.parse(content);
          
          logger.info('📨 Message received from queue', {
            wa_user_id: event.wa_user_id,
            message_id: event.message_id,
          });
          
          // Process message
          await onMessage(event);
          
          // Acknowledge message
          channel!.ack(msg);
          
          logger.debug('✅ Message acknowledged', {
            message_id: event.message_id,
          });
        } catch (error: any) {
          logger.error('❌ Error processing message', {
            error: error.message,
          });
          
          // Reject and requeue (will retry)
          channel!.nack(msg, false, true);
        }
      },
      RABBITMQ_CONFIG.CONSUME_OPTIONS
    );
  } catch (error: any) {
    logger.error('❌ Failed to start consuming', {
      error: error.message,
    });
    throw error;
  }
}

/**
 * Publish AI reply event
 */
export async function publishAIReply(payload: AIReplyEvent): Promise<void> {
  if (!channel) {
    throw new Error('RabbitMQ channel not initialized');
  }
  
  try {
    const message = Buffer.from(JSON.stringify(payload));
    
    channel.publish(
      RABBITMQ_CONFIG.EXCHANGE_NAME,
      RABBITMQ_CONFIG.ROUTING_KEY_AI_REPLY,
      message,
      { persistent: true }
    );
    
    logger.info('📤 AI reply event published', {
      routingKey: RABBITMQ_CONFIG.ROUTING_KEY_AI_REPLY,
      wa_user_id: payload.wa_user_id,
    });
  } catch (error: any) {
    logger.error('❌ Failed to publish AI reply', {
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
    
    logger.info('🔌 RabbitMQ disconnected');
  } catch (error: any) {
    logger.error('Error disconnecting RabbitMQ', {
      error: error.message,
    });
  }
}

/**
 * Check if RabbitMQ is connected
 */
export function isConnected(): boolean {
  return connection !== null && channel !== null;
}
