import prisma from '../config/database';
import { generateComplaintId } from '../utils/id-generator';
import { enqueueOutboxEvent } from './outbox.service';
import { RABBITMQ_CONFIG } from '../config/rabbitmq';
import logger from '../utils/logger';
import { invalidateStatsCache } from './query-batcher.service';
import { resolveWithMicroLLM } from './micro-llm-resolver.service';
import { mergeComplaintClassification } from './complaint-classification';

// ==================== COMPLAINT TYPE RESOLVER (Micro LLM) ====================

interface ResolvedComplaintType {
  type_id: string;
  category_id: string;
  is_urgent: boolean;
  require_address: boolean;
  send_important_contacts: boolean;
  important_contact_category: string | null;
  important_contact_category_id: string | null;
  matched_name: string;
  match_method: string;
}

/**
 * Resolve a kategori string to a ComplaintType using a micro LLM.
 *
 * Instead of hardcoded synonyms or pattern matching, this sends the user's
 * kategori + all available complaint types to AI Service so the gateway-only
 * micro NLU layer can determine the best semantic match.
 *
 * This handles slang, typos, regional words, informal language, etc. — things
 * that static keyword maps can never fully cover.
 *
 * @returns ResolvedComplaintType or null if no match found
 */
export async function resolveComplaintTypeFromDB(
  kategori: string,
  villageId?: string
): Promise<ResolvedComplaintType | null> {
  if (!kategori) return null;

  try {
    const whereClause = villageId
      ? { category: { village_id: villageId } }
      : {};

    const types = await prisma.complaintType.findMany({
      where: whereClause,
      include: { category: true },
    });

    if (!types.length) return null;

    // Build options list for the micro LLM
    const options = types.map(t => ({
      id: t.id,
      name: t.name,
      category_name: t.category?.name || '',
      is_urgent: t.is_urgent ?? false,
    }));

    // Ask micro LLM to semantically match
    const llmResult = await resolveWithMicroLLM(kategori, options, {
      village_id: villageId,
    });

    if (llmResult?.matched_id && llmResult.confidence >= 0.5) {
      const matched = types.find(t => t.id === llmResult.matched_id);
      if (matched) {
        return {
          type_id: matched.id,
          category_id: matched.category_id,
          is_urgent: matched.is_urgent ?? false,
          require_address: matched.require_address ?? false,
          send_important_contacts: matched.send_important_contacts ?? false,
          important_contact_category: matched.important_contact_category || null,
          important_contact_category_id: matched.important_contact_category_id || null,
          matched_name: matched.name,
          match_method: `micro_llm (confidence: ${llmResult.confidence}, reason: ${llmResult.reason})`,
        };
      }
    }

    logger.debug('resolveComplaintTypeFromDB: no match via micro LLM', {
      kategori,
      villageId,
      llmResult,
    });
    return null;
  } catch (error: any) {
    logger.error('resolveComplaintTypeFromDB failed', { error: error.message, kategori, villageId });
    return null;
  }
}

async function resolveComplaintTypeById(
  typeId: string,
  villageId: string
): Promise<ResolvedComplaintType | null> {
  try {
    const matched = await prisma.complaintType.findFirst({
      where: {
        id: typeId,
        category: { village_id: villageId },
      },
      include: { category: true },
    });

    if (!matched) return null;

    return {
      type_id: matched.id,
      category_id: matched.category_id,
      is_urgent: matched.is_urgent ?? false,
      require_address: matched.require_address ?? false,
      send_important_contacts: matched.send_important_contacts ?? false,
      important_contact_category: matched.important_contact_category || null,
      important_contact_category_id: matched.important_contact_category_id || null,
      matched_name: matched.name,
      match_method: 'type_id',
    };
  } catch (error: any) {
    logger.error('resolveComplaintTypeById failed', { error: error.message, typeId, villageId });
    return null;
  }
}

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
  reporter_name?: string;
  reporter_phone?: string;
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
  search?: string;
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
 * Auto-resolves type_id/category_id from DB when not provided by caller.
 */
