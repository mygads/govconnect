import { Request, Response } from 'express';
import {
  startTakeover,
  endTakeover,
  getActiveTakeovers,
  getActiveTakeover,
  isUserInTakeover,
  getConversations,
  getConversation,
  markConversationAsRead,
  updateConversation,
} from '../services/takeover.service';
import { getMessageHistory, saveOutgoingMessage } from '../services/message.service';
import { sendTextMessage } from '../services/wa.service';
import logger from '../utils/logger';
import { getParam, getQuery } from '../utils/http';

function resolveVillageId(req: Request): string | undefined {
  const queryVillageId = getQuery(req, 'village_id');
  const headerVillageId = typeof req.headers['x-village-id'] === 'string' ? req.headers['x-village-id'] : undefined;
  return queryVillageId || headerVillageId;
}

function resolveChannel(req: Request, identifier?: string): 'WHATSAPP' | 'WEBCHAT' {
  const queryChannel = (getQuery(req, 'channel') || req.body?.channel) as string | undefined;
  if (queryChannel && queryChannel.toUpperCase() === 'WEBCHAT') return 'WEBCHAT';
  if (identifier && identifier.startsWith('web_')) return 'WEBCHAT';
  return 'WHATSAPP';
}

/**
 * Start takeover for a user
 * POST /internal/takeover/:wa_user_id
 */
export async function handleStartTakeover(req: Request, res: Response): Promise<void> {
  try {
    const wa_user_id = getParam(req, 'wa_user_id');
    const { admin_id, admin_name, reason } = req.body;
    const villageId = resolveVillageId(req);
    const channel = resolveChannel(req, wa_user_id || undefined);

    if (!wa_user_id || !admin_id) {
      res.status(400).json({ error: 'wa_user_id and admin_id are required' });
      return;
    }

    const session = await startTakeover(wa_user_id, admin_id, admin_name, reason, villageId, channel);

    res.json({
      success: true,
      data: session,
      message: `Takeover started for ${wa_user_id}`,
    });
  } catch (error: any) {
    logger.error('Failed to start takeover', { error: error.message });
    res.status(500).json({ error: 'Failed to start takeover' });
  }
}

/**
 * End takeover for a user
 * DELETE /internal/takeover/:wa_user_id
 */
export async function handleEndTakeover(req: Request, res: Response): Promise<void> {
  try {
    const wa_user_id = getParam(req, 'wa_user_id');
    const villageId = resolveVillageId(req);
    const channel = resolveChannel(req, wa_user_id || undefined);

    if (!wa_user_id) {
      res.status(400).json({ error: 'wa_user_id is required' });
      return;
    }

    const ended = await endTakeover(wa_user_id, villageId, channel);

    res.json({
      success: true,
      ended,
      message: ended ? `Takeover ended for ${wa_user_id}` : 'No active takeover found',
    });
  } catch (error: any) {
    logger.error('Failed to end takeover', { error: error.message });
    res.status(500).json({ error: 'Failed to end takeover' });
  }
}

/**
 * Get all active takeovers
 * GET /internal/takeover
 */
export async function handleGetActiveTakeovers(_req: Request, res: Response): Promise<void> {
  try {
    const sessions = await getActiveTakeovers();

    res.json({
      success: true,
      data: sessions,
      count: sessions.length,
    });
  } catch (error: any) {
    logger.error('Failed to get active takeovers', { error: error.message });
    res.status(500).json({ error: 'Failed to get active takeovers' });
  }
}

/**
 * Check if user is in takeover
 * GET /internal/takeover/:wa_user_id/status
 */
export async function handleCheckTakeover(req: Request, res: Response): Promise<void> {
  try {
    const wa_user_id = getParam(req, 'wa_user_id');
    const villageId = resolveVillageId(req);
    const channel = resolveChannel(req, wa_user_id || undefined);

    if (!wa_user_id) {
      res.status(400).json({ error: 'wa_user_id is required' });
      return;
    }

    const session = await getActiveTakeover(wa_user_id, villageId, channel);

    res.json({
      success: true,
      is_takeover: !!session,
      session,
    });
  } catch (error: any) {
    logger.error('Failed to check takeover status', { error: error.message });
    res.status(500).json({ error: 'Failed to check takeover status' });
  }
}

/**
 * Get conversations list for live chat
 * GET /internal/conversations
 * Query params: status=all|takeover|bot, limit=50
 */
