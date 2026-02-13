import { RABBITMQ_CONFIG } from '../config/rabbitmq';
import logger from '../utils/logger';
import { sendNotification, sendAdminUrgentAlert } from '../services/notification.service';
import {
  buildComplaintCreatedMessage,
  buildServiceRequestedMessage,
  buildStatusUpdatedMessage,
  buildUrgentAlertMessage
} from '../services/template.service';
import {
  ComplaintCreatedEvent,
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
      channel: event.channel,
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

    case RABBITMQ_CONFIG.routingKeys.serviceRequested:
      await handleServiceRequested(data as ServiceRequestedEvent);
      break;

    case RABBITMQ_CONFIG.routingKeys.statusUpdated:
      await handleStatusUpdated(data as StatusUpdatedEvent);
      break;

    case RABBITMQ_CONFIG.routingKeys.urgentAlert:
      await handleUrgentAlert(data as UrgentAlertEvent);
      break;

    default:
      logger.warn('Unknown routing key', { routingKey });
  }
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
    notificationType: 'complaint_created'
  });
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
  });

  await sendNotification({
    village_id,
    channel,
    channel_identifier,
    message,
    notificationType: 'service_requested'
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
    notificationType: 'status_updated'
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
