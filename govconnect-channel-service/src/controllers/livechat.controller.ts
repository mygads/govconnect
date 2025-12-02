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

/**
 * Start takeover for a user
 * POST /internal/takeover/:wa_user_id
 */
export async function handleStartTakeover(req: Request, res: Response): Promise<void> {
  try {
    const { wa_user_id } = req.params;
    const { admin_id, admin_name, reason } = req.body;

    if (!wa_user_id || !admin_id) {
      res.status(400).json({ error: 'wa_user_id and admin_id are required' });
      return;
    }

    const session = await startTakeover(wa_user_id, admin_id, admin_name, reason);
    
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
    const { wa_user_id } = req.params;

    if (!wa_user_id) {
      res.status(400).json({ error: 'wa_user_id is required' });
      return;
    }

    const ended = await endTakeover(wa_user_id);
    
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
    const { wa_user_id } = req.params;
    
    const session = await getActiveTakeover(wa_user_id);
    
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
    const status = (req.query.status as 'all' | 'takeover' | 'bot') || 'all';
    const limit = parseInt(req.query.limit as string) || 50;

    const conversations = await getConversations(status, limit);
    
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

    const conversation = await getConversation(wa_user_id);
    const messages = await getMessageHistory(wa_user_id, limit);
    const takeoverSession = await getActiveTakeover(wa_user_id);

    // Mark as read when admin opens conversation
    await markConversationAsRead(wa_user_id);
    
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
 */
export async function handleAdminSendMessage(req: Request, res: Response): Promise<void> {
  try {
    const { wa_user_id } = req.params;
    const { message, admin_id, admin_name } = req.body;

    if (!message) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    // Check if takeover is active (optional - can still send without takeover)
    const isTakeover = await isUserInTakeover(wa_user_id);
    
    // Send message via WhatsApp
    const result = await sendTextMessage(wa_user_id, message);

    if (result.success) {
      // Generate message ID if not provided by WA
      const messageId = result.message_id || `admin-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      
      // Save message to database so it appears in chat history
      await saveOutgoingMessage({
        wa_user_id,
        message_id: messageId,
        message_text: message,
        source: 'ADMIN',
      });

      // Update conversation summary
      await updateConversation(wa_user_id, message, undefined, false);

      logger.info('Admin sent message', {
        wa_user_id,
        admin_id,
        admin_name,
        is_takeover: isTakeover,
        message_id: messageId,
      });

      res.json({
        success: true,
        message_id: messageId,
        is_takeover: isTakeover,
      });
    } else {
      res.status(500).json({ 
        error: 'Failed to send message',
        details: result.error,
      });
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
    const { wa_user_id } = req.params;

    await markConversationAsRead(wa_user_id);
    
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
    const { wa_user_id } = req.params;

    if (!wa_user_id) {
      res.status(400).json({ error: 'wa_user_id is required' });
      return;
    }

    // Import prisma for direct database operations
    const { deleteConversationHistory } = await import('../services/takeover.service');
    
    await deleteConversationHistory(wa_user_id);
    
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
