import { Request, Response } from 'express';
import {
  getMessageHistory,
  saveIncomingMessage,
  saveOutgoingMessage,
  logSentMessage,
  checkDuplicateMessage,
} from '../services/message.service';
import {
  updateConversation,
  updateConversationUserProfile,
  isUserInTakeover,
  setAIProcessing,
  clearAIStatus,
  setAIError,
  setAIPendingBalance,
} from '../services/takeover.service';
import { sendTextMessage, sendTypingIndicator, markMessageAsRead } from '../services/wa.service';
import { publishLivechatEvent } from '../services/livechat-events.service';
import logger from '../utils/logger';
import { getQuery } from '../utils/http';

function resolveVillageId(req: Request): string | undefined {
  const bodyVillageId = typeof req.body?.village_id === 'string' ? req.body.village_id : undefined;
  const headerVillageId = typeof req.headers['x-village-id'] === 'string' ? req.headers['x-village-id'] : undefined;
  const queryVillageId = getQuery(req, 'village_id');
  return bodyVillageId || headerVillageId || queryVillageId || undefined;
}

function requireVillageId(req: Request, res: Response): string | null {
  const villageId = resolveVillageId(req)?.trim();
  if (!villageId) {
    res.status(400).json({ error: 'village_id is required for multi-tenancy isolation' });
    return null;
  }
  return villageId;
}

/**
 * Get message history
 * GET /internal/messages?wa_user_id=xxx&limit=30
 */
export async function getMessages(req: Request, res: Response): Promise<void> {
  try {
    const village_id = requireVillageId(req, res);
    if (!village_id) return;
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
        media_type: m.media_type,
        media_url: m.media_url,
        media_public_url: m.media_public_url,
        mime_type: m.mime_type,
        file_name: m.file_name,
        file_size: m.file_size,
        storage_key: m.storage_key,
        direction: m.direction,
        source: m.source,
        delivery_status: m.delivery_status,
        sent_at: m.sent_at,
        delivered_at: m.delivered_at,
        read_at: m.read_at,
        failed_at: m.failed_at,
        status_error: m.status_error,
        admin_read_at: m.admin_read_at,
        timestamp: m.timestamp,
        createdAt: m.createdAt,
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
    const village_id = requireVillageId(req, res);
    if (!village_id) return;
    const { wa_user_id, message, notification_type, reference_number, entity_status } = req.body;

    const result = await sendTextMessage(wa_user_id, message, village_id);
    const messageId = result.message_id || `system-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    await saveOutgoingMessage({
      village_id,
      wa_user_id,
      channel: 'WHATSAPP',
      channel_identifier: wa_user_id,
      message_id: messageId,
      message_text: message,
      reference_number: reference_number || null,
      notification_type: notification_type || null,
      entity_status: entity_status || null,
      source: 'SYSTEM',
      delivery_status: result.success ? 'sent' : 'failed',
      status_error: result.success ? undefined : result.error,
    });

    await logSentMessage({
      village_id,
      wa_user_id,
      channel: 'WHATSAPP',
      channel_identifier: wa_user_id,
      message_text: message,
      reference_number: reference_number || null,
      notification_type: notification_type || null,
      entity_status: entity_status || null,
      status: result.success ? 'sent' : 'failed',
      error_msg: result.success ? undefined : result.error,
    });

    if (result.success) {
      res.json({
        status: 'sent',
        message_id: messageId,
      });
      return;
    }

    logger.warn('WhatsApp transport failed but system message was stored', {
      village_id,
      wa_user_id,
      message_id: messageId,
      error: result.error,
    });

    res.json({
      status: 'stored_transport_failed',
      message_id: messageId,
      error: result.error || 'Failed to send message',
    });
  } catch (error: any) {
    logger.error('Send message error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Deliver a lifecycle / system notification to a webchat user.
 *
 * POST /internal/webchat-notification
 * Body: {
 *   village_id: string,
 *   channel_identifier: string,   // webchat user id / session id
 *   message: string,
 *   notification_type?: string,   // e.g. "status_updated", "service_approved"
 *   reference_number?: string,    // LAP-xxx / LAY-xxx for context
 * }
 *
 * Unlike WhatsApp where we push a message via the provider, webchat
 * lifecycle notifications are delivered by:
 *   (1) persisting a SYSTEM-origin message to conversation history, and
 *   (2) publishing a livechat SSE event so an active webchat UI sees it
 *       immediately, or picks it up on next session fetch.
 *
 * notification-service calls this instead of skipping webchat events.
 */
export async function sendWebchatSystemNotification(req: Request, res: Response): Promise<void> {
  try {
    const village_id = requireVillageId(req, res);
    if (!village_id) return;
    const {
      channel_identifier,
      message,
      notification_type,
      reference_number,
      entity_status,
    } = req.body || {};

    if (!channel_identifier || typeof channel_identifier !== 'string') {
      res.status(400).json({ status: 'error', error: 'channel_identifier required' });
      return;
    }
    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ status: 'error', error: 'message required' });
      return;
    }

    const messageId = `sysnotif-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    await saveOutgoingMessage({
      village_id,
      wa_user_id: undefined,
      channel: 'WEBCHAT',
      channel_identifier,
      message_id: messageId,
      message_text: message,
      reference_number: reference_number || null,
      notification_type: notification_type || null,
      entity_status: entity_status || null,
      source: 'SYSTEM',
      delivery_status: 'delivered',
    });

    await logSentMessage({
      village_id,
      wa_user_id: null as any,
      channel: 'WEBCHAT',
      channel_identifier,
      message_text: message,
      reference_number: reference_number || null,
      notification_type: notification_type || null,
      entity_status: entity_status || null,
      status: 'sent',
    });

    try {
      publishLivechatEvent({
        type: 'webchat_system_notification',
        village_id,
        channel: 'WEBCHAT',
        channel_identifier,
        message,
        message_id: messageId,
        notification_type: notification_type || 'system',
        reference_number: reference_number || null,
      });
    } catch (sseErr: any) {
      logger.warn('Failed to publish livechat SSE for webchat notification', {
        error: sseErr.message,
        channel_identifier,
      });
    }

    res.json({
      status: 'delivered',
      channel: 'WEBCHAT',
      message_id: messageId,
    });
  } catch (error: any) {
    logger.error('Webchat system notification error', { error: error.message });
    res.status(500).json({ status: 'error', error: 'Internal server error' });
  }
}

