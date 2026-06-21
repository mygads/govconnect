import { Request, Response } from 'express';
import { addHeldMessage, listHeldMessages, listHeldConversations, deleteHeldMessages, deleteHeldMessageByMessageId } from '../services/held-message.service';
import { publishEvent } from '../services/rabbitmq.service';
import { publishLivechatEvent } from '../services/livechat-events.service';
import { saveOutgoingMessage } from '../services/message.service';
import { updateConversation, clearAIStatus } from '../services/takeover.service';
import { rabbitmqConfig } from '../config/rabbitmq';
import axios from 'axios';
import logger from '../utils/logger';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://ai-service:3002';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

function getVillageId(req: Request): string {
  return (req.headers['x-village-id'] as string) || req.query.village_id as string;
}

/**
 * POST /internal/held-messages/hold
 * AI service calls this when wallet is exhausted to hold the message.
 */
export async function handleHoldMessage(req: Request, res: Response): Promise<void> {
  try {
    const {
      village_id,
      wa_user_id,
      channel = 'WHATSAPP',
      channel_identifier,
      message_id,
      message_text,
      has_media = false,
      media_type,
      media_url,
      media_public_url,
      media_caption,
      media_mime_type,
      media_file_name,
    } = req.body;

    if (!village_id || !channel_identifier || !message_id || !message_text) {
      res.status(400).json({ error: 'village_id, channel_identifier, message_id, message_text required' });
      return;
    }

    const held = await addHeldMessage({
      village_id,
      wa_user_id,
      channel,
      channel_identifier,
      message_id,
      message_text,
      has_media,
      media_type,
      media_url,
      media_public_url,
      media_caption,
      media_mime_type,
      media_file_name,
      reason: 'wallet_exhausted',
    });

    logger.info('Message held for wallet-exhausted village', {
      village_id,
      channel,
      channel_identifier,
      message_id,
    });

    res.status(201).json({ status: 'held', id: held.id, message_id: held.message_id });
  } catch (error: any) {
    logger.error('Failed to hold message', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to hold message' });
  }
}

/**
 * GET /internal/held-messages?channel_identifier=xxx
 * List held messages for a conversation.
 */
export async function handleListHeldMessages(req: Request, res: Response): Promise<void> {
  try {
    const village_id = getVillageId(req);
    const channel_identifier = req.query.channel_identifier as string;

    if (!village_id) {
      res.status(400).json({ error: 'x-village-id header or village_id query required' });
      return;
    }

    const messages = await listHeldMessages(village_id, channel_identifier || undefined);
    res.json({ count: messages.length, messages });
  } catch (error: any) {
    logger.error('Failed to list held messages', { error: error.message });
    res.status(500).json({ error: 'Failed to list held messages' });
  }
}

/**
 * GET /internal/held-messages/conversations
 * List conversations with held messages.
 */
export async function handleListHeldConversations(req: Request, res: Response): Promise<void> {
  try {
    const village_id = getVillageId(req);
    if (!village_id) {
      res.status(400).json({ error: 'x-village-id header required' });
      return;
    }

    const conversations = await listHeldConversations(village_id);
    res.json({ count: conversations.length, conversations });
  } catch (error: any) {
    logger.error('Failed to list held conversations', { error: error.message });
    res.status(500).json({ error: 'Failed to list held conversations' });
  }
}

/**
 * Flush all held messages for one conversation. Shared by the per-conversation
 * and flush-all endpoints so there is a single code path (no self-HTTP calls).
 * Returns the number of messages re-queued.
 */
async function flushConversation(village_id: string, channel_identifier: string): Promise<{ flushed: number; channel: 'WHATSAPP' | 'WEBCHAT' | null }> {
  const messages = await listHeldMessages(village_id, channel_identifier);
  if (messages.length === 0) {
    return { flushed: 0, channel: null };
  }

  const channel = messages[0].channel;
  let flushed = 0;

  if (channel === 'WHATSAPP') {
    const flushedIds: string[] = [];
    for (const msg of messages) {
      try {
        await publishEvent(rabbitmqConfig.ROUTING_KEYS.MESSAGE_RECEIVED, {
          village_id: msg.village_id,
          wa_user_id: msg.channel_identifier,
          message: msg.message_text,
          message_id: msg.message_id,
          received_at: msg.created_at.toISOString(),
          has_media: msg.has_media,
          media_type: msg.media_type,
          media_url: msg.media_url,
          media_public_url: msg.media_public_url,
          media_caption: msg.media_caption,
        });
        flushedIds.push(msg.id);
        flushed++;
      } catch (err: any) {
        logger.error('Failed to re-publish held message', { message_id: msg.message_id, error: err.message });
      }
    }
    await deleteHeldMessages(flushedIds);
  } else {
    // WEBCHAT: AI service runs the agent and delivers via livechat SSE.
    // It calls back to ack-webchat-delivery to delete each held row.
    const resp = await axios.post(`${AI_SERVICE_URL}/internal/flush-held-webchat`, {
      village_id,
      channel_identifier,
      messages: messages.map(m => ({
        id: m.id,
        message_id: m.message_id,
        message_text: m.message_text,
        wa_user_id: m.wa_user_id,
        has_media: m.has_media,
        media_type: m.media_type,
        media_url: m.media_url,
        media_public_url: m.media_public_url,
        media_caption: m.media_caption,
      })),
    }, {
      headers: {
        'x-internal-api-key': INTERNAL_API_KEY,
        'x-village-id': village_id,
      },
      timeout: 60000,
    });
    flushed = resp.data?.flushed ?? messages.length;
  }

  return { flushed, channel };
}

/**
 * POST /internal/held-messages/flush?channel_identifier=xxx
 * Flush all held messages for one conversation.
 */
export async function handleFlushHeldMessages(req: Request, res: Response): Promise<void> {
  try {
    const village_id = getVillageId(req);
    const channel_identifier = req.query.channel_identifier as string;

    if (!village_id || !channel_identifier) {
      res.status(400).json({ error: 'village_id and channel_identifier required' });
      return;
    }

    const { flushed, channel } = await flushConversation(village_id, channel_identifier);
    if (channel === null) {
      res.json({ status: 'no_messages', flushed: 0 });
      return;
    }

    res.json({ status: 'flushed', flushed, channel, channel_identifier });
  } catch (error: any) {
    logger.error('Failed to flush held messages', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to flush held messages' });
  }
}

/**
 * POST /internal/held-messages/flush-all
 * Flush all held messages for the entire village.
 */
export async function handleFlushAllHeldMessages(req: Request, res: Response): Promise<void> {
  try {
    const village_id = getVillageId(req);
    if (!village_id) {
      res.status(400).json({ error: 'x-village-id header required' });
      return;
    }

    const conversations = await listHeldConversations(village_id);
    if (conversations.length === 0) {
      res.json({ status: 'no_messages', flushed: 0, conversations: 0 });
      return;
    }

    let totalFlushed = 0;
    let failedConversations = 0;
    for (const conv of conversations) {
      try {
        const { flushed } = await flushConversation(village_id, conv.channel_identifier);
        totalFlushed += flushed;
      } catch (err: any) {
        failedConversations++;
        logger.error('Failed to flush conversation', { channel_identifier: conv.channel_identifier, error: err.message });
      }
    }

    res.json({
      status: 'flushed',
      flushed: totalFlushed,
      conversations: conversations.length,
      failed_conversations: failedConversations,
    });
  } catch (error: any) {
    logger.error('Failed to flush all held messages', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to flush all held messages' });
  }
}

/**
 * POST /internal/held-messages/deliver-webchat
 * AI service calls this after generating a flushed webchat reply. It persists the
 * reply, emits a livechat SSE event (source AI) so the open browser receives it,
 * clears the pending_balance status, and deletes the held row.
 */
export async function handleDeliverWebchatReply(req: Request, res: Response): Promise<void> {
  try {
    const village_id = getVillageId(req);
    const { channel_identifier, held_message_id, reply_text, guidance_text } = req.body;

    if (!village_id || !channel_identifier || !reply_text) {
      res.status(400).json({ error: 'village_id, channel_identifier, reply_text required' });
      return;
    }

    const replyMessageId = `ai-flush-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await saveOutgoingMessage({
      village_id,
      channel: 'WEBCHAT',
      channel_identifier,
      message_id: replyMessageId,
      message_text: reply_text,
      source: 'AI',
    });

    await updateConversation(channel_identifier, reply_text.substring(0, 100), undefined, 'reset', village_id, 'WEBCHAT');
    await clearAIStatus(channel_identifier, village_id, 'WEBCHAT');

    publishLivechatEvent({
      type: 'message',
      village_id,
      channel: 'WEBCHAT',
      channel_identifier,
      message_id: replyMessageId,
      message: reply_text,
      actor: 'ai',
    });

    if (guidance_text && String(guidance_text).trim()) {
      const guidanceMessageId = `ai-flush-guidance-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await saveOutgoingMessage({
        village_id,
        channel: 'WEBCHAT',
        channel_identifier,
        message_id: guidanceMessageId,
        message_text: guidance_text,
        source: 'AI',
      });
      publishLivechatEvent({
        type: 'message',
        village_id,
        channel: 'WEBCHAT',
        channel_identifier,
        message_id: guidanceMessageId,
        message: guidance_text,
        actor: 'ai',
      });
    }

    if (held_message_id) {
      await deleteHeldMessageByMessageId(held_message_id);
    }

    res.json({ status: 'delivered', message_id: replyMessageId });
  } catch (error: any) {
    logger.error('Failed to deliver webchat reply', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to deliver webchat reply' });
  }
}
