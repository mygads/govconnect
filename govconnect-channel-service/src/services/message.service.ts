import prisma from '../config/database';
import logger from '../utils/logger';
import { MessageData } from '../types/message.types';

const MAX_MESSAGES = 30;

function resolveVillageId(villageId?: string): string {
  return villageId || 'unknown';
}

/**
 * Save incoming message with FIFO enforcement
 */
export async function saveIncomingMessage(data: MessageData): Promise<any> {
  logger.info('Saving incoming message', {
    village_id: data.village_id,
    channel: data.channel || 'WHATSAPP',
    channel_identifier: data.channel_identifier,
    message_id: data.message_id,
  });

  const villageId = resolveVillageId(data.village_id);
  const channel = data.channel || 'WHATSAPP';

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
      village_id: villageId,
      wa_user_id: data.wa_user_id || null,
      channel,
      channel_identifier: data.channel_identifier,
      message_id: data.message_id,
      message_text: data.message_text,
      direction: 'IN',
      source: 'WA_WEBHOOK',
      timestamp: data.timestamp || new Date(),
    },
  });

  // Enforce FIFO
  await enforceFIFO(villageId, channel, data.channel_identifier);

  logger.info('Incoming message saved', { id: message.id });
  return message;
}

/**
 * Save outgoing message with FIFO enforcement
 */
export async function saveOutgoingMessage(
  data: MessageData & { source: 'AI' | 'SYSTEM' | 'ADMIN' }
): Promise<any> {
  const villageId = resolveVillageId(data.village_id);
  const channel = data.channel || 'WHATSAPP';
  const message = await prisma.message.create({
    data: {
      village_id: villageId,
      wa_user_id: data.wa_user_id || null,
      channel,
      channel_identifier: data.channel_identifier,
      message_id: data.message_id,
      message_text: data.message_text,
      direction: 'OUT',
      source: data.source,
      timestamp: data.timestamp || new Date(),
    },
  });

  // Enforce FIFO
  await enforceFIFO(villageId, channel, data.channel_identifier);

  logger.info('Outgoing message saved', { id: message.id });
  return message;
}

/**
 * Maintain maximum 30 messages per user (FIFO)
 */
async function enforceFIFO(village_id: string, channel: 'WHATSAPP' | 'WEBCHAT', channel_identifier: string): Promise<void> {
  const count = await prisma.message.count({
    where: { village_id, channel, channel_identifier },
  });

  if (count > MAX_MESSAGES) {
    const toDelete = count - MAX_MESSAGES;

    // Get oldest messages
    const oldestMessages = await prisma.message.findMany({
      where: { village_id, channel, channel_identifier },
      orderBy: { timestamp: 'asc' },
      take: toDelete,
      select: { id: true },
    });

    // Delete them
    await prisma.message.deleteMany({
      where: {
        id: {
          in: oldestMessages.map((m: { id: string }) => m.id),
        },
      },
    });

    logger.info(`FIFO: Deleted ${toDelete} old messages`, { channel, channel_identifier });
  }
}

/**
 * Get message history (last N messages)
 */
export async function getMessageHistory(
  channel_identifier: string,
  limit: number = 30,
  village_id?: string,
  channel: 'WHATSAPP' | 'WEBCHAT' = 'WHATSAPP'
): Promise<any[]> {
  const resolvedVillageId = village_id ? resolveVillageId(village_id) : undefined;
  const where: any = { channel, channel_identifier };
  if (resolvedVillageId) {
    where.village_id = resolvedVillageId;
  }
  const messages = await prisma.message.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: limit,
  });

  logger.info('Retrieved message history', {
    channel,
    channel_identifier,
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
  village_id?: string;
  wa_user_id?: string;
  channel?: 'WHATSAPP' | 'WEBCHAT';
  channel_identifier: string;
  message_text: string;
  status: 'sent' | 'failed';
  error_msg?: string;
}): Promise<any> {
  const villageId = resolveVillageId(data.village_id);
  return prisma.sendLog.create({
    data: {
      village_id: villageId,
      wa_user_id: data.wa_user_id || null,
      channel: data.channel || 'WHATSAPP',
      channel_identifier: data.channel_identifier,
      message_text: data.message_text,
      status: data.status,
      error_msg: data.error_msg || null,
    },
  });
}
