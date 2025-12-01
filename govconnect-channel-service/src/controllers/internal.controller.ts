import { Request, Response } from 'express';
import {
  getMessageHistory,
  saveOutgoingMessage,
  logSentMessage,
} from '../services/message.service';
import { sendTextMessage, sendTypingIndicator } from '../services/wa.service';
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
