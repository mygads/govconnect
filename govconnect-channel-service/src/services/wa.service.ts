import axios from 'axios';
import logger from '../utils/logger';
import { config } from '../config/env';
import { WhatsAppWebhookPayload, WhatsAppMessage } from '../types/webhook.types';

/**
 * Send text message via WhatsApp Cloud API
 */
export async function sendTextMessage(
  to: string,
  message: string
): Promise<{ success: boolean; message_id?: string; error?: string }> {
  try {
    if (!config.WA_PHONE_NUMBER_ID || !config.WA_ACCESS_TOKEN) {
      logger.warn('WhatsApp credentials not configured, message not sent');
      return {
        success: false,
        error: 'WhatsApp not configured',
      };
    }

    const url = `${config.WA_API_URL}/${config.WA_PHONE_NUMBER_ID}/messages`;

    const response = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'text',
        text: {
          preview_url: false,
          body: message,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${config.WA_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const messageId = response.data.messages?.[0]?.id;

    logger.info('WhatsApp message sent', { to, message_id: messageId });

    return {
      success: true,
      message_id: messageId,
    };
  } catch (error: any) {
    logger.error('Failed to send WhatsApp message', {
      to,
      error: error.message,
      response: error.response?.data,
    });

    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Parse webhook payload and extract message
 */
export function parseWebhookPayload(payload: WhatsAppWebhookPayload): {
  message: WhatsAppMessage | null;
  from: string | null;
} {
  try {
    const entry = payload.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) {
      return { message: null, from: null };
    }

    return {
      message,
      from: message.from,
    };
  } catch (error: any) {
    logger.error('Error parsing webhook payload', { error: error.message });
    return { message: null, from: null };
  }
}

/**
 * Validate webhook signature (optional, for production)
 */
export function validateWebhookSignature(
  signature: string,
  body: string,
  secret: string
): boolean {
  // TODO: Implement HMAC signature verification
  // For now, return true (skip verification in development)
  return true;
}

/**
 * Check if message should be processed
 */
export function shouldProcessMessage(message: WhatsAppMessage): {
  shouldProcess: boolean;
  reason?: string;
} {
  // Only process text messages
  if (message.type !== 'text') {
    return {
      shouldProcess: false,
      reason: 'Not a text message',
    };
  }

  // Check if message is too old (> 5 minutes)
  const messageTime = parseInt(message.timestamp) * 1000;
  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;

  if (now - messageTime > fiveMinutes) {
    return {
      shouldProcess: false,
      reason: 'Message too old',
    };
  }

  return { shouldProcess: true };
}
