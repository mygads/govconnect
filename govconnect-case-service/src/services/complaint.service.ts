import prisma from '../config/database';
import { generateComplaintId } from '../utils/id-generator';
import { publishEvent } from './rabbitmq.service';
import { RABBITMQ_CONFIG, isUrgentCategory } from '../config/rabbitmq';
import logger from '../utils/logger';
import { invalidateStatsCache } from './query-batcher.service';

export interface CreateComplaintData {
  wa_user_id?: string;
  channel?: 'WHATSAPP' | 'WEBCHAT';
  channel_identifier?: string;
  kategori: string;
  deskripsi: string;
  alamat?: string;
  rt_rw?: string;
  foto_url?: string;
  category_id?: string;
  type_id?: string;
  is_urgent?: boolean;
  require_address?: boolean;
  village_id?: string;
}

export interface UpdateComplaintStatusData {
  status: string;
  admin_notes?: string;
}

export interface CancelComplaintData {
  wa_user_id?: string;
  channel?: 'WHATSAPP' | 'WEBCHAT';
  channel_identifier?: string;
  cancel_reason?: string;
}

export interface UpdateComplaintByUserData {
  wa_user_id?: string;
  channel?: 'WHATSAPP' | 'WEBCHAT';
  channel_identifier?: string;
  alamat?: string;
  deskripsi?: string;
  rt_rw?: string;
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
  channel?: 'WHATSAPP' | 'WEBCHAT';
  channel_identifier?: string;
  village_id?: string;
  category_id?: string;
  type_id?: string;
  limit?: number;
  offset?: number;
}

function isSameRequester(complaint: { channel: 'WHATSAPP' | 'WEBCHAT'; wa_user_id: string | null; channel_identifier: string | null }, params: {
  channel: 'WHATSAPP' | 'WEBCHAT';
  wa_user_id?: string;
  channel_identifier?: string;
}): boolean {
  if (params.channel === 'WEBCHAT') {
    return complaint.channel === 'WEBCHAT' && !!params.channel_identifier && complaint.channel_identifier === params.channel_identifier;
  }
  return !!params.wa_user_id && complaint.wa_user_id === params.wa_user_id;
}

/**
 * Create new complaint
 */
export async function createComplaint(data: CreateComplaintData) {
  const complaint_id = await generateComplaintId();

  const isUrgent = data.is_urgent ?? isUrgentCategory(data.kategori);
  const channel = data.channel || 'WHATSAPP';
  const channelIdentifier = channel === 'WEBCHAT'
    ? data.channel_identifier
    : data.wa_user_id;
  
  const complaint = await prisma.complaint.create({
    data: {
      complaint_id,
      wa_user_id: data.wa_user_id || null,
      channel,
      channel_identifier: channelIdentifier || null,
      kategori: data.kategori,
      category_id: data.category_id,
      type_id: data.type_id,
      deskripsi: data.deskripsi,
      alamat: data.alamat,
      rt_rw: data.rt_rw,
      foto_url: data.foto_url,
      is_urgent: isUrgent,
      require_address: data.require_address ?? false,
      village_id: data.village_id,
      status: 'OPEN',
    },
  });
  
  // NOTE: We don't publish COMPLAINT_CREATED event anymore because AI Service
  // already sends the response to user via publishAIReply. Publishing this event
  // would cause double response to the user.
  
  // Check if this is an urgent category and publish urgent alert
  if (isUrgent) {
    await publishEvent(RABBITMQ_CONFIG.ROUTING_KEYS.URGENT_ALERT, {
      type: 'urgent_complaint',
      complaint_id: complaint.complaint_id,
      kategori: complaint.kategori,
      deskripsi: complaint.deskripsi,
      alamat: complaint.alamat,
      rt_rw: complaint.rt_rw,
      wa_user_id: data.wa_user_id,
      channel,
      channel_identifier: channelIdentifier || null,
      created_at: complaint.created_at,
    });
    
    logger.warn('URGENT COMPLAINT CREATED', {
      complaint_id: complaint.complaint_id,
      kategori: complaint.kategori,
    });
  }
  
  logger.info('Complaint created', { complaint_id });
  
  // Invalidate stats cache
  invalidateStatsCache();
  
  return complaint;
}

/**
 * Get complaint by ID (supports both database id and complaint_id)
 * If village_id is provided, validates that the complaint belongs to that village
 */
export async function getComplaintById(id: string, village_id?: string) {
  // Try to find by complaint_id first (e.g., LAP-20251201-001)
  let complaint = await prisma.complaint.findUnique({
    where: { complaint_id: id },
    include: {
      updates: true,
      category: true,
      type: true,
    },
  });
  
  // If not found, try by database id (CUID)
  if (!complaint) {
    complaint = await prisma.complaint.findUnique({
      where: { id },
      include: {
        updates: true,
        category: true,
        type: true,
      },
    });
  }
  
  // Validate village_id if provided (multi-tenancy security)
  if (complaint && village_id && complaint.village_id !== village_id) {
    return null; // Return null if complaint doesn't belong to the admin's village
  }
  
  return complaint;
}

/**
 * Get complaint by ID with ownership validation
 * Only returns complaint if the user is the owner
 */
