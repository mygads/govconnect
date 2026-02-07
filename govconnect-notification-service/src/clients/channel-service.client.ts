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
    'X-API-Key': config.internalApiKey,
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
}) {
  try {
    const response = await channelServiceClient.post('/internal/send', {
      village_id: data.village_id,
      wa_user_id: data.wa_user_id,
      message: data.message,
    });
    return response.data;
  } catch (error: any) {
    logger.error('[ChannelServiceClient] Failed to send message', { error: error.message });
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
  getChannelServiceMetrics,
};
