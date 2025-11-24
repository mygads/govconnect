import prisma from '../config/database';
import logger from '../utils/logger';
import { MessageData, IncomingMessageData, OutgoingMessageData } from '../types/message.types';

const MAX_MESSAGES = 30;

/**
 * Save incoming message with FIFO enforcement
 */
export async function saveIncomingMessage(data: MessageData): Promise<any> {
  logger.info('Saving incoming message', {
    wa_user_id: data.wa_user_id,
    message_id: data.message_id,
  });

  // Check duplicate
  const existing = await prisma.message.findUnique({
    where: { message_id: data.message_id },
  });

  if (existing) {
    logger.warn('Duplicate message detected', { message_id: data.message_id });
    throw new Error('DUPLICATE_MESSAGE');
  }

  // Save message
  const message = await prisma.message.create({
    data: {
      wa_user_id: data.wa_user_id,
      message_id: data.message_id,
      message_text: data.message_text,
      direction: 'IN',
      source: 'WA_WEBHOOK',
      timestamp: data.timestamp || new Date(),
    },
  });

  // Enforce FIFO
  await enforeFIFO(data.wa_user_id);

  logger.info('Incoming message saved', { id: message.id });
  return message;
}

/**
 * Save outgoing message with FIFO enforcement
 */
export async function saveOutgoingMessage(
  data: MessageData & { source: 'AI' | 'SYSTEM' }
): Promise<any> {
  const message = await prisma.message.create({
    data: {
      wa_user_id: data.wa_user_id,
      message_id: data.message_id,
      message_text: data.message_text,
      direction: 'OUT',
      source: data.source,
      timestamp: data.timestamp || new Date(),
    },
  });

  // Enforce FIFO
  await enforeFIFO(data.wa_user_id);

  logger.info('Outgoing message saved', { id: message.id });
  return message;
}

/**
 * Maintain maximum 30 messages per user (FIFO)
 */
async function enforeFIFO(wa_user_id: string): Promise<void> {
  const count = await prisma.message.count({
    where: { wa_user_id },
  });

  if (count > MAX_MESSAGES) {
    const toDelete = count - MAX_MESSAGES;

    // Get oldest messages
    const oldestMessages = await prisma.message.findMany({
      where: { wa_user_id },
      orderBy: { timestamp: 'asc' },
      take: toDelete,
      select: { id: true },
    });

    // Delete them
    await prisma.message.deleteMany({
      where: {
        id: {
          in: oldestMessages.map((m) => m.id),
        },
      },
    });

    logger.info(`FIFO: Deleted ${toDelete} old messages`, { wa_user_id });
  }
}

/**
 * Get message history (last N messages)
 */
export async function getMessageHistory(
  wa_user_id: string,
  limit: number = 30
): Promise<any[]> {
  const messages = await prisma.message.findMany({
    where: { wa_user_id },
    orderBy: { timestamp: 'desc' },
    take: limit,
  });

  logger.info('Retrieved message history', {
    wa_user_id,
    count: messages.length,
  });

  return messages.reverse(); // oldest first
}

/**
 * Check if message already exists (for idempotency)
 */
export async function checkDuplicateMessage(message_id: string): Promise<boolean> {
  const existing = await prisma.message.findUnique({
    where: { message_id },
  });

  return existing !== null;
}

/**
 * Log sent message
 */
export async function logSentMessage(data: {
  wa_user_id: string;
  message_text: string;
  status: 'sent' | 'failed';
  error_msg?: string;
}): Promise<any> {
  return prisma.sendLog.create({
    data: {
      wa_user_id: data.wa_user_id,
      message_text: data.message_text,
      status: data.status,
      error_msg: data.error_msg || null,
    },
  });
}