export async function updateAIStatus(req: Request, res: Response): Promise<void> {
  try {
    const village_id = requireVillageId(req, res);
    if (!village_id) return;
    const {
      channel,
      channel_identifier,
      wa_user_id,
      action,
      message_id,
      error_message,
    } = req.body || {};

    const resolvedChannel = String(channel || 'WHATSAPP').toUpperCase() === 'WEBCHAT' ? 'WEBCHAT' : 'WHATSAPP';
    const resolvedIdentifier = channel_identifier || wa_user_id;

    if (!resolvedIdentifier || typeof resolvedIdentifier !== 'string') {
      res.status(400).json({ status: 'error', error: 'channel_identifier or wa_user_id is required' });
      return;
    }

    switch (action) {
      case 'processing':
        if (!message_id || typeof message_id !== 'string') {
          res.status(400).json({ status: 'error', error: 'message_id is required for processing status' });
          return;
        }
        await setAIProcessing(resolvedIdentifier, message_id, village_id, resolvedChannel);
        break;
      case 'clear':
        await clearAIStatus(resolvedIdentifier, village_id, resolvedChannel);
        break;
      case 'error':
        if (!error_message || typeof error_message !== 'string') {
          res.status(400).json({ status: 'error', error: 'error_message is required for error status' });
          return;
        }
        await setAIError(resolvedIdentifier, error_message, typeof message_id === 'string' ? message_id : undefined, village_id, resolvedChannel);
        break;
      case 'pending_balance':
        await setAIPendingBalance(resolvedIdentifier, typeof message_id === 'string' ? message_id : undefined, village_id, resolvedChannel);
        break;
      default:
        res.status(400).json({ status: 'error', error: 'Invalid action' });
        return;
    }

    res.json({
      status: 'ok',
      action,
      channel: resolvedChannel,
      channel_identifier: resolvedIdentifier,
    });
  } catch (error: any) {
    logger.error('Update AI status error', { error: error.message });
    res.status(500).json({ status: 'error', error: 'Internal server error' });
  }
}

/**
 * Send typing indicator
 * POST /internal/typing
 * Body: { wa_user_id: "628xxx", state: "composing" | "paused" | "stop" }
 */
export async function setTyping(req: Request, res: Response): Promise<void> {
  try {
    const village_id = requireVillageId(req, res);
    if (!village_id) return;
    const { wa_user_id, state = 'composing' } = req.body;

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
    const village_id = requireVillageId(req, res);
    if (!village_id) return;
    const { wa_user_id, channel_identifier, channel, message_id, message_text, direction, source, metadata } = req.body;
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
    const resolvedSource = source || (metadata?.source === 'ai_service' ? 'AI' : undefined) || 'AI';
    if (direction !== 'IN' && resolvedSource === 'AI') {
      const inTakeover = await isUserInTakeover(resolvedIdentifier, village_id, resolvedChannel);
      if (inTakeover) {
        logger.info('Suppressing stale AI message because takeover is active', {
          channel: resolvedChannel,
          channel_identifier: resolvedIdentifier,
          message_id: finalMessageId,
        });
        res.status(200).json({
          status: 'suppressed_takeover',
          message_id: finalMessageId,
        });
        return;
      }
    }

    const isDuplicate = await checkDuplicateMessage(finalMessageId);
    if (isDuplicate) {
      logger.info('Message already stored, returning idempotent success', {
        channel: resolvedChannel,
        channel_identifier: resolvedIdentifier,
        message_id: finalMessageId,
      });
      res.status(200).json({
        status: 'already_stored',
        message_id: finalMessageId,
      });
      return;
    }

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
        source: resolvedSource,
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
    const village_id = requireVillageId(req, res);
    if (!village_id) return;
    const { wa_user_id, message_ids } = req.body;

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
    const village_id = requireVillageId(req, res);
    if (!village_id) return;
    const {
      channel_identifier,
      channel = 'WHATSAPP',
      user_name,
      user_phone
    } = req.body;

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
