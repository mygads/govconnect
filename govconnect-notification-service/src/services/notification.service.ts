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
 * Send urgent alert to admin WhatsApp
 */
export async function sendAdminUrgentAlert(message: string, event: UrgentAlertEvent): Promise<void> {
  // Check if admin WhatsApp is configured
  if (!ADMIN_WHATSAPP) {
    logger.warn('Admin WhatsApp not configured, skipping urgent alert');
    return;
  }

  logger.warn('🚨 Sending URGENT ALERT to admin', {
    admin_whatsapp: ADMIN_WHATSAPP,
    complaint_id: event.complaint_id,
    kategori: event.kategori
  });

  // Send to admin
  await sendNotification({
    village_id: event.village_id,
    channel: 'WHATSAPP',
    channel_identifier: ADMIN_WHATSAPP,
    message,
    notificationType: 'urgent_alert'
  });

  // Log the urgent alert
  try {
    await prisma.notificationLog.create({
      data: {
        channel: 'WHATSAPP',
        channel_identifier: ADMIN_WHATSAPP,
        wa_user_id: ADMIN_WHATSAPP,
        message_text: `[URGENT ALERT] ${event.complaint_id} - ${event.kategori}`,
        notification_type: 'urgent_alert_admin',
        status: 'sent',
        error_msg: null
      }
    });
  } catch (dbError: any) {
    logger.error('Failed to log urgent alert to database', { error: dbError.message });
  }
}
