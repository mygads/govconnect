import prisma from '../config/database';
import { generateComplaintId } from '../utils/id-generator';
import { publishEvent } from './rabbitmq.service';
import { RABBITMQ_CONFIG, isUrgentCategory } from '../config/rabbitmq';
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

export interface CancelComplaintData {
  wa_user_id: string;
  cancel_reason?: string;
}

export interface CancelComplaintResult {
  success: boolean;
  error?: 'NOT_FOUND' | 'NOT_OWNER' | 'ALREADY_COMPLETED' | 'INTERNAL_ERROR';
  message?: string;
  complaint_id?: string;
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
  
  // NOTE: We don't publish COMPLAINT_CREATED event anymore because AI Service
  // already sends the response to user via publishAIReply. Publishing this event
  // would cause double response to the user.
  
  // Check if this is an urgent category and publish urgent alert
  if (isUrgentCategory(data.kategori)) {
    await publishEvent(RABBITMQ_CONFIG.ROUTING_KEYS.URGENT_ALERT, {
      type: 'urgent_complaint',
      complaint_id: complaint.complaint_id,
      kategori: complaint.kategori,
      deskripsi: complaint.deskripsi,
      alamat: complaint.alamat,
      rt_rw: complaint.rt_rw,
      wa_user_id: data.wa_user_id,
      created_at: complaint.created_at,
    });
    
    logger.warn('URGENT COMPLAINT CREATED', {
      complaint_id: complaint.complaint_id,
      kategori: complaint.kategori,
    });
  }
  
  logger.info('Complaint created', { complaint_id });
  
  return complaint;
}

/**
 * Get complaint by ID (supports both database id and complaint_id)
 */
export async function getComplaintById(id: string) {
  // Try to find by complaint_id first (e.g., LAP-20251201-001)
  let complaint = await prisma.complaint.findUnique({
    where: { complaint_id: id },
  });
  
  // If not found, try by database id (CUID)
  if (!complaint) {
    complaint = await prisma.complaint.findUnique({
      where: { id },
    });
  }
  
  return complaint;
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
 * Update complaint status (supports both database id and complaint_id)
 */
export async function updateComplaintStatus(
  id: string,
  updateData: UpdateComplaintStatusData
) {
  // First find the complaint to get the correct identifier
  const existingComplaint = await getComplaintById(id);
  if (!existingComplaint) {
    throw new Error('Complaint not found');
  }
  
  const complaint = await prisma.complaint.update({
    where: { id: existingComplaint.id },
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
    complaint_id: complaint.complaint_id,
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

/**
 * Cancel complaint by user (owner validation)
 * Only the user who created the complaint can cancel it
 */
export async function cancelComplaint(
  id: string,
  data: CancelComplaintData
): Promise<CancelComplaintResult> {
  try {
    // Find the complaint
    const complaint = await getComplaintById(id);
    
    if (!complaint) {
      return {
        success: false,
        error: 'NOT_FOUND',
        message: 'Laporan tidak ditemukan',
      };
    }
    
    // Validate ownership - only the creator can cancel
    if (complaint.wa_user_id !== data.wa_user_id) {
      logger.warn('Cancel complaint rejected: not owner', {
        complaint_id: id,
        owner: complaint.wa_user_id,
        requester: data.wa_user_id,
      });
      return {
        success: false,
        error: 'NOT_OWNER',
        message: 'Anda tidak memiliki akses untuk membatalkan laporan ini',
      };
    }
    
    // Check if complaint is already completed or cancelled
    if (complaint.status === 'selesai') {
      return {
        success: false,
        error: 'ALREADY_COMPLETED',
        message: 'Laporan sudah selesai dan tidak dapat dibatalkan',
      };
    }
    
    if (complaint.status === 'dibatalkan') {
      return {
        success: false,
        error: 'ALREADY_COMPLETED',
        message: 'Laporan sudah dibatalkan sebelumnya',
      };
    }
    
    // Update complaint status to cancelled
    const cancelReason = data.cancel_reason || 'Dibatalkan oleh pelapor';
    
    const updatedComplaint = await prisma.complaint.update({
      where: { id: complaint.id },
      data: {
        status: 'dibatalkan',
        admin_notes: `[DIBATALKAN] ${cancelReason}`,
      },
    });
    
    // Publish event for notification service
    await publishEvent(RABBITMQ_CONFIG.ROUTING_KEYS.STATUS_UPDATED, {
      wa_user_id: updatedComplaint.wa_user_id,
      complaint_id: updatedComplaint.complaint_id,
      status: 'dibatalkan',
      admin_notes: cancelReason,
    });
    
    logger.info('Complaint cancelled by user', {
      complaint_id: updatedComplaint.complaint_id,
      wa_user_id: data.wa_user_id,
      cancel_reason: cancelReason,
    });
    
    return {
      success: true,
      complaint_id: updatedComplaint.complaint_id,
      message: cancelReason,
    };
  } catch (error: any) {
    logger.error('Failed to cancel complaint', {
      id,
      error: error.message,
    });
    return {
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Terjadi kesalahan saat membatalkan laporan',
    };
  }
}