export async function getComplaintByIdWithOwnership(
  id: string,
  params: { wa_user_id?: string; channel?: 'WHATSAPP' | 'WEBCHAT'; channel_identifier?: string }
): Promise<{
  success: boolean;
  error?: 'NOT_FOUND' | 'NOT_OWNER';
  message?: string;
  data?: any;
}> {
  const complaint = await getComplaintById(id);
  
  if (!complaint) {
    return {
      success: false,
      error: 'NOT_FOUND',
      message: 'Laporan tidak ditemukan',
    };
  }
  
  // Validate ownership
  const channel = params.channel || 'WHATSAPP';
  if (!isSameRequester(complaint, { channel, wa_user_id: params.wa_user_id, channel_identifier: params.channel_identifier })) {
    logger.warn('Get complaint rejected: not owner', {
      complaint_id: id,
      owner: complaint.wa_user_id,
      requester: params.wa_user_id || params.channel_identifier,
    });
    return {
      success: false,
      error: 'NOT_OWNER',
      message: 'Anda tidak memiliki akses untuk melihat laporan ini. Silakan cek nomor laporan Anda.',
    };
  }
  
  return {
    success: true,
    data: complaint,
  };
}

/**
 * Get complaints list with filters and pagination
 */
export async function getComplaintsList(filters: ComplaintFilters) {
  const { status, kategori, rt_rw, wa_user_id, channel, channel_identifier, village_id, category_id, type_id, limit = 20, offset = 0 } = filters;
  
  const where: any = {};
  if (status) where.status = status;
  if (kategori) where.kategori = kategori;
  if (rt_rw) where.rt_rw = rt_rw;
  if (wa_user_id) where.wa_user_id = wa_user_id;
  if (channel_identifier && channel) {
    where.channel = channel;
    where.channel_identifier = channel_identifier;
  }
  if (village_id) where.village_id = village_id;
  if (category_id) where.category_id = category_id;
  if (type_id) where.type_id = type_id;
  
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
  
  // Invalidate stats cache
  invalidateStatsCache();
  
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
    const channel = data.channel || 'WHATSAPP';
    if (!isSameRequester(complaint, { channel, wa_user_id: data.wa_user_id, channel_identifier: data.channel_identifier })) {
      logger.warn('Cancel complaint rejected: not owner', {
        complaint_id: id,
        owner: complaint.wa_user_id,
        requester: data.wa_user_id || data.channel_identifier,
      });
      return {
        success: false,
        error: 'NOT_OWNER',
        message: 'Anda tidak memiliki akses untuk membatalkan laporan ini',
      };
    }
    
    // Check if complaint is already completed or cancelled
    if (complaint.status === 'DONE') {
      return {
        success: false,
        error: 'ALREADY_COMPLETED',
        message: 'Laporan sudah selesai dan tidak dapat dibatalkan',
      };
    }
    
    if (complaint.status === 'CANCELED') {
      return {
        success: false,
        error: 'ALREADY_COMPLETED',
        message: 'Laporan sudah dibatalkan sebelumnya',
      };
    }

    if (complaint.status === 'REJECT') {
      return {
        success: false,
        error: 'ALREADY_COMPLETED',
        message: 'Laporan sudah ditolak dan tidak dapat dibatalkan',
      };
    }
    
    // Update complaint status to cancelled
    const cancelReason = data.cancel_reason?.trim();
    if (!cancelReason) {
      return {
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Alasan pembatalan wajib diisi',
      };
    }
    const cancelNote = `Dibatalkan oleh masyarakat: ${cancelReason}`;
    
    const updatedComplaint = await prisma.complaint.update({
      where: { id: complaint.id },
      data: {
        status: 'CANCELED',
        admin_notes: cancelNote,
      },
    });
    
    // Publish event for notification service
    await publishEvent(RABBITMQ_CONFIG.ROUTING_KEYS.STATUS_UPDATED, {
      wa_user_id: updatedComplaint.wa_user_id,
      complaint_id: updatedComplaint.complaint_id,
      status: 'CANCELED',
      admin_notes: cancelNote,
    });
    
    logger.info('Complaint cancelled by user', {
      complaint_id: updatedComplaint.complaint_id,
      wa_user_id: data.wa_user_id,
      cancel_reason: cancelNote,
    });
    
    return {
      success: true,
      complaint_id: updatedComplaint.complaint_id,
      message: cancelNote,
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

/**
 * Update complaint by user (owner validation)
 * User can only update address/description/rt_rw while status is not DONE/CANCELED
 */
export async function updateComplaintByUser(
  id: string,
  data: UpdateComplaintByUserData
): Promise<{ success: boolean; error?: 'NOT_FOUND' | 'NOT_OWNER' | 'LOCKED'; message?: string; data?: any }> {
  try {
    const complaint = await prisma.complaint.findFirst({
      where: {
        OR: [{ id }, { complaint_id: id }],
      },
    });

    if (!complaint) {
      return { success: false, error: 'NOT_FOUND', message: 'Laporan tidak ditemukan' };
    }

    const channel = data.channel || 'WHATSAPP';
    if (!isSameRequester(complaint, { channel, wa_user_id: data.wa_user_id, channel_identifier: data.channel_identifier })) {
      return { success: false, error: 'NOT_OWNER', message: 'Anda tidak memiliki akses untuk mengubah laporan ini' };
    }

    if (['DONE', 'CANCELED', 'REJECT'].includes(complaint.status)) {
      return { success: false, error: 'LOCKED', message: 'Laporan sudah selesai/dibatalkan/ditolak dan tidak bisa diubah' };
    }

    const updated = await prisma.complaint.update({
      where: { id: complaint.id },
      data: {
        alamat: data.alamat ?? undefined,
        deskripsi: data.deskripsi ?? undefined,
        rt_rw: data.rt_rw ?? undefined,
      },
    });

    return { success: true, data: updated };
  } catch (error: any) {
    logger.error('Update complaint by user failed', { error: error.message, id, wa_user_id: data.wa_user_id, channel_identifier: data.channel_identifier });
    return { success: false, error: 'NOT_FOUND', message: 'Terjadi kesalahan saat memperbarui laporan' };
  }
}
