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

export async function handleEvent(routingKey: string, data: any): Promise<void> {
  switch (routingKey) {
    // NOTE: aiReply is handled by Channel Service directly, not here
    // This prevents double response to user

    case RABBITMQ_CONFIG.routingKeys.complaintCreated:
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
  logger.info('Handling complaint created event', {
    wa_user_id: event.wa_user_id,
    complaint_id: event.complaint_id
  });

  const message = buildComplaintCreatedMessage({
    complaint_id: event.complaint_id,
    kategori: event.kategori
  });

  await sendNotification({
    wa_user_id: event.wa_user_id,
    message,
    notificationType: 'complaint_created'
  });
}

async function handleServiceRequested(event: ServiceRequestedEvent): Promise<void> {
  logger.info('Handling service requested event', {
    wa_user_id: event.wa_user_id,
    request_number: event.request_number
  });

  const message = buildServiceRequestedMessage({
    request_number: event.request_number,
    service_name: event.service_name,
  });

  await sendNotification({
    wa_user_id: event.wa_user_id,
    message,
    notificationType: 'service_requested'
  });
}

async function handleStatusUpdated(event: StatusUpdatedEvent): Promise<void> {
  logger.info('Handling status updated event', {
    wa_user_id: event.wa_user_id,
    complaint_id: event.complaint_id,
    request_number: event.request_number,
    status: event.status
  });

  // Kirim notifikasi hanya untuk status final
  if (!['DONE', 'CANCELED', 'REJECT'].includes(event.status)) {
    logger.info('Skipping notification - only notify on final status', {
      status: event.status,
      id: event.complaint_id || event.request_number
    });
    return;
  }

  const message = buildStatusUpdatedMessage({
    complaint_id: event.complaint_id,
    request_number: event.request_number,
    status: event.status,
    admin_notes: event.admin_notes
  });

  await sendNotification({
    wa_user_id: event.wa_user_id,
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
