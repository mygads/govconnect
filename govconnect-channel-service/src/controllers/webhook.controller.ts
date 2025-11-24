import { Request, Response } from 'express';
import {
  saveIncomingMessage,
  checkDuplicateMessage,
} from '../services/message.service';
import { publishEvent } from '../services/rabbitmq.service';
import {
  parseWebhookPayload,
  shouldProcessMessage,
} from '../services/wa.service';
import { rabbitmqConfig } from '../config/rabbitmq';
import logger from '../utils/logger';
import { WhatsAppWebhookPayload } from '../types/webhook.types';

/**
 * Handle WhatsApp webhook
 * POST /webhook/whatsapp
 */
export async function handleWebhook(req: Request, res: Response): Promise<void> {
  try {
    const payload: WhatsAppWebhookPayload = req.body;

    // Parse webhook payload
    const { message, from } = parseWebhookPayload(payload);

    if (!message || !from) {
      logger.warn('No valid message in webhook payload');
      res.json({ status: 'ok', message: 'No message to process' });
      return;
    }

    // Check if message should be processed
    const { shouldProcess, reason } = shouldProcessMessage(message);
    if (!shouldProcess) {
      logger.info('Message skipped', { reason, message_id: message.id });
      res.json({ status: 'ok', message: `Skipped: ${reason}` });
      return;
    }

    // Check duplicate
    const isDuplicate = await checkDuplicateMessage(message.id);
    if (isDuplicate) {
      logger.warn('Duplicate message', { message_id: message.id });
      res.json({ status: 'ok', message: 'Duplicate message' });
      return;
    }

    // Extract message text
    const messageText = message.text?.body || '';

    if (!messageText) {
      logger.warn('Empty message text');
      res.json({ status: 'ok', message: 'Empty message' });
      return;
    }

    // Save message to database
    const messageTimestamp = new Date(parseInt(message.timestamp) * 1000);
    
    await saveIncomingMessage({
      wa_user_id: from,
      message_id: message.id,
      message_text: messageText,
      timestamp: messageTimestamp,
    });

    // Publish event to RabbitMQ
    await publishEvent(rabbitmqConfig.ROUTING_KEYS.MESSAGE_RECEIVED, {
      wa_user_id: from,
      message: messageText,
      message_id: message.id,
      received_at: messageTimestamp.toISOString(),
    });

    logger.info('Webhook processed successfully', {
      from,
      message_id: message.id,
    });

    res.json({ status: 'ok', message_id: message.id });
  } catch (error: any) {
    logger.error('Webhook handler error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Webhook verification (for WhatsApp Cloud API setup)
 * GET /webhook/whatsapp
 */
export function verifyWebhook(req: Request, res: Response): void {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.WA_WEBHOOK_VERIFY_TOKEN || 'govconnect_verify';

  if (mode === 'subscribe' && token === verifyToken) {
    logger.info('Webhook verified successfully');
    res.send(challenge);
    return;
  }

  logger.warn('Webhook verification failed', { mode, token });
  res.sendStatus(403);
}
