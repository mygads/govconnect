import prisma from '../config/database';
import logger from '../utils/logger';
import { MessageData } from '../types/message.types';

const MAX_MESSAGES = 30;

// Counter to skip FIFO on every message — only enforce periodically
const fifoCounter = new Map<string, number>();
const FIFO_CHECK_INTERVAL = 5; // Only run FIFO every 5th message per conversation

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
 * Optimized: only runs every 5th message per conversation to reduce DB load,
 * and uses a single raw SQL query instead of 3 separate queries.
 */
async function enforceFIFO(village_id: string, channel: 'WHATSAPP' | 'WEBCHAT', channel_identifier: string): Promise<void> {
  const key = `${village_id}:${channel}:${channel_identifier}`;
  const count = (fifoCounter.get(key) || 0) + 1;
  fifoCounter.set(key, count);

  // Only check every Nth message
  if (count % FIFO_CHECK_INTERVAL !== 0) return;

  try {
    // Single query: delete old messages beyond MAX_MESSAGES limit
    const result = await prisma.$executeRaw`
      DELETE FROM "Message"
      WHERE id IN (
        SELECT id FROM "Message"
        WHERE village_id = ${village_id}
          AND channel = ${channel}::"Channel"
          AND channel_identifier = ${channel_identifier}
        ORDER BY timestamp ASC
        OFFSET 0
        LIMIT (
          SELECT GREATEST(
            (SELECT COUNT(*) FROM "Message"
             WHERE village_id = ${village_id}
               AND channel = ${channel}::"Channel"
               AND channel_identifier = ${channel_identifier})
            - ${MAX_MESSAGES}, 0
          )
        )
      )
    `;

    if (result > 0) {
      logger.info(`FIFO: Deleted ${result} old messages`, { channel, channel_identifier });
    }
  } catch (error: any) {
    logger.warn('FIFO enforcement failed, will retry next cycle', {
      channel, channel_identifier, error: error.message,
    });
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
