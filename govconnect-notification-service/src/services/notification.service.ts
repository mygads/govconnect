import prisma from '../config/database';
import logger from '../utils/logger';
import { UrgentAlertEvent, ChannelType } from '../types/event.types';
import { sendWhatsAppMessage } from '../clients/channel-service.client';

interface SendNotificationParams {
  village_id?: string;
  channel: ChannelType;
  channel_identifier: string;
  wa_user_id?: string; // Legacy support
  message: string;
  notificationType: string;
}

// Admin WhatsApp number from environment or config
const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP || '';

export async function sendNotification(params: SendNotificationParams): Promise<void> {
  const { village_id, channel, channel_identifier, wa_user_id, message, notificationType } = params;
  
  // Resolve the identifier (backward compatible)
  const resolvedIdentifier = channel_identifier || wa_user_id || '';
  const resolvedChannel = channel || 'WHATSAPP';
  
  logger.info('Sending notification', { 
    channel: resolvedChannel, 
    channel_identifier: resolvedIdentifier, 
    notificationType 
  });

  // Skip notification for webchat - they don't receive push notifications
  if (resolvedChannel === 'WEBCHAT') {
    logger.info('Skipping notification for WEBCHAT channel - no push notifications', {
      channel_identifier: resolvedIdentifier,
      notificationType
    });
    
    // Still log it
    try {
      await prisma.notificationLog.create({
        data: {
          channel: resolvedChannel,
          channel_identifier: resolvedIdentifier,
          wa_user_id: null,
          village_id: village_id || null,
          message_text: message,
          notification_type: notificationType,
          status: 'skipped',
          error_msg: 'WEBCHAT does not support push notifications'
        }
      });
    } catch (dbError: any) {
      logger.error('Failed to log notification to database', { error: dbError.message });
    }
    return;
  }

  let status = 'failed';
  let errorMsg: string | null = null;

  try {
    // Use circuit breaker client (already has retry logic)
    const response = await sendWhatsAppMessage({
      village_id: village_id,
      wa_user_id: resolvedIdentifier,
      message: message,
    });

    status = 'sent';
    logger.info('Notification sent successfully', {
      channel: resolvedChannel,
      channel_identifier: resolvedIdentifier,
      notificationType,
      message_id: response.message_id,
    });
  } catch (error: any) {
    errorMsg = error.message;
    
    if (error.response) {
      errorMsg = `HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`;
    } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      errorMsg = 'Request timeout';
    } else if (error.code === 'ECONNREFUSED') {
      errorMsg = 'Connection refused - Channel Service not available';
    }

    logger.error('Notification send failed', {
      channel: resolvedChannel,
      channel_identifier: resolvedIdentifier,
      notificationType,
      error: errorMsg,
    });
  }

  // Log to database
  try {
    await prisma.notificationLog.create({
      data: {
        channel: resolvedChannel,
        channel_identifier: resolvedIdentifier,
        wa_user_id: resolvedChannel === 'WHATSAPP' ? resolvedIdentifier : null,
        village_id: village_id || null,
        message_text: message,
        notification_type: notificationType,
        status,
        error_msg: errorMsg
      }
    });
  } catch (dbError: any) {
    logger.error('Failed to log notification to database', {
      channel: resolvedChannel,
      channel_identifier: resolvedIdentifier,
      notificationType,
      error: dbError.message
    });
  }

  if (status === 'failed') {
    logger.error('Notification failed', {
      channel: resolvedChannel,
      channel_identifier: resolvedIdentifier,
      notificationType,
      lastError: errorMsg
    });
  }
}

/**
 * Send urgent alert to admin WhatsApp.
 * 
 * Supports per-village admin notification number via Dashboard API.
 * If per-village number is configured, sends to that number.
 * Falls back to global ADMIN_WHATSAPP env var.
 * 
 * NOTE: Auto-send WA is currently DISABLED to avoid spam/blocking.
 * The function is ready but will only log the alert for now.
 * Enable by setting ENABLE_URGENT_WA_ALERT=true in env.
 */
export async function sendAdminUrgentAlert(message: string, event: UrgentAlertEvent): Promise<void> {
  const enableUrgentWA = process.env.ENABLE_URGENT_WA_ALERT === 'true';

  // Try to get per-village admin number from Dashboard API
  const adminNumber = await getVillageAdminNumber(event.village_id) || ADMIN_WHATSAPP;

  if (!adminNumber) {
    logger.warn('No admin WhatsApp configured (global or per-village), skipping urgent alert', {
      village_id: event.village_id,
    });
    return;
  }

  logger.warn('🚨 URGENT ALERT detected', {
    admin_whatsapp: adminNumber,
    complaint_id: event.complaint_id,
    kategori: event.kategori,
    village_id: event.village_id,
    auto_send_enabled: enableUrgentWA,
  });

  if (!enableUrgentWA) {
    // Log the alert but don't send WA to avoid spam/blocking
    logger.info('Urgent WA alert prepared but NOT sent (ENABLE_URGENT_WA_ALERT=false)', {
      admin_whatsapp: adminNumber,
      complaint_id: event.complaint_id,
    });

    // Still log to DB for audit trail
    try {
      await prisma.notificationLog.create({
        data: {
          channel: 'WHATSAPP',
          channel_identifier: adminNumber,
          wa_user_id: adminNumber,
          village_id: event.village_id || null,
          message_text: message,
          notification_type: 'urgent_alert',
          status: 'skipped',
          error_msg: 'Auto-send disabled (ENABLE_URGENT_WA_ALERT=false)',
        },
      });
    } catch (dbError: any) {
      logger.error('Failed to log skipped urgent alert', { error: dbError.message });
    }
    return;
  }

  // Send to admin
  await sendNotification({
    village_id: event.village_id,
    channel: 'WHATSAPP',
    channel_identifier: adminNumber,
    message,
    notificationType: 'urgent_alert'
  });
}

/**
 * Get per-village admin notification number from Dashboard API.
 * Returns null if not configured or Dashboard is unreachable.
 */
async function getVillageAdminNumber(villageId?: string): Promise<string | null> {
  if (!villageId) return null;

  const dashboardUrl = process.env.DASHBOARD_URL || process.env.DASHBOARD_SERVICE_URL;
  const internalApiKey = process.env.INTERNAL_API_KEY;

  if (!dashboardUrl || !internalApiKey) return null;

  try {
    const response = await fetch(
      `${dashboardUrl}/api/internal/village-profile?village_id=${villageId}`,
      {
        headers: {
          'x-internal-api-key': internalApiKey,
        },
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!response.ok) return null;

    const data = (await response.json()) as { data?: { admin_notification_number?: string } };
    // admin_notification_number is a field that can be set in Dashboard settings
    return data?.data?.admin_notification_number || null;
  } catch (error: any) {
    logger.debug('Could not fetch village admin number from Dashboard', {
      villageId,
      error: error.message,
    });
    return null;
  }
}
