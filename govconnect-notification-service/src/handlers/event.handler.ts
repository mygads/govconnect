import { RABBITMQ_CONFIG } from '../config/rabbitmq';
import logger from '../utils/logger';
import { sendNotification, sendAdminUrgentAlert } from '../services/notification.service';
import {
  buildComplaintCreatedMessage,
  buildTicketCreatedMessage,
  buildStatusUpdatedMessage,
  buildUrgentAlertMessage
} from '../services/template.service';
import {
  ComplaintCreatedEvent,
  TicketCreatedEvent,
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

    case RABBITMQ_CONFIG.routingKeys.ticketCreated:
      await handleTicketCreated(data as TicketCreatedEvent);
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

async function handleTicketCreated(event: TicketCreatedEvent): Promise<void> {
  logger.info('Handling ticket created event', {
    wa_user_id: event.wa_user_id,
    ticket_id: event.ticket_id
  });

  const message = buildTicketCreatedMessage({
    ticket_id: event.ticket_id,
    jenis: event.jenis
  });

  await sendNotification({
    wa_user_id: event.wa_user_id,
    message,
    notificationType: 'ticket_created'
  });
}

async function handleStatusUpdated(event: StatusUpdatedEvent): Promise<void> {
  logger.info('Handling status updated event', {
    wa_user_id: event.wa_user_id,
    complaint_id: event.complaint_id,
    ticket_id: event.ticket_id,
    status: event.status
  });

  const message = buildStatusUpdatedMessage({
    complaint_id: event.complaint_id,
    ticket_id: event.ticket_id,
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
