import prisma from '../config/database';
import { generateTicketId } from '../utils/id-generator';
import { publishEvent } from './rabbitmq.service';
import { RABBITMQ_CONFIG } from '../config/rabbitmq';
import logger from '../utils/logger';

export interface CreateTicketData {
  wa_user_id: string;
  jenis: string;
  data_json: any;
}

export interface UpdateTicketStatusData {
  status: string;
  admin_notes?: string;
}

export interface TicketFilters {
  status?: string;
  jenis?: string;
  wa_user_id?: string;
  limit?: number;
  offset?: number;
}

/**
 * Create new ticket
 */
export async function createTicket(data: CreateTicketData) {
  const ticket_id = await generateTicketId();
  
  const ticket = await prisma.ticket.create({
    data: {
      ticket_id,
      wa_user_id: data.wa_user_id,
      jenis: data.jenis,
      data_json: data.data_json,
      status: 'pending',
    },
  });
  
  // Publish event untuk notification service
  await publishEvent(RABBITMQ_CONFIG.ROUTING_KEYS.TICKET_CREATED, {
    wa_user_id: data.wa_user_id,
    ticket_id: ticket.ticket_id,
    jenis: ticket.jenis,
  });
  
  logger.info('Ticket created', { ticket_id });
  
  return ticket;
}

/**
 * Get ticket by ID
 */
export async function getTicketById(ticket_id: string) {
  return await prisma.ticket.findUnique({
    where: { ticket_id },
  });
}

/**
 * Get tickets list with filters and pagination
 */
export async function getTicketsList(filters: TicketFilters) {
  const { status, jenis, wa_user_id, limit = 20, offset = 0 } = filters;
  
  const where: any = {};
  if (status) where.status = status;
  if (jenis) where.jenis = jenis;
  if (wa_user_id) where.wa_user_id = wa_user_id;
  
  const [data, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.ticket.count({ where }),
  ]);
  
  return { data, total, limit, offset };
}

/**
 * Update ticket status
 */
export async function updateTicketStatus(
  ticket_id: string,
  updateData: UpdateTicketStatusData
) {
  const ticket = await prisma.ticket.update({
    where: { ticket_id },
    data: {
      status: updateData.status,
      admin_notes: updateData.admin_notes,
    },
  });
  
  // Publish event untuk notification service
  await publishEvent(RABBITMQ_CONFIG.ROUTING_KEYS.STATUS_UPDATED, {
    wa_user_id: ticket.wa_user_id,
    ticket_id: ticket.ticket_id,
    status: ticket.status,
    admin_notes: ticket.admin_notes,
  });
  
  logger.info('Ticket status updated', {
    ticket_id,
    status: updateData.status,
  });
  
  return ticket;
}

/**
 * Get ticket statistics
 */
export async function getTicketStatistics() {
  const [totalByStatus, totalByJenis, recentTickets] = await Promise.all([
    prisma.ticket.groupBy({
      by: ['status'],
      _count: { status: true },
    }),
    prisma.ticket.groupBy({
      by: ['jenis'],
      _count: { jenis: true },
    }),
    prisma.ticket.count({
      where: {
        created_at: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
        },
      },
    }),
  ]);
  
  return {
    by_status: totalByStatus.map((item: any) => ({
      status: item.status,
      count: item._count._all,
    })),
    by_jenis: totalByJenis.map((item: any) => ({
      jenis: item.jenis,
      count: item._count._all,
    })),
    recent_7_days: recentTickets,
  };
}
