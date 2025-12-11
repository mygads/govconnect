import { Request, Response } from 'express';
import {
  getMessageHistory,
  saveIncomingMessage,
  saveOutgoingMessage,
  logSentMessage,
} from '../services/message.service';
import { updateConversation } from '../services/takeover.service';
import { sendTextMessage, sendTypingIndicator, markMessageAsRead } from '../services/wa.service';
import logger from '../utils/logger';

/**
 * Get message history
 * GET /internal/messages?wa_user_id=xxx&limit=30
 */
export async function getMessages(req: Request, res: Response): Promise<void> {
  try {
    const wa_user_id = req.query.wa_user_id as string;
    const limit = parseInt(req.query.limit as string) || 30;

    const messages = await getMessageHistory(wa_user_id, limit);

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
    const { wa_user_id, message } = req.body;

    // Send via WhatsApp API
    const result = await sendTextMessage(wa_user_id, message);

    if (result.success && result.message_id) {
      // Save outgoing message
      await saveOutgoingMessage({
        wa_user_id,
        message_id: result.message_id,
        message_text: message,
        source: 'SYSTEM',
      });

      // Log success
      await logSentMessage({
        wa_user_id,
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
        wa_user_id,
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
    const { wa_user_id, state = 'composing' } = req.body;
    
    // Map 'stop' to 'paused' since WA API doesn't have 'stop'
    const waState = state === 'stop' ? 'paused' : state;

    const result = await sendTypingIndicator(wa_user_id, waState);

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
    const { wa_user_id, message_id, message_text, direction, source, metadata } = req.body;
    
    if (!wa_user_id || !message_text) {
      res.status(400).json({ 
        error: 'wa_user_id and message_text are required' 
      });
      return;
    }
    
    // Generate a unique message ID if not provided
    const finalMessageId = message_id || `${direction === 'IN' ? 'in' : 'ai'}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    
    let message;
    if (direction === 'IN') {
      // Save incoming message (from user)
      message = await saveIncomingMessage({
        wa_user_id,
        message_id: finalMessageId,
        message_text,
      });
    } else {
      // Save outgoing message (from AI or admin)
      message = await saveOutgoingMessage({
        wa_user_id,
        message_id: finalMessageId,
        message_text,
        source: source || 'AI',
      });
    }
    
    // Update conversation
    const userName = metadata?.channel === 'webchat' ? `Web User ${wa_user_id.substring(4, 12)}` : undefined;
    await updateConversation(
      wa_user_id,
      message_text.substring(0, 100),
      userName,
      direction === 'IN' // incrementUnread only for incoming messages
    );
    
    logger.info('Message stored in database', { 
      wa_user_id, 
      message_id: finalMessageId,
      direction,
      source,
      channel: metadata?.channel,
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
    const { wa_user_id, message_ids } = req.body;
    
    if (!wa_user_id || !message_ids || !Array.isArray(message_ids)) {
      res.status(400).json({ 
        error: 'wa_user_id and message_ids array are required' 
      });
      return;
    }
    
    // Mark messages as read in WhatsApp
    // Use wa_user_id as both chat and sender for simplicity
    await markMessageAsRead(message_ids, wa_user_id, wa_user_id);
    
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
