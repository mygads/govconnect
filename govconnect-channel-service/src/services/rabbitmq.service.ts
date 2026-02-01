import amqp from 'amqplib';
import axios from 'axios';
import logger from '../utils/logger';
import { config } from '../config/env';
import { rabbitmqConfig } from '../config/rabbitmq';
import { sendTextMessage } from './wa.service';
// NOTE: saveOutgoingMessage removed - AI Service now handles database storage via storeAIReplyInDatabase()
// This prevents duplicate messages in live chat dashboard
import { updateConversation, clearAIStatus, setAIError } from './takeover.service';
import { markMessagesAsCompleted, markMessageAsFailed } from './pending-message.service';

let connection: any = null;
let channel: any = null;
let isReconnecting = false;
let reconnectAttempts = 0;

// Reconnection configuration with exponential backoff
const RECONNECT_CONFIG = {
  BASE_DELAY_MS: 1000,       // Initial delay: 1 second
  MAX_DELAY_MS: 30000,       // Max delay: 30 seconds  
  MAX_ATTEMPTS: 0,           // 0 = infinite attempts
  JITTER_FACTOR: 0.3,        // 30% random jitter
};

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
 * Calculate exponential backoff delay with jitter
 */
function calculateReconnectDelay(attempt: number): number {
  const exponentialDelay = RECONNECT_CONFIG.BASE_DELAY_MS * Math.pow(2, Math.min(attempt, 10)); // Cap exponent at 10
  const jitter = exponentialDelay * RECONNECT_CONFIG.JITTER_FACTOR * Math.random();
  return Math.min(RECONNECT_CONFIG.MAX_DELAY_MS, exponentialDelay + jitter);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Handle reconnection with exponential backoff
 */
async function handleReconnect(): Promise<void> {
  if (isReconnecting) {
    logger.debug('Reconnection already in progress, skipping...');
    return;
  }
  
  isReconnecting = true;
  
  while (true) {
    reconnectAttempts++;
    const delay = calculateReconnectDelay(reconnectAttempts);
    
    logger.warn(`🔄 Attempting RabbitMQ reconnection (attempt ${reconnectAttempts})`, {
      delayMs: delay,
      attempt: reconnectAttempts,
    });
    
    await sleep(delay);
    
    try {
      await connectRabbitMQ({ logFailure: false });
      
      // Reconnect successful - restart consumers
      await startConsumingAIReply();
      await startConsumingAIError();
      await startConsumingMessageStatus();
      
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
}

/**
 * Connect to RabbitMQ with auto-reconnect capability
 */
export async function connectRabbitMQ(options?: { logFailure?: boolean }): Promise<void> {
  try {
    await ensureRabbitMqVhost(config.RABBITMQ_URL);
    // Close existing connections if any
    if (channel) {
      try { await channel.close(); } catch (e) { /* ignore */ }
      channel = null;
    }
    if (connection) {
      try { await connection.close(); } catch (e) { /* ignore */ }
      connection = null;
    }
    
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

    // Handle connection errors - trigger reconnect
    connection.on('error', (err: Error) => {
      logger.error('RabbitMQ connection error', { error: err.message });
      // Don't reconnect here - 'close' event will trigger it
    });

    connection.on('close', () => {
      logger.warn('RabbitMQ connection closed unexpectedly');
      // Trigger reconnection if not shutting down gracefully
      if (!isReconnecting && connection !== null) {
        connection = null;
        channel = null;
        handleReconnect().catch(err => {
          logger.error('Failed to handle reconnection', { error: err.message });
        });
      }
    });
    
    // Handle channel errors
    channel.on('error', (err: Error) => {
      logger.error('RabbitMQ channel error', { error: err.message });
    });
    
    channel.on('close', () => {
      logger.warn('RabbitMQ channel closed');
    });
    
  } catch (error: any) {
    if (options?.logFailure !== false) {
      logger.error('❌ RabbitMQ connection failed', { error: error.message });
    }
    throw error;
  }
}

/**
 * Connect to RabbitMQ on startup with retry/backoff.
 * This prevents the service from crashing if RabbitMQ isn't ready yet.
 */
export async function connectRabbitMQWithRetry(): Promise<void> {
  let attempt = 0;

  // Infinite attempts by default (keeps container alive until infra is ready)
  while (true) {
    attempt++;
    try {
      await connectRabbitMQ({ logFailure: false });
      return;
    } catch (error: any) {
      const delay = calculateReconnectDelay(attempt);
      logger.warn('RabbitMQ not ready yet, will retry connection', {
        attempt,
        delayMs: delay,
        error: error?.message,
      });
      await sleep(delay);
    }
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
 * Disconnect from RabbitMQ gracefully (prevents auto-reconnect)
 */
export async function disconnectRabbitMQ(): Promise<void> {
  try {
    // Mark as intentionally disconnecting to prevent auto-reconnect
    isReconnecting = true; // Prevents reconnect on close event
    
    if (channel) {
      await channel.close();
      channel = null;
    }
    if (connection) {
      await connection.close();
      connection = null;
    }
    
    logger.info('RabbitMQ disconnected gracefully');
  } catch (error: any) {
    logger.error('Error disconnecting RabbitMQ', { error: error.message });
  }
}

/**
 * Get connection status
 */
export function isConnected(): boolean {
  return connection !== null && channel !== null && !isReconnecting;
}

/**
 * Force reconnection (for manual trigger)
 */
export async function forceReconnect(): Promise<void> {
  logger.info('🔄 Force reconnection triggered');
  connection = null;
  channel = null;
  isReconnecting = false;
  reconnectAttempts = 0;
  await handleReconnect();
}

/**
 * AI Reply Event payload interface
 */
interface AIReplyEvent {
  village_id?: string;
  wa_user_id: string;
  reply_text: string;
  guidance_text?: string;  // Optional second message for guidance/follow-up
  intent?: string;
  complaint_id?: string;
  message_id?: string;     // Single message ID that was answered
  batched_message_ids?: string[];  // Message IDs that were answered
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
          village_id: payload.village_id,
          wa_user_id: payload.wa_user_id,
          intent: payload.intent,
          messageLength: replyText?.length,
          hasGuidance: !!guidanceText,
          guidancePreview: guidanceText?.substring(0, 100),
        });

        // Send main reply message via WhatsApp
        // NOTE: Message is already saved to database by AI Service via storeAIReplyInDatabase()
        // We only need to send to WhatsApp here - DO NOT save again to avoid duplicates!
        const result = await sendTextMessage(payload.wa_user_id, replyText, payload.village_id);

        if (result.success) {
          logger.info('✅ AI reply sent to WhatsApp successfully', {
            wa_user_id: payload.wa_user_id,
            message_id: result.message_id,
          });
          
          // If there's a guidance message, send it as a separate bubble after a short delay
          // NOTE: Guidance is also already saved by AI Service
          if (guidanceText && guidanceText.trim()) {
            // Small delay to ensure messages appear in order
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const guidanceResult = await sendTextMessage(payload.wa_user_id, guidanceText, payload.village_id);
            
            if (guidanceResult.success) {
              logger.info('✅ AI guidance message sent to WhatsApp successfully', {
                wa_user_id: payload.wa_user_id,
                message_id: guidanceResult.message_id,
              });
            } else {
              logger.warn('⚠️ Failed to send AI guidance message to WhatsApp', {
                wa_user_id: payload.wa_user_id,
                error: guidanceResult.error,
              });
            }
          }

          // Update conversation summary with AI response and reset unread count (AI handled it)
          await updateConversation(payload.wa_user_id, replyText, undefined, 'reset', payload.village_id);
          await clearAIStatus(payload.wa_user_id, payload.village_id);
          
          // Mark messages as completed - handle both single and batched messages
          const messageIdsToComplete: string[] = [];
          
          if (payload.message_id) {
            messageIdsToComplete.push(payload.message_id);
          }
          
          if (payload.batched_message_ids && payload.batched_message_ids.length > 0) {
            messageIdsToComplete.push(...payload.batched_message_ids);
          }
          
          if (messageIdsToComplete.length > 0) {
            try {
              await markMessagesAsCompleted(messageIdsToComplete);
              logger.info('✅ Messages marked as completed', {
                wa_user_id: payload.wa_user_id,
                count: messageIdsToComplete.length,
                messageIds: messageIdsToComplete,
              });
            } catch (e) {
              // Ignore - might not have pending messages
              logger.debug('No pending messages to mark complete', { wa_user_id: payload.wa_user_id });
            }
          }
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
  village_id?: string;
  wa_user_id: string;
  error_message: string;
  message_id?: string;
  batched_message_ids?: string[];
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
          village_id: payload.village_id,
          wa_user_id: payload.wa_user_id,
          error_message: payload.error_message,
          batched_message_ids: payload.batched_message_ids,
        });

        // Set AI error status in conversation
        await setAIError(payload.wa_user_id, payload.error_message, payload.message_id, payload.village_id);

        // Mark batched messages as failed for retry
        if (payload.batched_message_ids && payload.batched_message_ids.length > 0) {
          for (const msgId of payload.batched_message_ids) {
            try {
              await markMessageAsFailed(msgId, payload.error_message);
            } catch (e) {
              // Ignore - message might not exist
            }
          }
        }

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

/**
 * Message Status Event payload interface
 */
interface MessageStatusEvent {
  village_id?: string;
  wa_user_id: string;
  message_ids: string[];
  status: 'processing' | 'completed' | 'failed';
  error_message?: string;
}

/**
 * Start consuming message status events
 */
export async function startConsumingMessageStatus(): Promise<void> {
  if (!channel) {
    logger.error('RabbitMQ channel not initialized');
    throw new Error('RabbitMQ channel not available');
  }

  try {
    const queueName = rabbitmqConfig.QUEUES.CHANNEL_MESSAGE_STATUS;
    const routingKey = rabbitmqConfig.ROUTING_KEYS.MESSAGE_STATUS;

    // Declare queue
    await channel.assertQueue(queueName, { durable: true });

    // Bind queue to exchange with routing key
    await channel.bindQueue(
      queueName,
      rabbitmqConfig.EXCHANGE_NAME,
      routingKey
    );

    logger.info('🎧 Started consuming message status events', {
      queue: queueName,
      routingKey,
    });

    // Consume messages
    channel.consume(queueName, async (msg: any) => {
      if (!msg) return;

      try {
        const payload: MessageStatusEvent = JSON.parse(msg.content.toString());
        
        logger.info('📨 Message status event received', {
          village_id: payload.village_id,
          wa_user_id: payload.wa_user_id,
          status: payload.status,
          messageCount: payload.message_ids.length,
        });

        // Update pending messages based on status
        switch (payload.status) {
          case 'completed':
            await markMessagesAsCompleted(payload.message_ids);
            // Clear AI processing status when completed
            await clearAIStatus(payload.wa_user_id, payload.village_id);
            logger.info('✅ Messages completed and removed from pending queue', {
              count: payload.message_ids.length,
              messageIds: payload.message_ids,
            });
            break;
          case 'failed':
            for (const msgId of payload.message_ids) {
              await markMessageAsFailed(msgId, payload.error_message || 'Unknown error');
            }
            // Set AI error status when failed
            await setAIError(
              payload.wa_user_id,
              payload.error_message || 'Unknown error',
              payload.message_ids[0],
              payload.village_id
            );
            break;
          case 'processing':
            // No action needed - already marked when published to queue
            break;
        }

        // Acknowledge message
        channel.ack(msg);
      } catch (error: any) {
        logger.error('Error processing message status event', {
          error: error.message,
        });
        // Nack and don't requeue to avoid infinite loop
        channel.nack(msg, false, false);
      }
    });
  } catch (error: any) {
    logger.error('Failed to start consuming message status events', {
      error: error.message,
    });
    throw error;
  }
}
