import amqplib from 'amqplib';
import axios from 'axios';
import logger from '../utils/logger';
import { config } from '../config/env';
import { RABBITMQ_CONFIG } from '../config/rabbitmq';
import { MessageReceivedEvent, AIReplyEvent, AIErrorEvent, MessageStatusEvent } from '../types/event.types';

let connection: any = null;
let channel: any = null;
let isReconnecting = false;
let reconnectAttempts = 0;
let messageHandler: ((event: MessageReceivedEvent) => Promise<void>) | null = null;

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
  const exponentialDelay = RECONNECT_CONFIG.BASE_DELAY_MS * Math.pow(2, Math.min(attempt, 10)); // Cap exponent at 10
  const jitter = exponentialDelay * RECONNECT_CONFIG.JITTER_FACTOR * Math.random();
  return Math.min(RECONNECT_CONFIG.MAX_DELAY_MS, exponentialDelay + jitter);
}

/**
 * Sleep for specified milliseconds
 */
function sleepMs(ms: number): Promise<void> {
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

// Flag to prevent reconnect during graceful shutdown
let isShuttingDown = false;

/**
 * Handle reconnection with exponential backoff
 */
async function handleReconnect(): Promise<void> {
  // Don't reconnect if we're shutting down
  if (isShuttingDown) {
    logger.info('🛑 Shutdown in progress, skipping reconnection');
    return;
  }
  
  if (isReconnecting) {
    logger.debug('Reconnection already in progress, skipping...');
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
    
    await sleepMs(delay);
    
    // Check again after sleep
    if (isShuttingDown) {
      logger.info('🛑 Shutdown detected during reconnect delay, aborting');
      isReconnecting = false;
      return;
    }
    
    try {
      await connectRabbitMQ();
      
      // Reconnect successful - restart consuming if handler was set
      if (messageHandler) {
        await startConsuming(messageHandler);
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
}

/**
 * ==================== MESSAGE BATCHING ====================
 * Collect multiple messages from same user and combine them
 */

interface PendingBatch {
  messages: MessageReceivedEvent[];
  timer: NodeJS.Timeout | null;
  firstMessageTime: number;
}

// Pending batches per user
const pendingBatches: Map<string, PendingBatch> = new Map();

/**
 * Add message to batch and process when ready
 */
async function addToBatch(
  event: MessageReceivedEvent,
  onProcess: (batchedEvent: MessageReceivedEvent) => Promise<void>,
  ackCallback: () => void
): Promise<void> {
  const { wa_user_id } = event;
  
  let batch = pendingBatches.get(wa_user_id);
  
  if (!batch) {
    // Create new batch
    batch = {
      messages: [],
      timer: null,
      firstMessageTime: Date.now(),
    };
    pendingBatches.set(wa_user_id, batch);
  }
  
  // Add message to batch
  batch.messages.push(event);
  
  // Clear existing timer
  if (batch.timer) {
    clearTimeout(batch.timer);
  }
  
  // Check if we should process immediately
  const shouldProcessNow = 
    batch.messages.length >= RABBITMQ_CONFIG.BATCHING.MAX_MESSAGES_PER_BATCH ||
    Date.now() - batch.firstMessageTime > RABBITMQ_CONFIG.BATCHING.BATCH_WINDOW_MS;
  
  if (shouldProcessNow) {
    await processBatch(wa_user_id, onProcess, ackCallback);
  } else {
    // Set timer to process batch after max wait time
    batch.timer = setTimeout(async () => {
      await processBatch(wa_user_id, onProcess, ackCallback);
    }, RABBITMQ_CONFIG.BATCHING.MAX_WAIT_MS);
  }
}

/**
 * Process a batch of messages for a user
 */
async function processBatch(
  wa_user_id: string,
  onProcess: (event: MessageReceivedEvent) => Promise<void>,
  ackCallback: () => void
): Promise<void> {
  const batch = pendingBatches.get(wa_user_id);
  if (!batch || batch.messages.length === 0) return;
  
  // Clear timer and remove from pending
  if (batch.timer) {
    clearTimeout(batch.timer);
  }
  pendingBatches.delete(wa_user_id);
  
  const messages = batch.messages;
  
  if (messages.length === 1) {
    // Single message - process normally
    logger.info('📨 Processing single message', {
      wa_user_id,
      message_id: messages[0].message_id,
    });
    await onProcess(messages[0]);
  } else {
    // Multiple messages - combine them
    logger.info('📦 Batching multiple messages', {
      wa_user_id,
      count: messages.length,
      message_ids: messages.map(m => m.message_id),
    });
    
    // Combine messages with context
    const combinedMessage = combineMessages(messages);
    
    // Create batched event
    const batchedEvent: MessageReceivedEvent = {
      wa_user_id,
      message: combinedMessage,
      message_id: messages[messages.length - 1].message_id, // Use latest message ID
      received_at: messages[messages.length - 1].received_at,
      is_batched: true,
      batched_message_ids: messages.map(m => m.message_id),
      original_messages: messages.map(m => m.message),
      // Take media from any message that has it
      has_media: messages.some(m => m.has_media),
      media_type: messages.find(m => m.has_media)?.media_type,
      media_url: messages.find(m => m.has_media)?.media_url,
      media_public_url: messages.find(m => m.has_media)?.media_public_url,
      media_caption: messages.find(m => m.has_media)?.media_caption,
    };
    
    await onProcess(batchedEvent);
  }
  
  // Acknowledge all messages in batch
  ackCallback();
}

/**
 * Combine multiple messages into a single message with context
 */
function combineMessages(messages: MessageReceivedEvent[]): string {
  if (messages.length === 1) {
    return messages[0].message;
  }
  
  // Format combined message
  const parts: string[] = [];
  
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i].message.trim();
    if (msg) {
      // Add message with numbering if multiple
      if (messages.length > 2) {
        parts.push(`${i + 1}. ${msg}`);
      } else {
        parts.push(msg);
      }
    }
  }
  
  // Join messages naturally
  if (parts.length === 2) {
    return parts.join(' dan ');
  } else {
    return parts.join('\n');
  }
}

/**
 * ==================== RETRY QUEUE CONFIGURATION ====================
 */

interface QueuedMessage {
  payload: AIReplyEvent | AIErrorEvent | MessageStatusEvent;
  type: 'reply' | 'error' | 'status';
  attempts: number;
  firstAttempt: number;
  lastAttempt: number;
}

// In-memory retry queue for failed publishes
const retryQueue: QueuedMessage[] = [];
const MAX_RETRY_ATTEMPTS = 5;
const RETRY_DELAY_MS = 5000;      // 5 seconds between retries

/**
 * ==================== AI MESSAGE RETRY QUEUE ====================
 * For retrying AI processing when LLM/RAG fails
 * Messages are NOT dropped - they are retried until success or max attempts
 */

interface AIMessageRetry {
  event: MessageReceivedEvent;
  attempts: number;
  firstAttempt: number;
  lastAttempt: number;
  lastError: string;
}

// AI message retry queue - for messages that failed AI processing
// Layer 2: Cron every 10 minutes, max 10 retries, then mark as FAILED
const aiMessageRetryQueue: AIMessageRetry[] = [];
const AI_MAX_RETRY_ATTEMPTS = 10;         // Max retries before marking as failed
const AI_RETRY_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes between retries
const AI_MAX_QUEUE_SIZE = 500;            // Max messages in retry queue
let aiRetryIntervalId: NodeJS.Timeout | null = null;

/**
 * ==================== FAILED MESSAGES STORAGE ====================
 * For messages that exceeded max retries
 * Admin can manually retry these from Dashboard
 */

interface FailedMessage extends AIMessageRetry {
  failedAt: number;
  status: 'failed' | 'retrying' | 'resolved';
}

// Failed messages storage - for admin dashboard
const failedMessages: Map<string, FailedMessage> = new Map();
const FAILED_MESSAGES_MAX_SIZE = 1000; // Max failed messages to store
let aiMessageHandler: ((event: MessageReceivedEvent) => Promise<void>) | null = null;

/**
 * Add to failed messages storage (for admin dashboard)
 */
function addToFailedMessages(item: AIMessageRetry): void {
  const key = item.event.message_id;
  
  // Limit size
  if (failedMessages.size >= FAILED_MESSAGES_MAX_SIZE) {
    // Remove oldest entry
    const oldestKey = failedMessages.keys().next().value;
    if (oldestKey) failedMessages.delete(oldestKey);
  }
  
  failedMessages.set(key, {
    ...item,
    failedAt: Date.now(),
    status: 'failed',
  });
}

/**
 * Get all failed messages (for admin dashboard)
 */
export function getFailedMessages(): FailedMessage[] {
  return Array.from(failedMessages.values()).sort((a, b) => b.failedAt - a.failedAt);
}

/**
 * Get failed message by ID
 */
export function getFailedMessage(messageId: string): FailedMessage | undefined {
  return failedMessages.get(messageId);
}

/**
 * Admin manual retry - retry a specific failed message
 * Returns true if retry was initiated, false if not found
 */
export async function retryFailedMessage(messageId: string): Promise<{ success: boolean; error?: string }> {
  const failed = failedMessages.get(messageId);
  
  if (!failed) {
    return { success: false, error: 'Message not found in failed messages' };
  }
  
  if (failed.status === 'retrying') {
    return { success: false, error: 'Message is already being retried' };
  }
  
  if (!aiMessageHandler) {
    return { success: false, error: 'AI message handler not initialized' };
  }
  
  // Mark as retrying
  failed.status = 'retrying';
  
  logger.info('🔄 Admin retry: Processing failed message', {
    wa_user_id: failed.event.wa_user_id,
    message_id: failed.event.message_id,
    previousAttempts: failed.attempts,
  });
  
  try {
    await aiMessageHandler(failed.event);
    
    // Success - remove from failed messages
    failedMessages.delete(messageId);
    
    logger.info('✅ Admin retry: Message processed successfully', {
      wa_user_id: failed.event.wa_user_id,
      message_id: failed.event.message_id,
    });
    
    return { success: true };
  } catch (error: any) {
    // Failed again - put back in queue or mark as failed
    failed.status = 'failed';
    failed.attempts++;
    failed.lastAttempt = Date.now();
    failed.lastError = error.message || 'Unknown error';
    
    logger.error('❌ Admin retry: Failed', {
      wa_user_id: failed.event.wa_user_id,
      message_id: failed.event.message_id,
      error: failed.lastError,
    });
    
    return { success: false, error: failed.lastError };
  }
}

/**
 * Admin manual retry all failed messages
 */
export async function retryAllFailedMessages(): Promise<{ total: number; success: number; failed: number }> {
  const results = { total: 0, success: 0, failed: 0 };
  
  for (const [messageId] of failedMessages) {
    results.total++;
    const result = await retryFailedMessage(messageId);
    if (result.success) {
      results.success++;
    } else {
      results.failed++;
    }
  }
  
  return results;
}

/**
 * Clear resolved or all failed messages
 */
export function clearFailedMessages(all: boolean = false): number {
  if (all) {
    const count = failedMessages.size;
    failedMessages.clear();
    return count;
  }
  
  // Only clear resolved
  let count = 0;
  for (const [key, value] of failedMessages) {
    if (value.status === 'resolved') {
      failedMessages.delete(key);
      count++;
    }
  }
  return count;
}

/**
 * Start AI message retry worker
 * Runs every 10 minutes to process failed messages
 * Max 10 retries per message, no fallback message to user
 */
function startAIRetryWorker(onMessage: (event: MessageReceivedEvent) => Promise<void>): void {
  if (aiRetryIntervalId) return;
  
  // Save message handler for admin manual retry
  aiMessageHandler = onMessage;
  
  // Run worker every 10 minutes (AI_RETRY_INTERVAL_MS)
  aiRetryIntervalId = setInterval(async () => {
    if (aiMessageRetryQueue.length === 0) return;
    
    const now = Date.now();
    
    // Process up to 5 messages per cycle
    const toProcess: AIMessageRetry[] = [];
    const remaining: AIMessageRetry[] = [];
    
    for (const item of aiMessageRetryQueue) {
      // Check if enough time has passed since last attempt (10 minutes)
      if (now - item.lastAttempt >= AI_RETRY_INTERVAL_MS && toProcess.length < 5) {
        toProcess.push(item);
      } else {
        remaining.push(item);
      }
    }
    
    // Update queue with remaining items
    aiMessageRetryQueue.length = 0;
    aiMessageRetryQueue.push(...remaining);
    
    // Process selected items
    for (const item of toProcess) {
      item.attempts++;
      item.lastAttempt = now;
      
      logger.info('🔄 AI retry: Processing message', {
        wa_user_id: item.event.wa_user_id,
        message_id: item.event.message_id,
        attempt: item.attempts,
        maxAttempts: AI_MAX_RETRY_ATTEMPTS,
      });
      
      try {
        await onMessage(item.event);
        
        logger.info('✅ AI retry: Message processed successfully', {
          wa_user_id: item.event.wa_user_id,
          message_id: item.event.message_id,
          attempts: item.attempts,
        });
      } catch (error: any) {
        item.lastError = error.message || 'Unknown error';
        
        if (item.attempts < AI_MAX_RETRY_ATTEMPTS) {
          // Re-queue for later retry
          aiMessageRetryQueue.push(item);
          
          logger.warn('⚠️ AI retry: Failed, will retry in 10 minutes', {
            wa_user_id: item.event.wa_user_id,
            message_id: item.event.message_id,
            attempts: item.attempts,
            maxAttempts: AI_MAX_RETRY_ATTEMPTS,
            error: item.lastError,
          });
        } else {
          // Max retries exceeded - mark as FAILED (no message to user)
          logger.error('❌ AI retry: Max attempts exceeded, marking as FAILED', {
            wa_user_id: item.event.wa_user_id,
            message_id: item.event.message_id,
            attempts: item.attempts,
            lastError: item.lastError,
          });
          
          // Add to failed messages list for admin monitoring/manual retry
          addToFailedMessages(item);
          
          // Publish error for dashboard monitoring (admin can manually retry)
          await publishAIError({
            village_id: item.event.village_id,
            wa_user_id: item.event.wa_user_id,
            error_message: `FAILED after ${AI_MAX_RETRY_ATTEMPTS} retries: ${item.lastError}`,
            pending_message_id: item.event.message_id,
            batched_message_ids: item.event.is_batched ? item.event.batched_message_ids : undefined,
            can_retry: true, // Flag for dashboard to show retry button
          });
        }
      }
    }
  }, AI_RETRY_INTERVAL_MS); // Check every 10 minutes
  
  logger.info('🔄 AI message retry worker started (interval: 10 minutes, max retries: 10)');
}

/**
 * Stop AI message retry worker
 */
function stopAIRetryWorker(): void {
  if (aiRetryIntervalId) {
    clearInterval(aiRetryIntervalId);
    aiRetryIntervalId = null;
    logger.info('🛑 AI message retry worker stopped');
  }
}

/**
 * Add message to AI retry queue
 * Called when AI processing fails
 */
export function addToAIRetryQueue(event: MessageReceivedEvent, error: string): void {
  // Check if message is already in queue (by message_id)
  const existingIndex = aiMessageRetryQueue.findIndex(
    item => item.event.message_id === event.message_id
  );
  
  if (existingIndex >= 0) {
    // Update existing entry
    const existing = aiMessageRetryQueue[existingIndex];
    existing.attempts++;
    existing.lastAttempt = Date.now();
    existing.lastError = error;
    
    logger.info('📥 AI retry: Updated existing entry', {
      wa_user_id: event.wa_user_id,
      message_id: event.message_id,
      attempts: existing.attempts,
    });
    return;
  }
  
  // Check queue size limit
  if (aiMessageRetryQueue.length >= AI_MAX_QUEUE_SIZE) {
    // Drop oldest message
    const dropped = aiMessageRetryQueue.shift();
    logger.warn('⚠️ AI retry queue full, dropped oldest message', {
      droppedMessageId: dropped?.event.message_id,
      queueSize: aiMessageRetryQueue.length,
    });
  }
  
  // Add new entry
  aiMessageRetryQueue.push({
    event,
    attempts: 1,
    firstAttempt: Date.now(),
    lastAttempt: Date.now(),
    lastError: error,
  });
  
  logger.info('📥 AI retry: Message added to queue', {
    wa_user_id: event.wa_user_id,
    message_id: event.message_id,
    queueSize: aiMessageRetryQueue.length,
    error,
  });
}

/**
 * Get AI retry queue status
 */
export function getAIRetryQueueStatus(): {
  queueSize: number;
  oldestItem: number | null;
  pendingMessages: Array<{ wa_user_id: string; message_id: string; attempts: number }>;
} {
  return {
    queueSize: aiMessageRetryQueue.length,
    oldestItem: aiMessageRetryQueue.length > 0 ? aiMessageRetryQueue[0].firstAttempt : null,
    pendingMessages: aiMessageRetryQueue.map(item => ({
      wa_user_id: item.event.wa_user_id,
      message_id: item.event.message_id,
      attempts: item.attempts,
    })),
  };
}
const MAX_QUEUE_SIZE = 1000;       // Prevent memory overflow
let retryIntervalId: NodeJS.Timeout | null = null;

/**
 * Start retry worker
 */
function startRetryWorker(): void {
  if (retryIntervalId) return;
  
  retryIntervalId = setInterval(async () => {
    if (retryQueue.length === 0) return;
    if (!isConnected()) {
      logger.warn('⏳ RabbitMQ not connected, retry worker waiting...');
      return;
    }
    
    // Process up to 10 messages per cycle
    const toProcess = retryQueue.splice(0, 10);
    
    for (const item of toProcess) {
      try {
        if (item.type === 'reply') {
          await publishAIReplyDirect(item.payload as AIReplyEvent);
          logger.info('✅ Retry successful for AI reply', {
            wa_user_id: (item.payload as AIReplyEvent).wa_user_id,
            attempts: item.attempts,
          });
        } else if (item.type === 'error') {
          await publishAIErrorDirect(item.payload as AIErrorEvent);
          logger.info('✅ Retry successful for AI error', {
            wa_user_id: (item.payload as AIErrorEvent).wa_user_id,
            attempts: item.attempts,
          });
        } else if (item.type === 'status') {
          await publishMessageStatusDirect(item.payload as MessageStatusEvent);
          logger.info('✅ Retry successful for message status', {
            wa_user_id: (item.payload as MessageStatusEvent).wa_user_id,
            attempts: item.attempts,
          });
        }
      } catch (error: any) {
        item.attempts++;
        item.lastAttempt = Date.now();
        
        if (item.attempts < MAX_RETRY_ATTEMPTS) {
          // Re-queue for later
          retryQueue.push(item);
          logger.warn('⚠️ Retry failed, re-queuing', {
            type: item.type,
            attempts: item.attempts,
            error: error.message,
          });
        } else {
          // Max retries exceeded - log and drop
          logger.error('❌ Max retries exceeded, dropping message', {
            type: item.type,
            payload: item.payload,
            attempts: item.attempts,
            firstAttempt: new Date(item.firstAttempt).toISOString(),
          });
        }
      }
    }
  }, RETRY_DELAY_MS);
  
  logger.info('🔄 Retry worker started');
}

/**
 * Stop retry worker
 */
function stopRetryWorker(): void {
  if (retryIntervalId) {
    clearInterval(retryIntervalId);
    retryIntervalId = null;
  }
}

/**
 * Add message to retry queue
 */
function addToRetryQueue(
  payload: AIReplyEvent | AIErrorEvent | MessageStatusEvent, 
  type: 'reply' | 'error' | 'status'
): void {
  if (retryQueue.length >= MAX_QUEUE_SIZE) {
    // Drop oldest message to make room
    const dropped = retryQueue.shift();
    logger.error('⚠️ Retry queue full, dropped oldest message', {
      droppedType: dropped?.type,
      queueSize: retryQueue.length,
    });
  }
  
  retryQueue.push({
    payload,
    type,
    attempts: 1,
    firstAttempt: Date.now(),
    lastAttempt: Date.now(),
  });
  
  logger.info('📥 Message added to retry queue', {
    type,
    queueSize: retryQueue.length,
  });
}

/**
 * Connect to RabbitMQ with auto-reconnect capability
 */
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
    
    const conn: any = await amqplib.connect(config.rabbitmqUrl);
    connection = conn;
    channel = await conn.createChannel();
    
    // Assert exchange
    await channel.assertExchange(
      RABBITMQ_CONFIG.EXCHANGE_NAME,
      RABBITMQ_CONFIG.EXCHANGE_TYPE,
      { durable: true }
    );
    
    // Handle connection errors - trigger reconnect
    connection.on('error', (err: Error) => {
      logger.error('RabbitMQ connection error', { error: err.message });
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
    
    // Start retry worker
    startRetryWorker();
    
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
  
  // Store handler for reconnection
  messageHandler = onMessage;
  
  // Start AI retry worker with the message handler
  startAIRetryWorker(onMessage);
  
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
    
    // Set prefetch - allow more messages for batching
    await channel.prefetch(RABBITMQ_CONFIG.BATCHING.MAX_MESSAGES_PER_BATCH);
    
    // Store ack callbacks for batching
    const pendingAcks: Map<string, amqplib.ConsumeMessage[]> = new Map();
    
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
          
          if (RABBITMQ_CONFIG.BATCHING.ENABLED) {
            // Track pending acks for this user
            const userAcks = pendingAcks.get(event.wa_user_id) || [];
            userAcks.push(msg);
            pendingAcks.set(event.wa_user_id, userAcks);
            
            // Add to batch
            await addToBatch(event, onMessage, () => {
              // Ack all messages for this user
              const acks = pendingAcks.get(event.wa_user_id) || [];
              for (const ack of acks) {
                channel!.ack(ack);
              }
              pendingAcks.delete(event.wa_user_id);
              
              logger.debug('✅ Batch acknowledged', {
                wa_user_id: event.wa_user_id,
                count: acks.length,
              });
            });
          } else {
            // Process immediately without batching
            await onMessage(event);
            channel!.ack(msg);
            
            logger.debug('✅ Message acknowledged', {
              message_id: event.message_id,
            });
          }
        } catch (error: any) {
          logger.error('❌ Error processing message', {
            error: error.message,
            stack: error.stack,
          });
          
          // Check if message has been redelivered too many times
          // If so, reject without requeue to prevent infinite loop
          const redelivered = msg.fields.redelivered;
          if (redelivered) {
            logger.warn('⚠️ Message already redelivered, rejecting without requeue', {
              messageId: msg.fields.deliveryTag,
            });
            channel!.nack(msg, false, false); // Don't requeue
          } else {
            // First failure - requeue for retry
            channel!.nack(msg, false, true);
          }
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
 * Publish AI reply event (direct - used by retry worker)
 */
async function publishAIReplyDirect(payload: AIReplyEvent): Promise<void> {
  if (!channel) {
    throw new Error('RabbitMQ channel not initialized');
  }
  
  const message = Buffer.from(JSON.stringify(payload));
  
  channel.publish(
    RABBITMQ_CONFIG.EXCHANGE_NAME,
    RABBITMQ_CONFIG.ROUTING_KEY_AI_REPLY,
    message,
    { persistent: true }
  );
}

/**
 * Publish AI error event (direct - used by retry worker)
 */
async function publishAIErrorDirect(payload: AIErrorEvent): Promise<void> {
  if (!channel) {
    throw new Error('RabbitMQ channel not initialized');
  }
  
  const message = Buffer.from(JSON.stringify(payload));
  
  channel.publish(
    RABBITMQ_CONFIG.EXCHANGE_NAME,
    RABBITMQ_CONFIG.ROUTING_KEY_AI_ERROR,
    message,
    { persistent: true }
  );
}

/**
 * Publish message status event (direct - used by retry worker)
 */
async function publishMessageStatusDirect(payload: MessageStatusEvent): Promise<void> {
  if (!channel) {
    throw new Error('RabbitMQ channel not initialized');
  }
  
  const message = Buffer.from(JSON.stringify(payload));
  
  channel.publish(
    RABBITMQ_CONFIG.EXCHANGE_NAME,
    RABBITMQ_CONFIG.ROUTING_KEY_MESSAGE_STATUS,
    message,
    { persistent: true }
  );
}

/**
 * Publish AI reply event with retry support
 */
export async function publishAIReply(payload: AIReplyEvent): Promise<void> {
  // ALWAYS store AI reply in database first (both testing and production mode)
  try {
    await storeAIReplyInDatabase(payload);
    logger.info('✅ AI reply stored in database', {
      wa_user_id: payload.wa_user_id,
      testing_mode: config.testingMode,
    });
  } catch (error: any) {
    logger.error('❌ Failed to store AI reply in database', {
      wa_user_id: payload.wa_user_id,
      error: error.message,
    });
    // Continue with WhatsApp publishing even if database storage fails
  }

  // In testing mode, don't send to WhatsApp but still store in database
  if (config.testingMode) {
    logger.info('🧪 TESTING MODE: AI Reply stored in DB, not sent to WhatsApp', {
      wa_user_id: payload.wa_user_id,
      reply_text: payload.reply_text.substring(0, 100) + (payload.reply_text.length > 100 ? '...' : ''),
      guidance_text: payload.guidance_text?.substring(0, 50) + (payload.guidance_text && payload.guidance_text.length > 50 ? '...' : ''),
      hasGuidance: !!payload.guidance_text,
    });
    return;
  }

  try {
    if (!channel) {
      // Channel not available, queue for retry
      logger.warn('⚠️ RabbitMQ channel not available, queuing for retry');
      addToRetryQueue(payload, 'reply');
      return;
    }
    
    await publishAIReplyDirect(payload);
    
    logger.info('📤 AI reply event published', {
      routingKey: RABBITMQ_CONFIG.ROUTING_KEY_AI_REPLY,
      wa_user_id: payload.wa_user_id,
    });
  } catch (error: any) {
    logger.error('❌ Failed to publish AI reply, queuing for retry', {
      error: error.message,
      wa_user_id: payload.wa_user_id,
    });
    
    // Add to retry queue
    addToRetryQueue(payload, 'reply');
  }
}

/**
 * Publish AI error event with retry support
 */
export async function publishAIError(payload: AIErrorEvent): Promise<void> {
  // In testing mode, just log the error instead of publishing
  if (config.testingMode) {
    logger.info('🧪 TESTING MODE: AI Error (not published)', {
      wa_user_id: payload.wa_user_id,
      error_message: payload.error_message,

    });
    return;
  }

  try {
    if (!channel) {
      logger.warn('⚠️ RabbitMQ channel not available, queuing for retry');
      addToRetryQueue(payload, 'error');
      return;
    }
    
    await publishAIErrorDirect(payload);
    
    logger.info('📤 AI error event published', {
      routingKey: RABBITMQ_CONFIG.ROUTING_KEY_AI_ERROR,
      wa_user_id: payload.wa_user_id,
      error: payload.error_message,
    });
  } catch (error: any) {
    logger.error('❌ Failed to publish AI error, queuing for retry', {
      error: error.message,
      wa_user_id: payload.wa_user_id,
    });
    
    // Add to retry queue
    addToRetryQueue(payload, 'error');
  }
}

/**
 * Publish message status event with retry support
 */
export async function publishMessageStatus(payload: MessageStatusEvent): Promise<void> {
  // NOTE: In testing mode, we STILL publish status updates!
  // The dashboard needs to know when processing is completed.
  // Only AI replies and errors are skipped in testing mode.
  if (config.testingMode) {
    logger.info('🧪 TESTING MODE: Message Status (still published for dashboard)', {
      wa_user_id: payload.wa_user_id,
      status: payload.status,
      message_ids: payload.message_ids?.length || 0,
      error_message: payload.error_message,
    });
    // Continue with normal publishing - don't return here!
  }

  try {
    if (!channel) {
      logger.warn('⚠️ RabbitMQ channel not available, queuing for retry');
      addToRetryQueue(payload, 'status');
      return;
    }
    
    await publishMessageStatusDirect(payload);
    
    logger.info('📤 Message status event published', {
      routingKey: RABBITMQ_CONFIG.ROUTING_KEY_MESSAGE_STATUS,
      wa_user_id: payload.wa_user_id,
      status: payload.status,
    });
  } catch (error: any) {
    logger.error('❌ Failed to publish message status, queuing for retry', {
      error: error.message,
      wa_user_id: payload.wa_user_id,
    });
    
    addToRetryQueue(payload, 'status');
  }
}

/**
 * Gracefully disconnect from RabbitMQ
 * - Stops accepting new messages
 * - Waits for current processing to complete (with timeout)
 * - Cleans up resources properly
 */
export async function disconnectRabbitMQ(): Promise<void> {
  isShuttingDown = true;
  
  try {
    logger.info('🛑 Starting graceful RabbitMQ shutdown...');
    
    // Stop retry workers first
    stopRetryWorker();
    stopAIRetryWorker();
    
    // Log any remaining items in retry queues
    if (retryQueue.length > 0) {
      logger.warn('⚠️ Disconnecting with items in publish retry queue', {
        queueSize: retryQueue.length,
      });
    }
    
    if (aiMessageRetryQueue.length > 0) {
      logger.warn('⚠️ Disconnecting with items in AI message retry queue', {
        queueSize: aiMessageRetryQueue.length,
        pendingMessages: aiMessageRetryQueue.map(item => ({
          wa_user_id: item.event.wa_user_id,
          message_id: item.event.message_id,
          attempts: item.attempts,
        })),
      });
    }
    
    // Cancel consumers first (stop accepting new messages)
    if (channel) {
      try {
        // Give some time for in-flight messages to complete
        await new Promise(resolve => setTimeout(resolve, 2000));
        await channel.close();
        logger.info('✅ Channel closed gracefully');
      } catch (error: any) {
        // Channel might already be closed
        if (!error.message?.includes('Channel closed')) {
          logger.warn('⚠️ Error closing channel', { error: error.message });
        }
      }
      channel = null;
    }
    
    if (connection) {
      try {
        await connection.close();
        logger.info('✅ Connection closed gracefully');
      } catch (error: any) {
        // Connection might already be closed
        if (!error.message?.includes('Connection closed')) {
          logger.warn('⚠️ Error closing connection', { error: error.message });
        }
      }
      connection = null;
    }
    
    // Clear saved handler
    messageHandler = null;
    
    logger.info('🔌 RabbitMQ disconnected gracefully');
  } catch (error: any) {
    logger.error('Error during graceful disconnect', {
      error: error.message,
    });
  }
}

/**
 * Check if RabbitMQ is connected and ready
 * - Verifies both connection and channel exist
 * - Checks that connection is not closed
 */
export function isConnected(): boolean {
  if (!connection || !channel) {
    return false;
  }
  
  // Check if connection is actually open
  // amqplib connection has a 'connection' property with 'stream' that can tell us
  try {
    // Type assertion needed because amqplib types don't expose this
    const conn = connection as any;
    if (conn.connection && conn.connection.stream) {
      return !conn.connection.stream.destroyed;
    }
  } catch {
    // If we can't check, assume connected if objects exist
  }
  
  return true;
}

/**
 * Check if we're in shutdown mode
 */
export function isShuttingDownRabbitMQ(): boolean {
  return isShuttingDown;
}



/**
 * Store AI reply in database (for both testing and production mode)
 * This ensures complete conversation history is maintained
 */
async function storeAIReplyInDatabase(payload: AIReplyEvent): Promise<void> {
  try {
    const axios = (await import('axios')).default;
    
    logger.info('🔄 Attempting to store AI reply in database', {
      wa_user_id: payload.wa_user_id,
      channel_service_url: config.channelServiceUrl,
      testing_mode: config.testingMode,
      reply_length: payload.reply_text.length,
    });
    
    // Store main reply message
    const mainReplyData = {
      village_id: payload.village_id,
      wa_user_id: payload.wa_user_id,
      message_text: payload.reply_text,
      direction: 'OUT',
      message_type: 'text',
      status: 'sent',
      metadata: {
        source: 'ai_service',
        testing_mode: config.testingMode,
        batched_message_ids: payload.batched_message_ids,
        ai_generated: true,
        timestamp: new Date().toISOString(),
      }
    };

    const response1 = await axios.post(`${config.channelServiceUrl}/internal/messages`, mainReplyData, {
      headers: {
        'x-internal-api-key': config.internalApiKey,
        'Content-Type': 'application/json',
        ...(payload.village_id ? { 'x-village-id': payload.village_id } : {}),
      },
      timeout: 15000,
    });
    
    logger.info('✅ Main AI reply stored successfully', {
      wa_user_id: payload.wa_user_id,
      status: response1.status,
      response_data: response1.data,
    });
    
    // Store guidance text as separate message if present
    if (payload.guidance_text && payload.guidance_text.trim()) {
      const guidanceData = {
        village_id: payload.village_id,
        wa_user_id: payload.wa_user_id,
        message_text: payload.guidance_text,
        direction: 'OUT',
        message_type: 'text',
        status: 'sent',
        metadata: {
          source: 'ai_service',
          testing_mode: config.testingMode,
          is_guidance: true,
          batched_message_ids: payload.batched_message_ids,
          ai_generated: true,
          timestamp: new Date().toISOString(),
        }
      };

      const response2 = await axios.post(`${config.channelServiceUrl}/internal/messages`, guidanceData, {
        headers: {
          'x-internal-api-key': config.internalApiKey,
          'Content-Type': 'application/json',
          ...(payload.village_id ? { 'x-village-id': payload.village_id } : {}),
        },
        timeout: 15000,
      });
      
      logger.info('✅ Guidance text stored successfully', {
        wa_user_id: payload.wa_user_id,
        status: response2.status,
      });
    }
    
    logger.info('✅ AI reply stored in database successfully', {
      wa_user_id: payload.wa_user_id,
      hasGuidance: !!payload.guidance_text,
      testing_mode: config.testingMode,
    });
  } catch (error: any) {
    logger.error('❌ Failed to store AI reply in database', {
      wa_user_id: payload.wa_user_id,
      error: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      url: `${config.channelServiceUrl}/internal/messages`,
      headers: {
        'x-internal-api-key': config.internalApiKey ? 'present' : 'missing',
      },
    });
    
    // Don't throw error - continue with WhatsApp publishing even if database storage fails
    // This prevents the entire message processing from failing
  }
}

/**
 * Get retry queue status (for monitoring)
 */
export function getRetryQueueStatus(): {
  queueSize: number;
  oldestItem: number | null;
} {
  return {
    queueSize: retryQueue.length,
    oldestItem: retryQueue.length > 0 ? retryQueue[0].firstAttempt : null,
  };
}
