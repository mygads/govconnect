/**
 * Notification Service Client with Circuit Breaker
 */

import { createHttpClient } from '../shared/http-client';
import { config } from '../config/env';

const notificationServiceClient = createHttpClient('notification-service', {
  baseURL: process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:3004',
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
 * Send notification (if needed for direct calls)
 */
export async function sendNotification(data: {
  to: string;
  message: string;
  type: string;
}) {
  try {
    const response = await notificationServiceClient.post('/internal/events/notification_send', data);
    return response.data;
  } catch (error: any) {
    console.error('[NotificationServiceClient] Failed to send notification:', error.message);
    throw error;
  }
}

/**
 * Get circuit breaker metrics
 */
export function getNotificationServiceMetrics() {
  return notificationServiceClient.getMetrics();
}

export default {
  sendNotification,
  getNotificationServiceMetrics,
};
