/**
 * Channel Service Client with Circuit Breaker
 */

import { createHttpClient } from '../shared/http-client';
import config from '../config/env';
import logger from '../utils/logger';

const channelServiceClient = createHttpClient('channel-service', {
  baseURL: config.channelServiceUrl,
  timeout: 10000,
  retries: 3,
  headers: {
    'x-internal-api-key': config.internalApiKey,
  },
  circuitBreakerOptions: {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 10000,
    resetTimeout: 30000,
  },
});

/**
 * Send WhatsApp message via channel-service
 */
export async function sendWhatsAppMessage(data: {
  village_id?: string;
  wa_user_id: string;
  message: string;
  mediaUrl?: string;
  notification_type?: string;
  reference_number?: string | null;
  entity_status?: string | null;
}) {
  try {
    const response = await channelServiceClient.post('/internal/send', {
      village_id: data.village_id,
      wa_user_id: data.wa_user_id,
      message: data.message,
      notification_type: data.notification_type,
      reference_number: data.reference_number,
      entity_status: data.entity_status,
    }, {
      headers: {
        'x-internal-api-key': config.internalApiKey,
      },
    });
    return response.data;
  } catch (error: any) {
    logger.error('[ChannelServiceClient] Failed to send message', { error: error.message });
    throw error;
  }
}

/**
 * Deliver a lifecycle / system notification to a WEBCHAT user via
 * channel-service. The channel-service persists the SYSTEM-origin
 * message to conversation history AND publishes a livechat SSE event
 * so active webchat sessions see it in real time.
 */
export async function sendWebchatSystemNotification(data: {
  village_id?: string;
  channel_identifier: string;
  message: string;
  notification_type?: string;
  reference_number?: string | null;
  entity_status?: string | null;
}) {
  try {
    const response = await channelServiceClient.post('/internal/webchat-notification', {
      village_id: data.village_id,
      channel_identifier: data.channel_identifier,
      message: data.message,
      notification_type: data.notification_type,
      reference_number: data.reference_number,
      entity_status: data.entity_status,
    }, {
      headers: {
        'x-internal-api-key': config.internalApiKey,
      },
    });
    return response.data;
  } catch (error: any) {
    logger.error('[ChannelServiceClient] Failed to send webchat system notification', {
      error: error.message,
    });
    throw error;
  }
}

/**
 * Get circuit breaker metrics
 */
export function getChannelServiceMetrics() {
  return channelServiceClient.getMetrics();
}

export default {
  sendWhatsAppMessage,
  sendWebchatSystemNotification,
  getChannelServiceMetrics,
};
