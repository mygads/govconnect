import amqp from 'amqplib';
import logger from '../utils/logger';
import { config } from '../config/env';
import { rabbitmqConfig } from '../config/rabbitmq';
import { sendTextMessage } from './wa.service';
import { saveOutgoingMessage } from './message.service';
import { updateConversation, markConversationAsRead, clearAIStatus, setAIError } from './takeover.service';

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

/**
 * AI Reply Event payload interface
 */
interface AIReplyEvent {
  wa_user_id: string;
  reply_text: string;
  guidance_text?: string;  // Optional second message for guidance/follow-up
  intent?: string;
  complaint_id?: string;
}

/**
 * Start consuming AI reply events
 */
export async function startConsumingAIReply(): Promise<void> {
  if (!channel) {
    logger.error('RabbitMQ channel not initialized');
    throw new Error('RabbitMQ channel not available');
  }

  try {
    const queueName = rabbitmqConfig.QUEUES.CHANNEL_AI_REPLY;
    const routingKey = rabbitmqConfig.ROUTING_KEYS.AI_REPLY;

    // Declare queue
    await channel.assertQueue(queueName, { durable: true });

    // Bind queue to exchange with routing key
    await channel.bindQueue(
      queueName,
      rabbitmqConfig.EXCHANGE_NAME,
      routingKey
    );

    logger.info('🎧 Started consuming AI reply events', {
      queue: queueName,
      routingKey,
    });

    // Consume messages
    channel.consume(queueName, async (msg: any) => {
      if (!msg) return;

      try {
        const payload: AIReplyEvent = JSON.parse(msg.content.toString());
        
        // Normalize and format text for WhatsApp
        const formatText = (text: string): string => {
          if (!text) return text;
          
          // First, convert any escaped \n to actual newlines
          let formatted = text.replace(/\\n/g, '\n');
          
          // If text contains emoji list items without newlines, add them
          // Detect pattern: emoji + text immediately followed by another emoji
          // e.g., "📋 Item 1📋 Item 2" -> "📋 Item 1\n\n📋 Item 2"
          const emojiPattern = /([\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}])/gu;
          
          // Check if text contains multiple emojis without proper spacing
          const emojis = formatted.match(emojiPattern);
          if (emojis && emojis.length > 1) {
            // Add double newline before each emoji that follows text without newline
            formatted = formatted.replace(/([^\n])(📋|🎫|📍|🔍|💡|✅|⚠️|📝|🕐|•)/g, '$1\n\n$2');
          }
          
          return formatted;
        };
        
        const replyText = formatText(payload.reply_text);
        const guidanceText = formatText(payload.guidance_text || '');
        
        logger.info('📨 AI reply event received', {
          wa_user_id: payload.wa_user_id,
          intent: payload.intent,
          messageLength: replyText?.length,
          hasGuidance: !!guidanceText,
          guidancePreview: guidanceText?.substring(0, 100),
        });

        // Send main reply message via WhatsApp
        const result = await sendTextMessage(payload.wa_user_id, replyText);

        if (result.success) {
          // Save outgoing message to database
          await saveOutgoingMessage({
            wa_user_id: payload.wa_user_id,
            message_id: result.message_id || `ai_reply_${Date.now()}`,
            message_text: replyText,
            source: 'AI',
          });

          logger.info('✅ AI reply sent successfully', {
            wa_user_id: payload.wa_user_id,
            message_id: result.message_id,
          });
          
          // If there's a guidance message, send it as a separate bubble after a short delay
          if (guidanceText && guidanceText.trim()) {
            // Small delay to ensure messages appear in order
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const guidanceResult = await sendTextMessage(payload.wa_user_id, guidanceText);
            
            if (guidanceResult.success) {
              // Save guidance message to database
              await saveOutgoingMessage({
                wa_user_id: payload.wa_user_id,
                message_id: guidanceResult.message_id || `ai_guidance_${Date.now()}`,
                message_text: guidanceText,
                source: 'AI',
              });
              
              logger.info('✅ AI guidance message sent successfully', {
                wa_user_id: payload.wa_user_id,
                message_id: guidanceResult.message_id,
              });
            } else {
              logger.warn('⚠️ Failed to send AI guidance message', {
                wa_user_id: payload.wa_user_id,
                error: guidanceResult.error,
              });
            }
          }

          // Update conversation summary with AI response and mark as read (AI handled it)
          await updateConversation(payload.wa_user_id, replyText, undefined, false);
          await markConversationAsRead(payload.wa_user_id);
          await clearAIStatus(payload.wa_user_id);
        } else {
          logger.error('❌ Failed to send AI reply', {
            wa_user_id: payload.wa_user_id,
            error: result.error,
          });
        }

        // Acknowledge message
        channel.ack(msg);
      } catch (error: any) {
        logger.error('Error processing AI reply event', {
          error: error.message,
        });
        // Nack and don't requeue to avoid infinite loop
        channel.nack(msg, false, false);
      }
    });
  } catch (error: any) {
    logger.error('Failed to start consuming AI reply events', {
      error: error.message,
    });
    throw error;
  }
}

/**
 * AI Error Event payload interface
 */
interface AIErrorEvent {
  wa_user_id: string;
  error_message: string;
  message_id?: string;
}

/**
 * Start consuming AI error events
 */
export async function startConsumingAIError(): Promise<void> {
  if (!channel) {
    logger.error('RabbitMQ channel not initialized');
    throw new Error('RabbitMQ channel not available');
  }

  try {
    const queueName = rabbitmqConfig.QUEUES.CHANNEL_AI_ERROR;
    const routingKey = rabbitmqConfig.ROUTING_KEYS.AI_ERROR;

    // Declare queue
    await channel.assertQueue(queueName, { durable: true });

    // Bind queue to exchange with routing key
    await channel.bindQueue(
      queueName,
      rabbitmqConfig.EXCHANGE_NAME,
      routingKey
    );

    logger.info('🎧 Started consuming AI error events', {
      queue: queueName,
      routingKey,
    });

    // Consume messages
    channel.consume(queueName, async (msg: any) => {
      if (!msg) return;

      try {
        const payload: AIErrorEvent = JSON.parse(msg.content.toString());
        
        logger.info('📨 AI error event received', {
          wa_user_id: payload.wa_user_id,
          error_message: payload.error_message,
        });

        // Set AI error status in conversation
        await setAIError(payload.wa_user_id, payload.error_message, payload.message_id);

        logger.info('⚠️ AI error status set for conversation', {
          wa_user_id: payload.wa_user_id,
        });

        // Acknowledge message
        channel.ack(msg);
      } catch (error: any) {
        logger.error('Error processing AI error event', {
          error: error.message,
        });
        // Nack and don't requeue to avoid infinite loop
        channel.nack(msg, false, false);
      }
    });
  } catch (error: any) {
    logger.error('Failed to start consuming AI error events', {
      error: error.message,
    });
    throw error;
  }
}