export async function handleGetConversations(req: Request, res: Response): Promise<void> {
  try {
    const statusRaw = getQuery(req, 'status');
    const status = (statusRaw as 'all' | 'takeover' | 'bot') || 'all';
    const limitRaw = getQuery(req, 'limit');
    const limit = limitRaw ? parseInt(limitRaw, 10) : 50;
    const villageId = resolveVillageId(req);

    const conversations = await getConversations(status, limit, villageId);

    res.json({
      success: true,
      data: conversations,
      count: conversations.length,
    });
  } catch (error: any) {
    logger.error('Failed to get conversations', { error: error.message });
    res.status(500).json({ error: 'Failed to get conversations' });
  }
}

/**
 * Get single conversation with messages
 * GET /internal/conversations/:wa_user_id
 */
export async function handleGetConversation(req: Request, res: Response): Promise<void> {
  try {
    const wa_user_id = getParam(req, 'wa_user_id');
    if (!wa_user_id) {
      res.status(400).json({ error: 'wa_user_id is required' });
      return;
    }

    const limitRaw = getQuery(req, 'limit');
    const limit = limitRaw ? parseInt(limitRaw, 10) : 50;
    const villageId = resolveVillageId(req);
    const channel = resolveChannel(req, wa_user_id);

    const conversation = await getConversation(wa_user_id, villageId, channel);
    const messages = await getMessageHistory(wa_user_id, limit, villageId, channel);
    const takeoverSession = await getActiveTakeover(wa_user_id, villageId, channel);

    // Mark as read when admin opens conversation
    await markConversationAsRead(wa_user_id, villageId, channel);

    res.json({
      success: true,
      data: {
        conversation,
        messages, // Already sorted oldest first from getMessageHistory
        is_takeover: !!takeoverSession,
        takeover_session: takeoverSession,
      },
    });
  } catch (error: any) {
    logger.error('Failed to get conversation', { error: error.message });
    res.status(500).json({ error: 'Failed to get conversation' });
  }
}

/**
 * Admin sends message to user
 * POST /internal/conversations/:wa_user_id/send
 *
 * Supports both WhatsApp users (628xxx) and Webchat users (web_xxx)
 * - WhatsApp: Sends via WhatsApp API
 * - Webchat: Stores in database, user polls for new messages
 */
export async function handleAdminSendMessage(req: Request, res: Response): Promise<void> {
  try {
    const wa_user_id = getParam(req, 'wa_user_id');
    const { message, admin_id, admin_name } = req.body;
    const villageId = resolveVillageId(req);
    const channel = resolveChannel(req, wa_user_id || undefined);

    if (!wa_user_id) {
      res.status(400).json({ error: 'wa_user_id is required' });
      return;
    }

    if (!message) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    // Check if takeover is active (optional - can still send without takeover)
    const isTakeover = await isUserInTakeover(wa_user_id, villageId, channel);
    const isWebchatUser = channel === 'WEBCHAT';

    if (isWebchatUser) {
      // For webchat users, just save to database
      // User will poll for new messages via webchat endpoint
      const messageId = `admin-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      await saveOutgoingMessage({
        village_id: villageId, // Required for webchat poll filtering
        wa_user_id: undefined, // Webchat users don't have wa_user_id
        channel,
        channel_identifier: wa_user_id,
        message_id: messageId,
        message_text: message,
        source: 'ADMIN',
      });

      // Update conversation summary and reset unread count (admin has responded)
      await updateConversation(wa_user_id, message, undefined, 'reset', villageId, channel);

      logger.info('Admin sent webchat message', {
        wa_user_id,
        admin_id,
        admin_name,
        is_takeover: isTakeover,
        message_id: messageId,
        channel: 'webchat',
      });

      res.json({
        success: true,
        message_id: messageId,
        is_takeover: isTakeover,
        channel: 'webchat',
      });
    } else {
      // For WhatsApp users, send via WhatsApp API
      const result = await sendTextMessage(wa_user_id, message, villageId);

      if (result.success) {
        // Generate message ID if not provided by WA
        const messageId = result.message_id || `admin-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

        // Save message to database so it appears in chat history
        await saveOutgoingMessage({
          village_id: villageId,
          wa_user_id,
          channel,
          channel_identifier: wa_user_id,
          message_id: messageId,
          message_text: message,
          source: 'ADMIN',
        });

        // Update conversation summary and reset unread count (admin has responded)
        await updateConversation(wa_user_id, message, undefined, 'reset', villageId, channel);

        logger.info('Admin sent WhatsApp message', {
          wa_user_id,
          admin_id,
          admin_name,
          is_takeover: isTakeover,
          message_id: messageId,
          channel: 'whatsapp',
        });

        res.json({
          success: true,
          message_id: messageId,
          is_takeover: isTakeover,
          channel: 'whatsapp',
        });
      } else {
        res.status(500).json({
          error: 'Failed to send message',
          details: result.error,
        });
      }
    }
  } catch (error: any) {
    logger.error('Failed to send admin message', { error: error.message });
    res.status(500).json({ error: 'Failed to send message' });
  }
}

