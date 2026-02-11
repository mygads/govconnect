import { Request, Response } from 'express';
import {
  getMessageHistory,
  saveIncomingMessage,
  saveOutgoingMessage,
  logSentMessage,
} from '../services/message.service';
import { updateConversation, updateConversationUserProfile } from '../services/takeover.service';
import { sendTextMessage, sendTypingIndicator, markMessageAsRead } from '../services/wa.service';
import logger from '../utils/logger';
import { getQuery } from '../utils/http';

/**
 * Get message history
 * GET /internal/messages?wa_user_id=xxx&limit=30
 */
export async function getMessages(req: Request, res: Response): Promise<void> {
  try {
    const village_id = getQuery(req, 'village_id');
    const wa_user_id = getQuery(req, 'wa_user_id');
    const channel_identifier = getQuery(req, 'channel_identifier');
    const channel = (getQuery(req, 'channel') || 'WHATSAPP').toUpperCase() as 'WHATSAPP' | 'WEBCHAT';
    const limitRaw = getQuery(req, 'limit');
    const limit = limitRaw ? parseInt(limitRaw, 10) : 30;
    const resolvedIdentifier = channel_identifier || wa_user_id;

    // Validate wa_user_id
    if (!resolvedIdentifier) {
      res.status(400).json({ 
        error: 'channel_identifier or wa_user_id query parameter is required',
        messages: [],
        total: 0,
      });
      return;
    }

    const messages = await getMessageHistory(resolvedIdentifier, limit, village_id, channel);

    res.json({
      messages: messages.map((m) => ({
        id: m.id,
        message_text: m.message_text,
        direction: m.direction,
        source: m.source,
        timestamp: m.timestamp,
      })),
      total: messages.length,
    });
  } catch (error: any) {
    logger.error('Get messages error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Send message via WhatsApp
 * POST /internal/send
 * Body: { wa_user_id: "628xxx", message: "text" }
 */
export async function sendMessage(req: Request, res: Response): Promise<void> {
  try {
    const { village_id, wa_user_id, message } = req.body;

    // Send via WhatsApp API
    const result = await sendTextMessage(wa_user_id, message, village_id);

    if (result.success && result.message_id) {
      // Save outgoing message
      await saveOutgoingMessage({
        village_id,
        wa_user_id,
        channel: 'WHATSAPP',
        channel_identifier: wa_user_id,
        message_id: result.message_id,
        message_text: message,
        source: 'SYSTEM',
      });

      // Log success
      await logSentMessage({
        village_id,
        wa_user_id,
        channel: 'WHATSAPP',
        channel_identifier: wa_user_id,
        message_text: message,
        status: 'sent',
      });

      res.json({
        status: 'sent',
        message_id: result.message_id,
      });
    } else {
      // Log failure
      await logSentMessage({
        village_id,
        wa_user_id,
        channel: 'WHATSAPP',
        channel_identifier: wa_user_id,
        message_text: message,
        status: 'failed',
        error_msg: result.error,
      });

      res.status(500).json({
        status: 'failed',
        error: result.error || 'Failed to send message',
      });
    }
  } catch (error: any) {
    logger.error('Send message error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Send typing indicator
 * POST /internal/typing
 * Body: { wa_user_id: "628xxx", state: "composing" | "paused" | "stop" }
 */
export async function setTyping(req: Request, res: Response): Promise<void> {
  try {
    const headerVillageId = typeof req.headers['x-village-id'] === 'string' ? req.headers['x-village-id'] : undefined;
    const { village_id: bodyVillageId, wa_user_id, state = 'composing' } = req.body;
    const village_id = bodyVillageId || headerVillageId;
    
    // Map 'stop' to 'paused' since WA API doesn't have 'stop'
    const waState = state === 'stop' ? 'paused' : state;

    const result = await sendTypingIndicator(wa_user_id, waState, village_id);

    if (result) {
      logger.debug('Typing indicator sent', { wa_user_id, state });
      res.json({ status: 'ok', state });
    } else {
      // Typing indicator might be disabled, still return ok
      logger.debug('Typing indicator skipped (disabled)', { wa_user_id });
      res.json({ status: 'ok', state, note: 'typing_disabled' });
    }
  } catch (error: any) {
    logger.error('Typing indicator error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Store message in database (supports both IN and OUT)
 * POST /internal/messages
 * Body: { wa_user_id: "628xxx", message_text: "text", direction: "IN"|"OUT", source: "USER"|"AI"|"ADMIN", metadata: {...} }
 * 
 * This is called by AI service to store messages in database
 * Used for webchat integration and testing mode
 */
export async function storeMessage(req: Request, res: Response): Promise<void> {
  try {
    const headerVillageId = typeof req.headers['x-village-id'] === 'string' ? req.headers['x-village-id'] : undefined;
    const { village_id: bodyVillageId, wa_user_id, channel_identifier, channel, message_id, message_text, direction, source, metadata } = req.body;
    const village_id = bodyVillageId || headerVillageId;
    const resolvedChannel = (channel || metadata?.channel || 'WHATSAPP') as 'WHATSAPP' | 'WEBCHAT';
    const resolvedIdentifier = channel_identifier || wa_user_id;
    
    if (!resolvedIdentifier || !message_text) {
      res.status(400).json({ 
        error: 'channel_identifier/wa_user_id and message_text are required' 
      });
      return;
    }
    
    // Generate a unique message ID if not provided
    const finalMessageId = message_id || `${direction === 'IN' ? 'in' : 'ai'}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    
    let message;
    if (direction === 'IN') {
      // Save incoming message (from user)
      message = await saveIncomingMessage({
        village_id,
        wa_user_id: resolvedChannel === 'WHATSAPP' ? resolvedIdentifier : undefined,
        channel: resolvedChannel,
        channel_identifier: resolvedIdentifier,
        message_id: finalMessageId,
        message_text,
      });
    } else {
      // Save outgoing message (from AI or admin)
      message = await saveOutgoingMessage({
        village_id,
        wa_user_id: resolvedChannel === 'WHATSAPP' ? resolvedIdentifier : undefined,
        channel: resolvedChannel,
        channel_identifier: resolvedIdentifier,
        message_id: finalMessageId,
        message_text,
        source: source || 'AI',
      });
    }
    
    // Update conversation
    // Don't pass a hardcoded "Web User xxx" name — it would overwrite
    // the real name synced via /internal/conversations/user-profile.
    // The conversation create (upsert) in takeover.service already
    // keeps the existing user_name when the update value is undefined.
    // For incoming messages: increment unread count
    // For outgoing messages (AI/admin reply): reset unread count to 0 (message processed)
    const unreadAction = direction === 'IN' ? true : 'reset';
    await updateConversation(
      resolvedIdentifier,
      message_text.substring(0, 100),
      undefined,
      unreadAction,
      village_id,
      resolvedChannel
    );
    
    logger.info('Message stored in database', { 
      channel: resolvedChannel,
      channel_identifier: resolvedIdentifier,
      message_id: finalMessageId,
      direction,
      source,
      metadata_channel: metadata?.channel,
    });
    
    res.status(201).json({ 
      status: 'stored',
      message_id: finalMessageId,
      id: message.id,
    });
  } catch (error: any) {
    logger.error('Store message error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Mark messages as read in WhatsApp
 * POST /internal/messages/read
 * Body: { wa_user_id: "628xxx", message_ids: ["msgid1", "msgid2"] }
 * 
 * This is called by AI service when it starts processing messages
 * so user sees "read" status (blue checkmarks) at that moment
 */
export async function markMessagesRead(req: Request, res: Response): Promise<void> {
  try {
    const headerVillageId = typeof req.headers['x-village-id'] === 'string' ? req.headers['x-village-id'] : undefined;
    const { village_id: bodyVillageId, wa_user_id, message_ids } = req.body;
    const village_id = bodyVillageId || headerVillageId;
    
    if (!wa_user_id || !message_ids || !Array.isArray(message_ids)) {
      res.status(400).json({ 
        error: 'wa_user_id and message_ids array are required' 
      });
      return;
    }
    
    // Mark messages as read in WhatsApp
    // Use wa_user_id as both chat and sender for simplicity
    await markMessageAsRead(message_ids, wa_user_id, wa_user_id, village_id);
    
    logger.info('Messages marked as read', { 
      wa_user_id, 
      count: message_ids.length 
    });
    
    res.json({ 
      status: 'ok', 
      marked_count: message_ids.length 
    });
  } catch (error: any) {
    logger.error('Mark messages read error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Update user profile in conversation
 * PATCH /internal/conversations/user-profile
 * Body: { channel_identifier: "xxx", channel: "WEBCHAT", user_name?: "John", user_phone?: "628xxx", village_id?: "xxx" }
 * 
 * Called by AI service when user provides their name or phone during conversation
 */
export async function updateUserProfile(req: Request, res: Response): Promise<void> {
  try {
    const headerVillageId = typeof req.headers['x-village-id'] === 'string' ? req.headers['x-village-id'] : undefined;
    const { 
      channel_identifier, 
      channel = 'WHATSAPP', 
      user_name, 
      user_phone,
      village_id: bodyVillageId 
    } = req.body;
    
    const village_id = bodyVillageId || headerVillageId;
    
    if (!channel_identifier) {
      res.status(400).json({ error: 'channel_identifier is required' });
      return;
    }
    
    if (!user_name && !user_phone) {
      res.status(400).json({ error: 'At least one of user_name or user_phone is required' });
      return;
    }
    
    await updateConversationUserProfile(
      channel_identifier,
      { user_name, user_phone },
      village_id,
      channel.toUpperCase() as 'WHATSAPP' | 'WEBCHAT'
    );
    
    logger.info('User profile updated', { 
      channel,
      channel_identifier, 
      user_name,
      user_phone: user_phone ? '***' : undefined,
    });
    
    res.json({ 
      status: 'ok',
      updated: { user_name, user_phone: user_phone ? true : false },
    });
  } catch (error: any) {
    logger.error('Update user profile error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
}