export async function createComplaint(data: CreateComplaintData) {
  // Enforce village_id as required for multi-tenancy
  if (!data.village_id) {
    throw new Error('village_id is required for creating complaints');
  }

  const complaint_id = await generateComplaintId();

  const channel = data.channel || 'WHATSAPP';
  const channelIdentifier = channel === 'WEBCHAT'
    ? data.channel_identifier
    : data.wa_user_id;

  // Server-side authoritative resolution: village complaint type config wins over request payload.
  let resolvedTypeId = data.type_id || undefined;
  let resolvedCategoryId = data.category_id || undefined;
  let resolvedIsUrgent = data.is_urgent ?? false;
  let resolvedRequireAddress = data.require_address ?? false;

  let resolved = resolvedTypeId
    ? await resolveComplaintTypeById(resolvedTypeId, data.village_id)
    : null;

  if (!resolved && data.kategori) {
    resolved = await resolveComplaintTypeFromDB(data.kategori, data.village_id);
  }

  if (resolved) {
    if (data.category_id && data.category_id !== resolved.category_id) {
      throw new Error('category_id does not match the selected complaint type');
    }

    const merged = mergeComplaintClassification(
      {
        type_id: resolvedTypeId,
        category_id: resolvedCategoryId,
        is_urgent: resolvedIsUrgent,
        require_address: resolvedRequireAddress,
      },
      {
        type_id: resolved.type_id,
        category_id: resolved.category_id,
        is_urgent: resolved.is_urgent,
        require_address: resolved.require_address,
      },
    );

    resolvedTypeId = merged.type_id || undefined;
    resolvedCategoryId = merged.category_id || undefined;
    resolvedIsUrgent = merged.is_urgent;
    resolvedRequireAddress = merged.require_address;
    logger.info('Resolved complaint type from authoritative DB config', {
      kategori: data.kategori,
      matched_name: resolved.matched_name,
      match_method: resolved.match_method,
      type_id: resolved.type_id,
      is_urgent: resolved.is_urgent,
    });
  } else if (data.type_id || data.kategori) {
    resolvedTypeId = undefined;
    resolvedCategoryId = undefined;
    resolvedIsUrgent = false;
    resolvedRequireAddress = false;
    logger.warn('Could not resolve complaint type from authoritative DB config', {
      provided_type_id: data.type_id,
      kategori: data.kategori,
      village_id: data.village_id,
    });
  }

  if (resolvedRequireAddress && !data.alamat?.trim()) {
    throw new Error('alamat is required for this complaint type');
  }
  
  const complaint = await prisma.$transaction(async (tx) => {
    const createdComplaint = await tx.complaint.create({
      data: {
        complaint_id,
        wa_user_id: data.wa_user_id || null,
        channel,
        channel_identifier: channelIdentifier || null,
        kategori: data.kategori,
        category_id: resolvedCategoryId,
        type_id: resolvedTypeId,
        deskripsi: data.deskripsi,
        alamat: data.alamat,
        rt_rw: data.rt_rw,
        foto_url: data.foto_url,
        is_urgent: resolvedIsUrgent,
        require_address: resolvedRequireAddress,
        reporter_name: data.reporter_name || null,
        reporter_phone: data.reporter_phone || null,
        village_id: data.village_id!,
        status: 'OPEN',
      },
    });

    if (resolved?.send_important_contacts && resolved.important_contact_category_id) {
      await enqueueOutboxEvent(tx, {
        routingKey: RABBITMQ_CONFIG.ROUTING_KEYS.COMPLAINT_IMPORTANT_CONTACTS,
        payload: {
          type: 'complaint_important_contacts',
          complaint_id: createdComplaint.complaint_id,
          village_id: createdComplaint.village_id,
          kategori: createdComplaint.kategori,
          important_contact_category: resolved.important_contact_category,
          important_contact_category_id: resolved.important_contact_category_id,
          wa_user_id: data.wa_user_id,
          channel,
          channel_identifier: channelIdentifier || null,
          created_at: createdComplaint.created_at,
        },
        entityType: 'complaint',
        entityId: createdComplaint.complaint_id,
      });
    } else if (resolved?.send_important_contacts) {
      logger.warn('Complaint type requests important-contact auto send without category config', {
        complaint_id: createdComplaint.complaint_id,
        village_id: createdComplaint.village_id,
        type_id: resolved.type_id,
      });
    }

    if (resolvedIsUrgent) {
      await enqueueOutboxEvent(tx, {
        routingKey: RABBITMQ_CONFIG.ROUTING_KEYS.URGENT_ALERT,
        payload: {
          type: 'urgent_complaint',
          complaint_id: createdComplaint.complaint_id,
          village_id: createdComplaint.village_id,
          kategori: createdComplaint.kategori,
          deskripsi: createdComplaint.deskripsi,
          alamat: createdComplaint.alamat,
          rt_rw: createdComplaint.rt_rw,
          wa_user_id: data.wa_user_id,
          channel,
          channel_identifier: channelIdentifier || null,
          created_at: createdComplaint.created_at,
        },
        entityType: 'complaint',
        entityId: createdComplaint.complaint_id,
      });
    }

    return createdComplaint;
  });

  // NOTE: We don't publish COMPLAINT_CREATED event anymore because AI Service
  // already sends the response to user via publishAIReply. Publishing this event
  // would cause double response to the user.

  if (resolvedIsUrgent) {
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
  const { status, kategori, rt_rw, wa_user_id, channel, channel_identifier, village_id, category_id, type_id, search, limit = 20, offset = 0 } = filters;

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
  if (search?.trim()) {
    const query = search.trim();
    where.OR = [
      { complaint_id: { contains: query, mode: 'insensitive' } },
      { wa_user_id: { contains: query, mode: 'insensitive' } },
      { channel_identifier: { contains: query, mode: 'insensitive' } },
      { reporter_name: { contains: query, mode: 'insensitive' } },
      { reporter_phone: { contains: query, mode: 'insensitive' } },
      { kategori: { contains: query, mode: 'insensitive' } },
      { deskripsi: { contains: query, mode: 'insensitive' } },
      { category: { name: { contains: query, mode: 'insensitive' } } },
      { type: { name: { contains: query, mode: 'insensitive' } } },
    ];
  }
  // Exclude soft-deleted records
  where.deleted_at = null;
  
  const [data, total] = await Promise.all([
    prisma.complaint.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
      include: {
        category: true,
        type: true,
      },
    }),
    prisma.complaint.count({ where }),
  ]);
  
  return { data, total, limit, offset };
}

