import { Request, Response } from 'express';
import { 
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

function resolveVillageId(req: Request): string | undefined {
  const queryVillageId = typeof req.query.village_id === 'string' ? req.query.village_id : undefined;
  const headerVillageId = typeof req.headers['x-village-id'] === 'string' ? req.headers['x-village-id'] : undefined;
  return queryVillageId || headerVillageId;
}

/**
 * Get conversations list for live chat
 * GET /internal/conversations
 * Query params: status=all|takeover|bot, limit=50
 */
export async function handleGetConversations(req: Request, res: Response): Promise<void> {
  try {
    const status = (req.query.status as 'all' | 'takeover' | 'bot') || 'all';
    const limit = parseInt(req.query.limit as string) || 50;
    const villageId = resolveVillageId(req);

    if (!villageId) {
      res.status(400).json({ error: 'x-village-id header or village_id query parameter is required' });
      return;
    }

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
    const { wa_user_id } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    const villageId = resolveVillageId(req);

    if (!villageId) {
      res.status(400).json({ error: 'x-village-id header or village_id query parameter is required' });
      return;
    }

    const conversation = await getConversation(wa_user_id, villageId);
    const messages = await getMessageHistory(wa_user_id, limit, villageId);
    const takeoverSession = await getActiveTakeover(wa_user_id, villageId);

    // Mark as read when admin opens conversation
    await markConversationAsRead(wa_user_id, villageId);
    
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
    const { wa_user_id } = req.params;
    const { message, admin_id, admin_name } = req.body;
    const villageId = resolveVillageId(req);

    if (!villageId) {
      res.status(400).json({ error: 'x-village-id header or village_id query parameter is required' });
      return;
    }

    if (!message) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    // Check if takeover is active (optional - can still send without takeover)
    const isTakeover = await isUserInTakeover(wa_user_id, villageId);
    
    // Check if this is a webchat user (starts with web_)
    const isWebchatUser = wa_user_id.startsWith('web_');
    
    if (isWebchatUser) {
      // For webchat users, just save to database
      // User will poll for new messages via webchat endpoint
      const messageId = `admin-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      
      await saveOutgoingMessage({
        wa_user_id,
        message_id: messageId,
        message_text: message,
        source: 'ADMIN',
      });

      // Update conversation summary and reset unread count (admin has responded)
      await updateConversation(wa_user_id, message, undefined, 'reset', villageId);

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
      const result =await sendTextMessage(wa_user_id, message, villageId);

      if (result.success) {
        // Generate message ID if not provided by WA
        const messageId = result.message_id || `admin-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        
        // Save message to database so it appears in chat history
        await saveOutgoingMessage({
          village_id: villageId,
          wa_user_id,
          message_id: messageId,
          message_text: message,
          source: 'ADMIN',
        });

        // Update conversation summary and reset unread count (admin has responded)
        await updateConversation(wa_user_id, message, undefined, 'reset', villageId);

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
