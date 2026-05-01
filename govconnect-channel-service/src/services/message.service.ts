import prisma from '../config/database';
import logger from '../utils/logger';
import { MessageData, MessageDeliveryStatus } from '../types/message.types';
import { publishLivechatEvent } from './livechat-events.service';

const MAX_MESSAGES = 30;

type MessageMediaFields = Pick<
  MessageData,
  'media_type' | 'media_url' | 'media_public_url' | 'mime_type' | 'file_name' | 'file_size' | 'storage_key'
>;

type MessageRichFields = Pick<
  MessageData,
  | 'wa_chat_jid'
  | 'wa_sender_jid'
  | 'wa_sender_phone'
  | 'wa_chat_phone'
  | 'wa_message_type'
  | 'wa_context_info'
  | 'wa_raw_info'
  | 'wa_raw_message'
  | 'quoted_message_id'
  | 'quoted_stanza_id'
  | 'quoted_participant'
  | 'quoted_text'
  | 'quoted_message_json'
  | 'message_kind'
  | 'location_latitude'
  | 'location_longitude'
  | 'location_name'
  | 'location_address'
  | 'contact_name'
  | 'contact_phone'
  | 'contact_vcard'
  | 'interactive_payload'
>;

function mediaFields(data: MessageMediaFields) {
  return {
    media_type: data.media_type || null,
    media_url: data.media_url || null,
    media_public_url: data.media_public_url || null,
    mime_type: data.mime_type || null,
    file_name: data.file_name || null,
    file_size: data.file_size || null,
    storage_key: data.storage_key || null,
  };
}

function richFields(data: MessageRichFields & Pick<MessageData, 'media_type'>) {
  return {
    wa_chat_jid: data.wa_chat_jid || null,
    wa_sender_jid: data.wa_sender_jid || null,
    wa_sender_phone: data.wa_sender_phone || null,
    wa_chat_phone: data.wa_chat_phone || null,
    wa_message_type: data.wa_message_type || null,
    wa_context_info: data.wa_context_info === undefined ? undefined : data.wa_context_info as any,
    wa_raw_info: data.wa_raw_info === undefined ? undefined : data.wa_raw_info as any,
    wa_raw_message: data.wa_raw_message === undefined ? undefined : data.wa_raw_message as any,
    quoted_message_id: data.quoted_message_id || null,
    quoted_stanza_id: data.quoted_stanza_id || null,
    quoted_participant: data.quoted_participant || null,
    quoted_text: data.quoted_text || null,
    quoted_message_json: data.quoted_message_json === undefined ? undefined : data.quoted_message_json as any,
    message_kind: data.message_kind || (data.media_type ? 'media' : 'text'),
    location_latitude: data.location_latitude ?? null,
    location_longitude: data.location_longitude ?? null,
    location_name: data.location_name || null,
    location_address: data.location_address || null,
    contact_name: data.contact_name || null,
    contact_phone: data.contact_phone || null,
    contact_vcard: data.contact_vcard || null,
    interactive_payload: data.interactive_payload === undefined ? undefined : data.interactive_payload as any,
  };
}

// Counter to skip FIFO on every message — only enforce periodically
const fifoCounter = new Map<string, number>();
const FIFO_CHECK_INTERVAL = 5; // Only run FIFO every 5th message per conversation

function resolveVillageId(villageId?: string): string {
  return villageId || 'unknown';
}

function statusTimestampFields(status: MessageDeliveryStatus, at: Date = new Date()) {
  return {
    ...(status === 'sent' ? { sent_at: at } : {}),
    ...(status === 'delivered' ? { delivered_at: at } : {}),
    ...(status === 'read' ? { read_at: at } : {}),
    ...(status === 'failed' ? { failed_at: at } : {}),
  };
}

function shouldUpdateStatus(current: string | null | undefined, next: MessageDeliveryStatus): boolean {
  const rank: Record<MessageDeliveryStatus, number> = {
    received: 1,
    sent: 2,
    delivered: 3,
    read: 4,
    failed: 5,
  };
  if (!current || !(current in rank)) return true;
  if (current === 'failed') return next === 'failed';
  if (next === 'failed') return true;
  return rank[next] >= rank[current as MessageDeliveryStatus];
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
      ...mediaFields(data),
      ...richFields(data),
      direction: 'IN',
      source: 'WA_WEBHOOK',
      delivery_status: data.delivery_status || 'received',
      status_error: data.status_error || null,
      timestamp: data.timestamp || new Date(),
    },
  });

  // Enforce FIFO
  await enforceFIFO(villageId, channel, data.channel_identifier);
  publishLivechatEvent({
    type: 'message',
    village_id: villageId,
    channel,
    channel_identifier: data.channel_identifier,
  });

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
      ...mediaFields(data),
      ...richFields(data),
      direction: 'OUT',
      source: data.source,
      delivery_status: data.delivery_status || 'sent',
      ...statusTimestampFields(data.delivery_status || 'sent', data.timestamp || new Date()),
      status_error: data.status_error || null,
      timestamp: data.timestamp || new Date(),
    },
  });

  // Enforce FIFO
  await enforceFIFO(villageId, channel, data.channel_identifier);
  publishLivechatEvent({
    type: 'message',
    village_id: villageId,
    channel,
    channel_identifier: data.channel_identifier,
  });

  logger.info('Outgoing message saved', { id: message.id });
  return message;
}

