import prisma from '../config/database';
import config from '../config/env';
import logger from '../utils/logger';
import { ComplaintImportantContactsEvent, UrgentAlertEvent, ChannelType } from '../types/event.types';
import { sendWhatsAppMessage, sendWebchatSystemNotification } from '../clients/channel-service.client';
import { extractAdminNotificationNumber } from './urgent-alert-config';
import { buildComplaintImportantContactsMessage } from './template.service';

interface DeliveryUpdateInput {
  message_id: string;
  delivery_status: 'sent' | 'delivered' | 'read' | 'failed';
  occurred_at?: string;
  provider_status?: string | null;
  provider_error?: string | null;
}

interface SendNotificationParams {
  village_id?: string;
  channel: ChannelType;
  channel_identifier: string;
  wa_user_id?: string; // Legacy support
  message: string;
  notificationType: string;
  reference_number?: string | null;
  entity_status?: string | null;
}

interface ImportantContactRecord {
  id?: string;
  name: string;
  phone: string;
  description?: string | null;
}

// Admin WhatsApp number from environment or config
const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP || '';

async function notifyCaseDelivery(params: {
  notificationType: string;
  reference_number?: string | null;
  entity_status?: string | null;
  delivery_status: 'sent' | 'delivered' | 'read' | 'failed';
  message_id?: string | null;
  occurred_at?: string;
  provider_status?: string | null;
  provider_error?: string | null;
}) {
  if (params.notificationType !== 'status_updated') return;
  if (!params.reference_number || !params.entity_status || !config.caseServiceUrl) return;

  try {
    const response = await fetch(`${config.caseServiceUrl.replace(/\/$/, '')}/internal/delivery-callback`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-api-key': config.internalApiKey,
      },
      body: JSON.stringify({
        reference_number: params.reference_number,
        status: params.entity_status,
        delivery_status: params.delivery_status,
        message_id: params.message_id ?? null,
        occurred_at: params.occurred_at || new Date().toISOString(),
        provider_status: params.provider_status ?? null,
        provider_error: params.provider_error ?? null,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      logger.warn('Case delivery callback returned non-OK status', {
        reference_number: params.reference_number,
        entity_status: params.entity_status,
        delivery_status: params.delivery_status,
        status_code: response.status,
      });
    }
  } catch (error: any) {
    logger.warn('Failed to notify case-service delivery callback', {
      reference_number: params.reference_number,
      entity_status: params.entity_status,
      delivery_status: params.delivery_status,
      error: error.message,
    });
  }
}

async function logSkippedNotification(params: {
  village_id?: string;
  channel: ChannelType;
  channel_identifier: string;
  notificationType: string;
  reference_number?: string | null;
  message: string;
  errorMsg: string;
}) {
  await prisma.notificationLog.create({
    data: {
      channel: params.channel,
      channel_identifier: params.channel_identifier,
      wa_user_id: params.channel === 'WHATSAPP' ? params.channel_identifier : null,
      village_id: params.village_id || null,
      message_text: params.message,
      reference_number: params.reference_number ?? null,
      notification_type: params.notificationType,
      status: 'skipped',
      provider_status: 'skipped',
      error_msg: params.errorMsg,
      provider_error: params.errorMsg,
    },
  });
}

async function fetchComplaintImportantContacts(event: ComplaintImportantContactsEvent): Promise<ImportantContactRecord[]> {
  if (!event.village_id) return [];

  const dashboardUrl = process.env.DASHBOARD_SERVICE_URL || process.env.DASHBOARD_URL;
  const internalApiKey = process.env.INTERNAL_API_KEY;

  if (!dashboardUrl || !internalApiKey) {
    throw new Error('Dashboard important contacts service is not configured');
  }

  const searchParams = new URLSearchParams({ village_id: event.village_id });
  if (event.important_contact_category_id) {
    searchParams.set('category_id', event.important_contact_category_id);
  } else if (event.important_contact_category) {
    searchParams.set('category_name', event.important_contact_category);
  }

  const response = await fetch(
    `${dashboardUrl.replace(/\/$/, '')}/api/internal/important-contacts?${searchParams.toString()}`,
    {
      headers: {
        'x-internal-api-key': internalApiKey,
      },
      signal: AbortSignal.timeout(5000),
    }
  );

  if (!response.ok) {
    throw new Error(`Dashboard important contacts lookup failed with status ${response.status}`);
  }

  const payload = await response.json() as { data?: unknown };
  const contacts = Array.isArray(payload.data) ? payload.data : [];

  return contacts.filter((contact: unknown): contact is ImportantContactRecord => {
    return !!contact
      && typeof contact === 'object'
      && typeof (contact as ImportantContactRecord).name === 'string'
      && typeof (contact as ImportantContactRecord).phone === 'string';
  });
}

async function hasCompletedComplaintImportantContactsNotification(
  channel: ChannelType,
  channelIdentifier: string,
  complaintId: string,
): Promise<boolean> {
  const existing = await prisma.notificationLog.findFirst({
    where: {
      channel,
      channel_identifier: channelIdentifier,
      notification_type: 'complaint_important_contacts',
      reference_number: complaintId,
      status: {
        in: ['sent', 'delivered', 'read', 'skipped'],
      },
    },
    orderBy: { sent_at: 'desc' },
  });

  return !!existing;
}

export async function sendComplaintImportantContactsNotification(event: ComplaintImportantContactsEvent): Promise<void> {
  const channelIdentifier = event.channel_identifier || event.wa_user_id || '';
  if (!channelIdentifier) {
    logger.warn('Skipping complaint important-contact notification without channel identifier', {
      complaint_id: event.complaint_id,
      village_id: event.village_id,
      channel: event.channel,
    });
    return;
  }

  if (await hasCompletedComplaintImportantContactsNotification(event.channel, channelIdentifier, event.complaint_id)) {
    logger.info('Skipping duplicate complaint important-contact notification', {
      complaint_id: event.complaint_id,
      village_id: event.village_id,
      channel: event.channel,
      channel_identifier: channelIdentifier,
    });
    return;
  }

  const contacts = await fetchComplaintImportantContacts(event);
  if (contacts.length === 0) {
    const skipMessage = `Kontak penting resmi tidak ditemukan untuk laporan ${event.complaint_id}.`;
    await logSkippedNotification({
      village_id: event.village_id,
      channel: event.channel,
      channel_identifier: channelIdentifier,
      notificationType: 'complaint_important_contacts',
      reference_number: event.complaint_id,
      message: skipMessage,
      errorMsg: 'No important contacts found for configured complaint category',
    });
    logger.warn('Skipping complaint important-contact notification because no contacts were found', {
      complaint_id: event.complaint_id,
      village_id: event.village_id,
      important_contact_category_id: event.important_contact_category_id,
      important_contact_category: event.important_contact_category,
    });
    return;
  }

  const message = buildComplaintImportantContactsMessage({
    complaint_id: event.complaint_id,
    contacts,
  });

  await sendNotification({
    village_id: event.village_id,
    channel: event.channel,
    channel_identifier: channelIdentifier,
    wa_user_id: event.wa_user_id,
    message,
    notificationType: 'complaint_important_contacts',
    reference_number: event.complaint_id,
  });
}

export async function handleChannelDeliveryUpdate(input: DeliveryUpdateInput): Promise<void> {
  const notification = await prisma.notificationLog.findFirst({
    where: { message_id: input.message_id },
    orderBy: { sent_at: 'desc' },
  });

  if (!notification) {
    logger.warn('Delivery update ignored because notification log was not found', {
      message_id: input.message_id,
      delivery_status: input.delivery_status,
    });
    return;
  }

  await prisma.notificationLog.update({
    where: { id: notification.id },
    data: {
      status: input.delivery_status === 'failed' ? 'failed' : notification.status,
      provider_status: input.provider_status ?? input.delivery_status,
      provider_error: input.provider_error ?? null,
      error_msg: input.delivery_status === 'failed'
        ? input.provider_error ?? notification.error_msg
        : notification.error_msg,
    },
  });

  await notifyCaseDelivery({
    notificationType: notification.notification_type,
    reference_number: notification.reference_number,
    entity_status: notification.entity_status,
    delivery_status: input.delivery_status,
    message_id: notification.message_id,
    occurred_at: input.occurred_at,
    provider_status: input.provider_status,
    provider_error: input.provider_error,
  });
}

export async function sendNotification(params: SendNotificationParams): Promise<void> {
  const {
    village_id,
    channel,
    channel_identifier,
    wa_user_id,
    message,
    notificationType,
    reference_number,
    entity_status,
  } = params;

  // Resolve the identifier (backward compatible)
  const resolvedIdentifier = channel_identifier || wa_user_id || '';
  const resolvedChannel = channel || 'WHATSAPP';

  logger.info('Sending notification', {
    channel: resolvedChannel,
    channel_identifier: resolvedIdentifier,
    notificationType,
  });

  // WEBCHAT: deliver as a SYSTEM-origin message to conversation history
  // plus an SSE livechat event so active webchat sessions see it live.
  // Previously this branch was a hard skip — user webchat never knew
  // their complaint status changed. See CROSS_REPO_PLAN.md N1.
  if (resolvedChannel === 'WEBCHAT') {
    let status = 'failed';
    let errorMsg: string | null = null;
    let messageId: string | null = null;
    try {
      const response = await sendWebchatSystemNotification({
        village_id,
        channel_identifier: resolvedIdentifier,
        message,
        notification_type: notificationType,
        reference_number: reference_number ?? null,
        entity_status: entity_status ?? null,
      });
      messageId = typeof response?.message_id === 'string' ? response.message_id : null;
      status = response?.status === 'delivered' ? 'delivered' : 'failed';
      errorMsg = status === 'delivered' ? null : `Unexpected response: ${JSON.stringify(response)}`;
      logger.info('Webchat system notification delivered', {
        channel_identifier: resolvedIdentifier,
        notificationType,
        message_id: messageId,
      });
      await notifyCaseDelivery({
        notificationType,
        reference_number,
        entity_status,
        delivery_status: 'delivered',
        message_id: messageId,
        provider_status: typeof response?.status === 'string' ? response.status : 'delivered',
      });
    } catch (error: any) {
      errorMsg = error?.response
        ? `HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`
        : error?.message || 'Unknown error';
      logger.error('Webchat system notification failed', {
        channel_identifier: resolvedIdentifier,
        notificationType,
        error: errorMsg,
      });
      await notifyCaseDelivery({
        notificationType,
        reference_number,
        entity_status,
        delivery_status: 'failed',
        message_id: messageId,
        provider_status: 'failed',
        provider_error: errorMsg,
      });
    }

    try {
      await prisma.notificationLog.create({
        data: {
          channel: resolvedChannel,
          channel_identifier: resolvedIdentifier,
          wa_user_id: null,
          village_id: village_id || null,
          message_text: message,
          message_id: messageId,
          reference_number: reference_number ?? null,
          entity_status: entity_status ?? null,
          notification_type: notificationType,
          status,
          provider_status: status,
          error_msg: errorMsg,
          provider_error: errorMsg,
        },
      });
    } catch (dbError: any) {
      logger.error('Failed to log webchat notification to database', { error: dbError.message });
    }
    return;
  }

  let status = 'failed';
  let errorMsg: string | null = null;
  let messageId: string | null = null;
  let providerStatus: string | null = null;

  try {
    // Use circuit breaker client (already has retry logic)
    const response = await sendWhatsAppMessage({
      village_id: village_id,
      wa_user_id: resolvedIdentifier,
      message: message,
      notification_type: notificationType,
      reference_number: reference_number ?? null,
      entity_status: entity_status ?? null,
    });

    messageId = typeof response?.message_id === 'string' ? response.message_id : null;
    const sendStatus = typeof response?.status === 'string' ? response.status : 'unknown';
    providerStatus = sendStatus;

    if (sendStatus === 'sent') {
      status = 'sent';
      logger.info('Notification sent successfully', {
        channel: resolvedChannel,
        channel_identifier: resolvedIdentifier,
        notificationType,
        message_id: messageId,
      });
      await notifyCaseDelivery({
        notificationType,
        reference_number,
        entity_status,
        delivery_status: 'sent',
        message_id: messageId,
        provider_status: providerStatus,
      });
    } else {
      status = 'failed';
      errorMsg = typeof response?.error === 'string'
        ? response.error
        : `Unexpected send response status: ${sendStatus}`;
      logger.warn('Channel service stored notification but transport failed', {
        channel: resolvedChannel,
        channel_identifier: resolvedIdentifier,
        notificationType,
        message_id: messageId,
        send_status: sendStatus,
        error: errorMsg,
      });
      await notifyCaseDelivery({
        notificationType,
        reference_number,
        entity_status,
        delivery_status: 'failed',
        message_id: messageId,
        provider_status: providerStatus,
        provider_error: errorMsg,
      });
    }
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
    await notifyCaseDelivery({
      notificationType,
      reference_number,
      entity_status,
      delivery_status: 'failed',
      message_id: messageId,
      provider_status: providerStatus || 'failed',
      provider_error: errorMsg,
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
        message_id: messageId,
        reference_number: reference_number ?? null,
        entity_status: entity_status ?? null,
        notification_type: notificationType,
        status,
        provider_status: providerStatus,
        error_msg: errorMsg,
        provider_error: errorMsg
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
    throw new Error(errorMsg || 'Notification send failed');
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
 * Get per-village admin notification number from Dashboard behavior config.
 * Returns null if not configured or Dashboard is unreachable.
 */
async function getVillageAdminNumber(villageId?: string): Promise<string | null> {
  if (!villageId) return null;

  const dashboardUrl = process.env.DASHBOARD_URL || process.env.DASHBOARD_SERVICE_URL;
  const internalApiKey = process.env.INTERNAL_API_KEY;

  if (!dashboardUrl || !internalApiKey) return null;

  try {
    const response = await fetch(
      `${dashboardUrl}/api/internal/village-behavior?village_id=${villageId}`,
      {
        headers: {
          'x-internal-api-key': internalApiKey,
        },
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!response.ok) return null;

    const data = await response.json();
    return extractAdminNotificationNumber(data);
  } catch (error: any) {
    logger.debug('Could not fetch village admin number from Dashboard', {
      villageId,
      error: error.message,
    });
    return null;
  }
}
