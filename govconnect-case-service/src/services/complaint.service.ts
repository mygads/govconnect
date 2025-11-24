import prisma from '../config/database';
import { generateComplaintId } from '../utils/id-generator';
import { publishEvent } from './rabbitmq.service';
import { RABBITMQ_CONFIG } from '../config/rabbitmq';
import logger from '../utils/logger';

export interface CreateComplaintData {
  wa_user_id: string;
  kategori: string;
  deskripsi: string;
  alamat?: string;
  rt_rw?: string;
  foto_url?: string;
}

export interface UpdateComplaintStatusData {
  status: string;
  admin_notes?: string;
}

export interface ComplaintFilters {
  status?: string;
  kategori?: string;
  rt_rw?: string;
  wa_user_id?: string;
  limit?: number;
  offset?: number;
}

/**
 * Create new complaint
 */
export async function createComplaint(data: CreateComplaintData) {
  const complaint_id = await generateComplaintId();
  
  const complaint = await prisma.complaint.create({
    data: {
      complaint_id,
      wa_user_id: data.wa_user_id,
      kategori: data.kategori,
      deskripsi: data.deskripsi,
      alamat: data.alamat,
      rt_rw: data.rt_rw,
      foto_url: data.foto_url,
      status: 'baru',
    },
  });
  
  // Publish event untuk notification service
  await publishEvent(RABBITMQ_CONFIG.ROUTING_KEYS.COMPLAINT_CREATED, {
    wa_user_id: data.wa_user_id,
    complaint_id: complaint.complaint_id,
    kategori: complaint.kategori,
  });
  
  logger.info('Complaint created', { complaint_id });
  
  return complaint;
}

/**
 * Get complaint by ID
 */
export async function getComplaintById(complaint_id: string) {
  return await prisma.complaint.findUnique({
    where: { complaint_id },
  });
}

/**
 * Get complaints list with filters and pagination
 */
export async function getComplaintsList(filters: ComplaintFilters) {
  const { status, kategori, rt_rw, wa_user_id, limit = 20, offset = 0 } = filters;
  
  const where: any = {};
  if (status) where.status = status;
  if (kategori) where.kategori = kategori;
  if (rt_rw) where.rt_rw = rt_rw;
  if (wa_user_id) where.wa_user_id = wa_user_id;
  
  const [data, total] = await Promise.all([
    prisma.complaint.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.complaint.count({ where }),
  ]);
  
  return { data, total, limit, offset };
}

/**
 * Update complaint status
 */
export async function updateComplaintStatus(
  complaint_id: string,
  updateData: UpdateComplaintStatusData
) {
  const complaint = await prisma.complaint.update({
    where: { complaint_id },
    data: {
      status: updateData.status,
      admin_notes: updateData.admin_notes,
    },
  });
  
  // Publish event untuk notification service
  await publishEvent(RABBITMQ_CONFIG.ROUTING_KEYS.STATUS_UPDATED, {
    wa_user_id: complaint.wa_user_id,
    complaint_id: complaint.complaint_id,
    status: complaint.status,
    admin_notes: complaint.admin_notes,
  });
  
  logger.info('Complaint status updated', {
    complaint_id,
    status: updateData.status,
  });
  
  return complaint;
}

/**
 * Get statistics
 */
export async function getComplaintStatistics() {
  const [
    totalByStatus,
    totalByKategori,
    totalByRtRw,
    recentComplaints,
  ] = await Promise.all([
    prisma.complaint.groupBy({
      by: ['status'],
      _count: { status: true },
    }),
    prisma.complaint.groupBy({
      by: ['kategori'],
      _count: { kategori: true },
    }),
    prisma.complaint.groupBy({
      by: ['rt_rw'],
      _count: { rt_rw: true },
      where: { rt_rw: { not: null } },
    }),
    prisma.complaint.count({
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
    by_kategori: totalByKategori.map((item: any) => ({
      kategori: item.kategori,
      count: item._count._all,
    })),
    by_rt_rw: totalByRtRw.map((item: any) => ({
      rt_rw: item.rt_rw,
      count: item._count._all,
    })),
    recent_7_days: recentComplaints,
  };
}