export async function replaceFailedOutgoingMessage(
  id: string,
  data: MessageData & { source: 'AI' | 'SYSTEM' | 'ADMIN' }
): Promise<any> {
  const villageId = resolveVillageId(data.village_id);
  const channel = data.channel || 'WHATSAPP';
  const message = await prisma.message.update({
    where: { id },
    data: {
      village_id: villageId,
      wa_user_id: data.wa_user_id || null,
      channel,
      channel_identifier: data.channel_identifier,
      message_id: data.message_id,
      message_text: data.message_text,
      ...mediaFields(data),
      ...richFields(data),
      direction: 'OUT',
      source: data.source,
      delivery_status: data.delivery_status || 'sent',
      sent_at: null,
      delivered_at: null,
      read_at: null,
      failed_at: null,
      ...statusTimestampFields(data.delivery_status || 'sent', data.timestamp || new Date()),
      status_error: data.status_error || null,
      timestamp: data.timestamp || new Date(),
    },
  });

  publishLivechatEvent({
    type: 'message',
    village_id: message.village_id,
    channel: message.channel,
    channel_identifier: message.channel_identifier,
  });

  logger.info('Failed outgoing message replaced', { id: message.id });
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
    // Table is "messages" (@@map), enum is "ChannelType" in PostgreSQL
    const result = await prisma.$executeRaw`
      DELETE FROM "messages"
      WHERE id IN (
        SELECT id FROM "messages"
        WHERE village_id = ${village_id}
          AND channel = ${channel}::"ChannelType"
          AND channel_identifier = ${channel_identifier}
        ORDER BY "createdAt" ASC, timestamp ASC
        OFFSET 0
        LIMIT (
          SELECT GREATEST(
            (SELECT COUNT(*) FROM "messages"
             WHERE village_id = ${village_id}
               AND channel = ${channel}::"ChannelType"
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
    orderBy: [
      { createdAt: 'desc' },
      { timestamp: 'desc' },
      { id: 'desc' },
    ],
    take: limit,
  });

  logger.info('Retrieved message history', {
    channel,
    channel_identifier,
    count: messages.length,
  });

  return normalizeHistoryMessages(messages.reverse()); // oldest first
}

function attachLegacyReactionActivities(messages: any[]): any[] {
  const byMessageId = new Map(messages.map((message) => [message.message_id, message]));
  const hidden = new Set<string>();

  for (const message of messages) {
    const payload = message.interactive_payload as any;
    if (message.source !== 'SYSTEM' || payload?.status !== 'reaction_received') continue;

    const targetMessageId = payload?.metadata?.targetMessageId;
    const emoji = payload?.metadata?.action?.emoji;
    const target = targetMessageId ? byMessageId.get(targetMessageId) : null;
    if (!target || typeof emoji !== 'string' || !emoji.trim()) continue;

    const currentPayload = target.interactive_payload && typeof target.interactive_payload === 'object' && !Array.isArray(target.interactive_payload)
      ? target.interactive_payload
      : {};
    const currentReactions = Array.isArray(currentPayload.reactions) ? currentPayload.reactions : [];
    target.interactive_payload = {
      ...currentPayload,
      reactions: [
        ...currentReactions.filter((reaction: any) => reaction?.message_id !== message.message_id),
        {
          emoji,
          from: message.channel_identifier,
          message_id: message.message_id,
          timestamp: message.timestamp,
        },
      ],
    };
    hidden.add(message.id);
  }

  return messages.filter((message) => !hidden.has(message.id));
}

function hideSupersededFailedRetries(messages: any[]): any[] {
  const hidden = new Set<string>();

  for (const message of messages) {
    if (message.direction !== 'OUT' || message.source !== 'ADMIN' || message.delivery_status !== 'failed') continue;
    const hasLaterSentSamePayload = messages.some((candidate) => (
      candidate.direction === 'OUT' &&
      candidate.source === 'ADMIN' &&
      candidate.delivery_status !== 'failed' &&
      candidate.message_text === message.message_text &&
      new Date(candidate.createdAt || candidate.timestamp).getTime() > new Date(message.createdAt || message.timestamp).getTime()
    ));
    if (hasLaterSentSamePayload) hidden.add(message.id);
  }

  return messages.filter((message) => !hidden.has(message.id));
}

function normalizeHistoryMessages(messages: any[]): any[] {
  return hideSupersededFailedRetries(attachLegacyReactionActivities(messages));
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

export async function applyMessageReaction(params: {
  village_id?: string;
  channel?: 'WHATSAPP' | 'WEBCHAT';
  channel_identifier: string;
  target_message_id: string;
  reaction_message_id: string;
  emoji: string;
  from?: string | null;
  timestamp?: Date;
}): Promise<boolean> {
  const villageId = resolveVillageId(params.village_id);
  const channel = params.channel || 'WHATSAPP';
  const existing = await prisma.message.findFirst({
    where: {
      village_id: villageId,
      channel,
      channel_identifier: params.channel_identifier,
      message_id: params.target_message_id,
    },
  });
  if (!existing) return false;

  const currentPayload = existing.interactive_payload && typeof existing.interactive_payload === 'object' && !Array.isArray(existing.interactive_payload)
    ? existing.interactive_payload as Record<string, any>
    : {};
  const currentReactions = Array.isArray(currentPayload.reactions) ? currentPayload.reactions : [];
  const nextReactions = params.emoji === 'hapus reaction' || params.emoji === 'remove' || params.emoji === ''
    ? currentReactions.filter((reaction: any) => reaction?.from !== params.from)
    : [
        ...currentReactions.filter((reaction: any) => reaction?.from !== params.from),
        {
          emoji: params.emoji,
          from: params.from || params.channel_identifier,
          message_id: params.reaction_message_id,
          timestamp: (params.timestamp || new Date()).toISOString(),
        },
      ];

  const message = await prisma.message.update({
    where: { id: existing.id },
    data: {
      interactive_payload: {
        ...currentPayload,
        reactions: nextReactions,
      },
    },
  });

  publishLivechatEvent({
    type: 'message',
    village_id: message.village_id,
    channel: message.channel,
    channel_identifier: message.channel_identifier,
  });
  return true;
}

export async function updateMessageMedia(message_id: string, media: MessageMediaFields): Promise<void> {
  const message = await prisma.message.update({
    where: { message_id },
    data: mediaFields(media),
  });
  publishLivechatEvent({
    type: 'message',
    village_id: message.village_id,
    channel: message.channel,
    channel_identifier: message.channel_identifier,
  });
}

export async function updateMessageDeliveryStatus(
  message_id: string,
  status: MessageDeliveryStatus,
  options: { at?: Date; error?: string | null } = {}
): Promise<boolean> {
  const existing = await prisma.message.findUnique({ where: { message_id } });
  if (!existing || !shouldUpdateStatus(existing.delivery_status, status)) return false;

  const message = await prisma.message.update({
    where: { message_id },
    data: {
      delivery_status: status,
      ...statusTimestampFields(status, options.at || new Date()),
      ...(status === 'failed' ? { status_error: options.error || existing.status_error || 'Delivery failed' } : {}),
    },
  });

  publishLivechatEvent({
    type: 'message_status',
    village_id: message.village_id,
    channel: message.channel,
    channel_identifier: message.channel_identifier,
    message_id: message.message_id,
    delivery_status: message.delivery_status,
    sent_at: message.sent_at,
    delivered_at: message.delivered_at,
    read_at: message.read_at,
    failed_at: message.failed_at,
    status_error: message.status_error,
  });
  return true;
}

export async function markConversationMessagesAdminRead(
  channel_identifier: string,
  village_id?: string,
  channel: 'WHATSAPP' | 'WEBCHAT' = 'WHATSAPP'
): Promise<string[]> {
  const resolvedVillageId = village_id ? resolveVillageId(village_id) : undefined;
  const where: any = {
    channel,
    channel_identifier,
    direction: 'IN',
    admin_read_at: null,
  };
  if (resolvedVillageId) where.village_id = resolvedVillageId;

  const unreadMessages = await prisma.message.findMany({
    where,
    select: { message_id: true, village_id: true },
    orderBy: [{ createdAt: 'asc' }, { timestamp: 'asc' }],
    take: 100,
  });
  if (unreadMessages.length === 0) return [];

  const readAt = new Date();
  await prisma.message.updateMany({
    where: { message_id: { in: unreadMessages.map((message) => message.message_id) } },
    data: { admin_read_at: readAt },
  });

  for (const message of unreadMessages) {
    publishLivechatEvent({
      type: 'message_status',
      village_id: resolvedVillageId || message.village_id,
      channel,
      channel_identifier,
      message_id: message.message_id,
      admin_read_at: readAt,
    });
  }

  return unreadMessages.map((message) => message.message_id);
}

export function publishTypingEvent(params: {
  village_id?: string;
  channel?: 'WHATSAPP' | 'WEBCHAT';
  channel_identifier: string;
  typing_state: 'composing' | 'paused';
  actor: 'user' | 'admin' | 'ai';
}): void {
  publishLivechatEvent({
    type: 'typing',
    village_id: params.village_id,
    channel: params.channel,
    channel_identifier: params.channel_identifier,
    typing_state: params.typing_state,
    actor: params.actor,
  });
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
