import { RABBITMQ_CONFIG } from '../config/rabbitmq';
import logger from '../utils/logger';
import { sendNotification, sendAdminUrgentAlert, sendComplaintImportantContactsNotification } from '../services/notification.service';
import {
  buildComplaintCreatedMessage,
  buildServiceRequestedMessage,
  buildStatusUpdatedMessage,
  buildUrgentAlertMessage
} from '../services/template.service';
import {
  ComplaintCreatedEvent,
  ComplaintImportantContactsEvent,
  ServiceRequestedEvent,
  StatusUpdatedEvent,
  UrgentAlertEvent
} from '../types/event.types';

// Helper to resolve channel from event (backward compatible)
function resolveChannel(event: any): { village_id?: string; channel: 'WHATSAPP' | 'WEBCHAT'; channel_identifier: string } {
  const village_id = event.village_id || undefined;
  // Prefer new channel fields
  if (event.channel && event.channel_identifier) {
    return {
      village_id,
      channel: String(event.channel).toUpperCase() === 'WEBCHAT' ? 'WEBCHAT' : 'WHATSAPP',
      channel_identifier: event.channel_identifier
    };
  }
  // Legacy fallback: use wa_user_id as WhatsApp identifier
  if (event.wa_user_id) {
    return {
      village_id,
      channel: 'WHATSAPP',
      channel_identifier: event.wa_user_id
    };
  }
  // Default
  return {
    village_id,
    channel: 'WHATSAPP',
    channel_identifier: ''
  };
}

export async function handleEvent(routingKey: string, data: any): Promise<void> {
  switch (routingKey) {
    // NOTE: aiReply is handled by Channel Service directly, not here
    // This prevents double response to user

    case RABBITMQ_CONFIG.routingKeys.complaintCreated:
      // NOTE: This event is intentionally NOT published by case-service anymore.
      // AI Service sends the response directly via publishAIReply.
      // Keeping this handler for backward compatibility if event is ever re-enabled.
      await handleComplaintCreated(data as ComplaintCreatedEvent);
      break;

    case RABBITMQ_CONFIG.routingKeys.complaintImportantContacts:
      await handleComplaintImportantContacts(data as ComplaintImportantContactsEvent);
      break;

    case RABBITMQ_CONFIG.routingKeys.serviceRequested:
      await handleServiceRequested(data as ServiceRequestedEvent);
      break;

    case RABBITMQ_CONFIG.routingKeys.statusUpdated:
      await handleStatusUpdated(data as StatusUpdatedEvent);
      break;

    case RABBITMQ_CONFIG.routingKeys.urgentAlert:
      await handleUrgentAlert(data as UrgentAlertEvent);
      break;

    case 'notification.send':
      await handleDirectNotification(data);
      break;

    default:
      logger.warn('Unknown routing key', { routingKey });
  }
}

async function handleDirectNotification(event: any): Promise<void> {
  const { village_id, channel, channel_identifier } = resolveChannel(event);
  const target = channel_identifier || event.to;
  if (!event.message || !target) {
    throw new Error('message and to/channel_identifier are required');
  }

  await sendNotification({
    village_id,
    channel,
    channel_identifier: String(target),
    message: String(event.message),
    notificationType: String(event.type || 'direct'),
  });
}

async function handleComplaintCreated(event: ComplaintCreatedEvent): Promise<void> {
  const { village_id, channel, channel_identifier } = resolveChannel(event);
  
  logger.info('Handling complaint created event', {
    village_id,
    channel,
    channel_identifier,
    complaint_id: event.complaint_id
  });

  const message = buildComplaintCreatedMessage({
    complaint_id: event.complaint_id,
    kategori: event.kategori
  });

  await sendNotification({
    village_id,
    channel,
    channel_identifier,
    message,
    notificationType: 'complaint_created',
    reference_number: event.complaint_id ?? null,
  });
}

async function handleComplaintImportantContacts(event: ComplaintImportantContactsEvent): Promise<void> {
  logger.info('Handling complaint important-contact event', {
    complaint_id: event.complaint_id,
    village_id: event.village_id,
    channel: event.channel,
    channel_identifier: event.channel_identifier,
    important_contact_category_id: event.important_contact_category_id,
  });

  await sendComplaintImportantContactsNotification(event);
}

async function handleServiceRequested(event: ServiceRequestedEvent): Promise<void> {
  const { village_id, channel, channel_identifier } = resolveChannel(event);
  
  logger.info('Handling service requested event', {
    village_id,
    channel,
    channel_identifier,
    request_number: event.request_number
  });

  const message = buildServiceRequestedMessage({
    request_number: event.request_number,
    service_name: event.service_name,
    channel,
  });

  await sendNotification({
    village_id,
    channel,
    channel_identifier,
    message,
    notificationType: 'service_requested',
    reference_number: event.request_number ?? null,
  });
}

async function handleStatusUpdated(event: StatusUpdatedEvent): Promise<void> {
  const { village_id, channel, channel_identifier } = resolveChannel(event);
  
  logger.info('Handling status updated event', {
    village_id,
    channel,
    channel_identifier,
    complaint_id: event.complaint_id,
    request_number: event.request_number,
    status: event.status
  });

  // Kirim notifikasi untuk status yang relevan (PROCESS + final statuses)
  if (!['PROCESS', 'DONE', 'CANCELED', 'REJECT'].includes(event.status)) {
    logger.info('Skipping notification - only notify on PROCESS and final status', {
      status: event.status,
      id: event.complaint_id || event.request_number
    });
    return;
  }

  const message = buildStatusUpdatedMessage({
    complaint_id: event.complaint_id,
    request_number: event.request_number,
    status: event.status,
    admin_notes: event.admin_notes,
    result_file_url: event.result_file_url,
    result_file_name: event.result_file_name,
  });

  await sendNotification({
    village_id,
    channel,
    channel_identifier,
    message,
    notificationType: 'status_updated',
    reference_number: event.complaint_id || event.request_number || null,
    entity_status: event.status,
  });
}

async function handleUrgentAlert(event: UrgentAlertEvent): Promise<void> {
  logger.warn('🚨 HANDLING URGENT ALERT', {
    complaint_id: event.complaint_id,
    kategori: event.kategori
  });

  const message = buildUrgentAlertMessage({
    complaint_id: event.complaint_id,
    kategori: event.kategori,
    deskripsi: event.deskripsi,
    alamat: event.alamat,
    rt_rw: event.rt_rw,
    created_at: event.created_at
  });

  // Send to admin WhatsApp
  await sendAdminUrgentAlert(message, event);
}