/**
 * Mark conversation as read
 * POST /internal/conversations/:wa_user_id/read
 */
export async function handleMarkAsRead(req: Request, res: Response): Promise<void> {
  try {
    const wa_user_id = getParam(req, 'wa_user_id');
    if (!wa_user_id) {
      res.status(400).json({ error: 'wa_user_id is required' });
      return;
    }
    const villageId = resolveVillageId(req);
    const channel = resolveChannel(req, wa_user_id);

    await markConversationAsRead(wa_user_id, villageId, channel);

    res.json({
      success: true,
      message: 'Conversation marked as read',
    });
  } catch (error: any) {
    logger.error('Failed to mark as read', { error: error.message });
    res.status(500).json({ error: 'Failed to mark as read' });
  }
}

/**
 * Delete conversation and all messages for a user
 * DELETE /internal/conversations/:wa_user_id
 */
export async function handleDeleteConversation(req: Request, res: Response): Promise<void> {
  try {
    const wa_user_id = getParam(req, 'wa_user_id');
    const villageId = resolveVillageId(req);
    const channel = resolveChannel(req, wa_user_id || undefined);

    if (!wa_user_id) {
      res.status(400).json({ error: 'wa_user_id is required' });
      return;
    }

    // Import prisma for direct database operations
    const { deleteConversationHistory } = await import('../services/takeover.service');

    await deleteConversationHistory(wa_user_id, villageId, channel);

    // Clear AI user profile/caches so name is forgotten (fresh session)
    try {
      const { config } = await import('../config/env');
      await fetch(`${config.AI_SERVICE_URL}/admin/cache/clear-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: wa_user_id }),
      });
      logger.info('AI cache cleared for user', { wa_user_id });
    } catch (aiErr: any) {
      // Non-blocking — conversation is already deleted
      logger.warn('Failed to clear AI cache for user', { wa_user_id, error: aiErr.message });
    }

    logger.info('Conversation deleted', { wa_user_id });

    res.json({
      success: true,
      message: 'Conversation and message history deleted',
    });
  } catch (error: any) {
    logger.error('Failed to delete conversation', { error: error.message });
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
}

/**
 * Retry AI processing for a failed message
 * POST /internal/conversations/:wa_user_id/retry
 */
export async function handleRetryAI(req: Request, res: Response): Promise<void> {
  try {
    const wa_user_id = getParam(req, 'wa_user_id');
    const channel = resolveChannel(req, wa_user_id || undefined);

    if (!wa_user_id) {
      res.status(400).json({ error: 'wa_user_id is required' });
      return;
    }

    const { getPendingMessage, setAIProcessing } = await import('../services/takeover.service');
    const { publishEvent } = await import('../services/rabbitmq.service');
    const { rabbitmqConfig } = await import('../config/rabbitmq');

    // Get the pending message that failed
    const pendingMessage = await getPendingMessage(wa_user_id, channel);

    if (!pendingMessage) {
      res.status(404).json({ error: 'No pending message found for retry' });
      return;
    }

    // Set AI processing status again
    await setAIProcessing(wa_user_id, pendingMessage.message_id, undefined, channel);

    // Re-publish the message to AI service queue
    await publishEvent(rabbitmqConfig.ROUTING_KEYS.MESSAGE_RECEIVED, {
      wa_user_id,
      message: pendingMessage.message_text,
      message_id: pendingMessage.message_id,
      is_retry: true,
      channel: channel.toLowerCase(),
    });

    logger.info('AI retry requested', { wa_user_id, message_id: pendingMessage.message_id });

    res.json({
      success: true,
      message: 'AI processing retry initiated',
    });
  } catch (error: any) {
    logger.error('Failed to retry AI', { error: error.message });
    res.status(500).json({ error: 'Failed to retry AI processing' });
  }
}