/**
 * Valid status transitions map.
 * Prevents invalid transitions like DONE → OPEN.
 */
const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  OPEN: ['PROCESS', 'DONE', 'CANCELED', 'REJECT'],
  PROCESS: ['DONE', 'CANCELED', 'REJECT'],
  DONE: [],       // Terminal state — no further transitions allowed
  CANCELED: [],   // Terminal state
  REJECT: [],     // Terminal state
};

function isValidTransition(currentStatus: string, newStatus: string): boolean {
  const allowed = VALID_STATUS_TRANSITIONS[currentStatus];
  if (!allowed) return true; // Unknown status → allow (backward compat)
  return allowed.includes(newStatus);
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

  // Validate status transition
  if (!isValidTransition(existingComplaint.status, updateData.status)) {
    throw new Error(`Transisi status tidak valid: ${existingComplaint.status} → ${updateData.status}. Status ${existingComplaint.status} sudah final.`);
  }
  
  const complaint = await prisma.$transaction(async (tx) => {
    const updatedComplaint = await tx.complaint.update({
      where: { id: existingComplaint.id },
      data: {
        status: updateData.status,
        admin_notes: updateData.admin_notes,
        status_notified_at: null,
        status_delivered_at: null,
        last_delivery_message_id: null,
        last_delivery_status: null,
        last_delivery_error: null,
        last_delivery_attempt_at: null,
      },
    });

    await enqueueOutboxEvent(tx, {
      routingKey: RABBITMQ_CONFIG.ROUTING_KEYS.STATUS_UPDATED,
      payload: {
        village_id: updatedComplaint.village_id,
        wa_user_id: updatedComplaint.wa_user_id,
        channel: updatedComplaint.channel || 'WHATSAPP',
        channel_identifier: updatedComplaint.channel_identifier || updatedComplaint.wa_user_id,
        complaint_id: updatedComplaint.complaint_id,
        status: updatedComplaint.status,
        admin_notes: updatedComplaint.admin_notes,
      },
      entityType: 'complaint',
      entityId: updatedComplaint.complaint_id,
    });

    return updatedComplaint;
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
 * Get statistics (filtered by village_id for multi-tenancy)
 */
export async function getComplaintStatistics(villageId?: string) {
  const where = villageId ? { village_id: villageId, deleted_at: null } : { deleted_at: null };
  const [
    totalByStatus,
    totalByKategori,
    totalByRtRw,
    recentComplaints,
  ] = await Promise.all([
    prisma.complaint.groupBy({
      by: ['status'],
      _count: { status: true },
      where,
    }),
    prisma.complaint.groupBy({
      by: ['kategori'],
      _count: { kategori: true },
      where,
    }),
    prisma.complaint.groupBy({
      by: ['rt_rw'],
      _count: { rt_rw: true },
      where: { ...where, rt_rw: { not: null } },
    }),
    prisma.complaint.count({
      where: {
        ...where,
        created_at: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
        },
      },
    }),
  ]);
  
  return {
    by_status: totalByStatus.map((item: any) => ({
      status: item.status,
      count: item._count.status,
    })),
    by_kategori: totalByKategori.map((item: any) => ({
      kategori: item.kategori,
      count: item._count.kategori,
    })),
    by_rt_rw: totalByRtRw.map((item: any) => ({
      rt_rw: item.rt_rw,
      count: item._count.rt_rw,
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
    const cancelReason = data.cancel_reason?.trim() || 'tanpa alasan tambahan';
    const cancelNote = `Dibatalkan oleh masyarakat: ${cancelReason}`;
    
    const updatedComplaint = await prisma.$transaction(async (tx) => {
      const cancelledComplaint = await tx.complaint.update({
        where: { id: complaint.id },
        data: {
          status: 'CANCELED',
          admin_notes: cancelNote,
          status_notified_at: null,
          status_delivered_at: null,
          last_delivery_message_id: null,
          last_delivery_status: null,
          last_delivery_error: null,
          last_delivery_attempt_at: null,
        },
      });

      await enqueueOutboxEvent(tx, {
        routingKey: RABBITMQ_CONFIG.ROUTING_KEYS.STATUS_UPDATED,
        payload: {
          village_id: cancelledComplaint.village_id,
          wa_user_id: cancelledComplaint.wa_user_id,
          channel: cancelledComplaint.channel || 'WHATSAPP',
          channel_identifier: cancelledComplaint.channel_identifier || cancelledComplaint.wa_user_id,
          complaint_id: cancelledComplaint.complaint_id,
          status: 'CANCELED',
          admin_notes: cancelNote,
        },
        entityType: 'complaint',
        entityId: cancelledComplaint.complaint_id,
      });

      return cancelledComplaint;
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

    // If deskripsi starts with [Update], append to existing description
    let finalDeskripsi = data.deskripsi;
    if (finalDeskripsi && finalDeskripsi.startsWith('[Update]') && complaint.deskripsi) {
      finalDeskripsi = `${complaint.deskripsi}\n\n${finalDeskripsi}`;
    }

    const updated = await prisma.complaint.update({
      where: { id: complaint.id },
      data: {
        alamat: data.alamat ?? undefined,
        deskripsi: finalDeskripsi ?? undefined,
        rt_rw: data.rt_rw ?? undefined,
      },
    });

    return { success: true, data: updated };
  } catch (error: any) {
    logger.error('Update complaint by user failed', { error: error.message, id, wa_user_id: data.wa_user_id, channel_identifier: data.channel_identifier });
    return { success: false, error: 'NOT_FOUND', message: 'Terjadi kesalahan saat memperbarui laporan' };
  }
}
