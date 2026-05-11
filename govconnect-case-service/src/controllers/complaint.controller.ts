import { Request, Response } from 'express';
import {
  createComplaint,
  getComplaintById,
  getComplaintsList,
  updateComplaintStatus,
  getComplaintStatistics,
  cancelComplaint,
  updateComplaintByUser,
} from '../services/complaint.service';
import { checkDuplicateComplaint, checkGlobalDuplicate } from '../services/complaint-deduplication.service';
import logger from '../utils/logger';
import { getParam, getQuery, getQueryInt } from '../utils/http';
import prisma from '../config/database';
import { invalidateStatsCache } from '../services/query-batcher.service';
import { enqueueOutboxEvent } from '../services/outbox.service';
import { RABBITMQ_CONFIG } from '../config/rabbitmq';
import { recordAuditLog } from '../services/audit-log.service';

function getAuditMetadata(req: Request) {
  return {
    admin_id: (req.headers['x-admin-id'] as string) || null,
    admin_role: (req.headers['x-admin-role'] as string) || null,
    admin_name: (req.headers['x-admin-name'] as string) || null,
    reason: (req.body?.reason || req.body?.admin_notes || req.body?.note) as string | undefined,
  };
}

function resolveChannelFromRequest(req: Request): 'WHATSAPP' | 'WEBCHAT' {
  const raw = (req.body?.channel || getQuery(req, 'channel') || '').toString().toUpperCase();
  if (raw === 'WEBCHAT') return 'WEBCHAT';
  const sessionId = (req.body?.session_id || req.body?.sessionId || getQuery(req, 'session_id') || getQuery(req, 'sessionId')) as string | undefined;
  if (sessionId && sessionId.startsWith('web_')) return 'WEBCHAT';
  return 'WHATSAPP';
}

function resolveChannelIdentifier(req: Request, channel: 'WHATSAPP' | 'WEBCHAT'): string | null {
  const sessionId = (req.body?.session_id || req.body?.sessionId || getQuery(req, 'session_id') || getQuery(req, 'sessionId')) as string | undefined;
  const channelIdentifier = (req.body?.channel_identifier || getQuery(req, 'channel_identifier')) as string | undefined;
  if (channel === 'WEBCHAT') return sessionId || channelIdentifier || null;
  return null;
}

/**
 * POST /laporan/create
 * Create new complaint (from AI Service)
 */
export async function handleCreateComplaint(req: Request, res: Response) {
  try {
    const { wa_user_id, kategori, deskripsi, alamat, rt_rw, foto_url, channel, channel_identifier, reporter_name, reporter_phone } = req.body;
    const resolvedChannel = resolveChannelFromRequest(req);
    const resolvedIdentifier = resolveChannelIdentifier(req, resolvedChannel) || channel_identifier;

    if (resolvedChannel === 'WHATSAPP' && !wa_user_id) {
      return res.status(400).json({ error: 'wa_user_id is required' });
    }

    if (resolvedChannel === 'WEBCHAT' && !resolvedIdentifier) {
      return res.status(400).json({ error: 'session_id/channel_identifier is required' });
    }

    // Check for duplicate complaint
    const duplicateCheck = await checkDuplicateComplaint({
      wa_user_id,
      channel: resolvedChannel,
      channel_identifier: resolvedIdentifier,
      kategori,
      deskripsi,
      alamat,
      rt_rw,
    });

    if (duplicateCheck.isDuplicate) {
      logger.info('Duplicate complaint rejected', {
        wa_user_id,
        existingId: duplicateCheck.existingId,
        similarity: duplicateCheck.similarity,
      });

      return res.status(409).json({
        status: 'duplicate',
        error: 'Laporan serupa sudah ada',
        data: {
          existing_complaint_id: duplicateCheck.existingId,
          message: duplicateCheck.reason,
        },
      });
    }

    // Check for global similar complaints (informational)
    const globalCheck = await checkGlobalDuplicate({
      wa_user_id,
      channel: resolvedChannel,
      channel_identifier: resolvedIdentifier,
      kategori,
      deskripsi,
      alamat,
      rt_rw,
    });

    const complaint = await createComplaint({
      wa_user_id,
      kategori,
      deskripsi,
      alamat,
      rt_rw,
      foto_url,
      channel: resolvedChannel,
      channel_identifier: resolvedIdentifier,
      village_id: req.body.village_id,
      type_id: req.body.type_id,
      category_id: req.body.category_id,
      is_urgent: req.body.is_urgent,
      reporter_name,
      reporter_phone,
    });

    // Include info about similar reports if any
    const responseData: any = {
      complaint_id: complaint.complaint_id,
      status: complaint.status,
    };

    if (globalCheck.hasSimilar && globalCheck.similarCount > 0) {
      responseData.similar_reports = {
        count: globalCheck.similarCount,
        message: `Ada ${globalCheck.similarCount} laporan serupa di lokasi yang sama`,
      };
    }
    
    return res.status(201).json({
      status: 'success',
      data: responseData,
    });
  } catch (error: any) {
    if (
      error.message === 'alamat is required for this complaint type' ||
      error.message === 'category_id does not match the selected complaint type' ||
      error.message === 'village_id is required for creating complaints'
    ) {
      return res.status(400).json({ error: error.message });
    }
    logger.error('Create complaint error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /laporan
 * Get complaints list (for Dashboard)
 */
export async function handleGetComplaints(req: Request, res: Response) {
  try {
    const filters = {
      status: getQuery(req, 'status'),
      kategori: getQuery(req, 'kategori'),
      category_id: getQuery(req, 'category_id'),
      type_id: getQuery(req, 'type_id'),
      search: getQuery(req, 'search') || getQuery(req, 'q'),
      rt_rw: getQuery(req, 'rt_rw'),
      wa_user_id: getQuery(req, 'wa_user_id'),
      channel: (getQuery(req, 'channel') || undefined)?.toString().toUpperCase() as any,
      channel_identifier: getQuery(req, 'channel_identifier') || getQuery(req, 'session_id'),
      village_id: getQuery(req, 'village_id'),
      limit: getQueryInt(getQuery(req, 'limit'), 20),
      offset: getQueryInt(getQuery(req, 'offset'), 0),
    };
    
    const result = await getComplaintsList(filters);
    
    return res.json({
      data: result.data,
      pagination: {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
      },
    });
  } catch (error: any) {
    logger.error('Get complaints error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleGetRealtimeComplaintSummary(req: Request, res: Response) {
  try {
    const village_id = getQuery(req, 'village_id') || undefined;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const lastHour = new Date(Date.now() - 60 * 60 * 1000);

    const whereBase: any = {
      deleted_at: null,
      ...(village_id ? { village_id } : {}),
    };
    const urgentWhere = {
      ...whereBase,
      is_urgent: true,
      status: 'OPEN',
    };

    const [urgentComplaints, urgentCount, recentComplaints, todayCount, lastHourCount] = await Promise.all([
      prisma.complaint.findMany({
        where: urgentWhere,
        orderBy: { created_at: 'asc' },
        take: 20,
        include: { category: true, type: true },
      }),
      prisma.complaint.count({ where: urgentWhere }),
      prisma.complaint.findMany({
        where: whereBase,
        orderBy: { created_at: 'desc' },
        take: 10,
        include: { category: true, type: true },
      }),
      prisma.complaint.count({ where: { ...whereBase, created_at: { gte: today } } }),
      prisma.complaint.count({ where: { ...whereBase, created_at: { gte: lastHour } } }),
    ]);

    return res.json({
      data: {
        urgentComplaints,
        urgentCount,
        recentComplaints,
        todayCount,
        lastHourCount,
      },
    });
  } catch (error: any) {
    logger.error('Get realtime complaint summary error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /laporan/:id
 * Get complaint by ID (for admin/dashboard - validates village_id for multi-tenancy)
 */
export async function handleGetComplaintById(req: Request, res: Response) {
  try {
    const id = getParam(req, 'id');
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    
    // Get village_id from query param for multi-tenancy validation
    const village_id = getQuery(req, 'village_id') || undefined;
    const complaint = await getComplaintById(id, village_id);
    
    if (!complaint) {
      return res.status(404).json({ error: 'Complaint not found' });
    }
    
    return res.json({ data: complaint });
  } catch (error: any) {
    logger.error('Get complaint error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /laporan/:id/check
 * Get complaint by ID with ownership validation (for user via AI)
 */
export async function handleCheckComplaintStatus(req: Request, res: Response) {
  try {
    const id = getParam(req, 'id');
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    const { wa_user_id } = req.body;
    const channel = resolveChannelFromRequest(req);
    const channelIdentifier = resolveChannelIdentifier(req, channel) || req.body?.channel_identifier;
    
    if (channel === 'WHATSAPP' && !wa_user_id) {
      return res.status(400).json({ error: 'wa_user_id is required' });
    }

    if (channel === 'WEBCHAT' && !channelIdentifier) {
      return res.status(400).json({ error: 'session_id/channel_identifier is required' });
    }
    
    const { getComplaintByIdWithOwnership } = await import('../services/complaint.service');
    const result = await getComplaintByIdWithOwnership(id, {
      wa_user_id,
      channel,
      channel_identifier: channelIdentifier || undefined,
    });
    
    if (!result.success) {
      const statusCode = result.error === 'NOT_FOUND' ? 404 : 403;
      return res.status(statusCode).json({
        status: 'error',
        error: result.error,
        message: result.message,
      });
    }
    
    return res.json({ data: result.data });
  } catch (error: any) {
    logger.error('Check complaint status error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PATCH /laporan/:id/status
 * Update complaint status (from Dashboard - validates village_id for multi-tenancy)
 */
export async function handleUpdateComplaintStatus(req: Request, res: Response) {
  try {
    const id = getParam(req, 'id');
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    
    // Validate village_id for multi-tenancy security (MANDATORY)
    const village_id = getQuery(req, 'village_id') || (req.headers['x-village-id'] as string) || undefined;
    if (!village_id) {
      return res.status(400).json({ error: 'village_id is required for multi-tenancy isolation' });
    }
    const existing = await getComplaintById(id);
    if (!existing || existing.village_id !== village_id) {
      return res.status(404).json({ error: 'Complaint not found' });
    }
    
    const { status, admin_notes } = req.body;
    const normalizedStatus = (status || '').toString().toUpperCase();

    if (['DONE', 'CANCELED', 'REJECT'].includes(normalizedStatus) && (!admin_notes || String(admin_notes).trim() === '')) {
      return res.status(400).json({ error: 'admin_notes wajib diisi untuk status DONE/CANCELED/REJECT' });
    }
    
    const complaint = await updateComplaintStatus(id, { status, admin_notes });
    
    return res.json({
      status: 'success',
      data: complaint,
    });
  } catch (error: any) {
    if (typeof error.message === 'string' && error.message.startsWith('Transisi status tidak valid:')) {
      return res.status(400).json({ error: error.message });
    }
    logger.error('Update status error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /laporan/statistics
 * Get complaint statistics
 */
export async function handleGetComplaintStatistics(req: Request, res: Response) {
  try {
    const village_id = getQuery(req, 'village_id') || undefined;
    const stats = await getComplaintStatistics(village_id);
    return res.json({ data: stats });
  } catch (error: any) {
    logger.error('Get statistics error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /laporan/:id/cancel
 * Cancel complaint by user (owner validation)
 */
export async function handleCancelComplaint(req: Request, res: Response) {
  try {
    const id = getParam(req, 'id');
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    const { wa_user_id, cancel_reason } = req.body;
    const channel = resolveChannelFromRequest(req);
    const channelIdentifier = resolveChannelIdentifier(req, channel) || req.body?.channel_identifier;
    const normalizedCancelReason = typeof cancel_reason === 'string' && cancel_reason.trim()
      ? cancel_reason.trim()
      : undefined;
    
    if (channel === 'WHATSAPP' && !wa_user_id) {
      return res.status(400).json({ error: 'wa_user_id is required' });
    }

    if (channel === 'WEBCHAT' && !channelIdentifier) {
      return res.status(400).json({ error: 'session_id/channel_identifier is required' });
    }
    
    const result = await cancelComplaint(id, {
      wa_user_id,
      cancel_reason: normalizedCancelReason,
      channel,
      channel_identifier: channelIdentifier,
    });
    
    if (!result.success) {
      const statusCode = result.error === 'NOT_FOUND' ? 404 
        : result.error === 'NOT_OWNER' ? 403 
        : result.error === 'ALREADY_COMPLETED' ? 400 
        : 500;
      
      return res.status(statusCode).json({
        status: 'error',
        error: result.error,
        message: result.message,
      });
    }
    
    return res.json({
      status: 'success',
      data: {
        complaint_id: result.complaint_id,
        message: result.message,
      },
    });
  } catch (error: any) {
    logger.error('Cancel complaint error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PATCH /laporan/:id/update
 * Update complaint fields by user (owner validation)
 */
export async function handleUpdateComplaintByUser(req: Request, res: Response) {
  try {
    const id = getParam(req, 'id');
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    const { wa_user_id, alamat, deskripsi, rt_rw } = req.body;
    const channel = resolveChannelFromRequest(req);
    const channelIdentifier = resolveChannelIdentifier(req, channel) || req.body?.channel_identifier;

    const result = await updateComplaintByUser(id, { wa_user_id, alamat, deskripsi, rt_rw, channel, channel_identifier: channelIdentifier });

    if (!result.success) {
      if (result.error === 'NOT_FOUND') return res.status(404).json({ error: result.message });
      if (result.error === 'NOT_OWNER') return res.status(403).json({ error: result.message });
      if (result.error === 'LOCKED') return res.status(400).json({ error: result.message });
      return res.status(400).json({ error: result.message || 'Gagal memperbarui laporan' });
    }

    return res.json({ data: result.data });
  } catch (error: any) {
    logger.error('Update complaint by user error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PATCH /laporan/:id/soft-delete
 * Soft delete a complaint (set deleted_at)
 */
export async function handleSoftDeleteComplaint(req: Request, res: Response) {
  try {
    const id = getParam(req, 'id');
    if (!id) return res.status(400).json({ error: 'id is required' });

    const village_id = getQuery(req, 'village_id') || (req.headers['x-village-id'] as string) || undefined;
    if (!village_id) return res.status(400).json({ error: 'village_id is required' });

    const complaint = await prisma.complaint.findFirst({
      where: { OR: [{ id }, { complaint_id: id }] },
    });
    if (!complaint || complaint.village_id !== village_id) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    const archivedAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.complaint.update({
        where: { id: complaint.id },
        data: { deleted_at: archivedAt },
      });

      await enqueueOutboxEvent(tx, {
        routingKey: RABBITMQ_CONFIG.ROUTING_KEYS.COMPLAINT_ARCHIVED,
        payload: {
          type: 'complaint_archived',
          village_id: complaint.village_id,
          complaint_id: complaint.complaint_id,
          id: complaint.id,
          archived_at: archivedAt.toISOString(),
        },
        entityType: 'complaint',
        entityId: complaint.complaint_id,
      });
    });

    invalidateStatsCache();
    const audit = getAuditMetadata(req);
    recordAuditLog({
      village_id: complaint.village_id,
      admin_id: audit.admin_id,
      admin_role: audit.admin_role,
      admin_name: audit.admin_name,
      reason: audit.reason,
      action: 'archive',
      entity_type: 'complaint',
      entity_id: complaint.id,
      entity_label: complaint.complaint_id,
      metadata: { complaint_id: complaint.complaint_id, archived_at: archivedAt.toISOString() },
    }).catch((error: any) => logger.warn('Failed to record complaint archive audit log', { error: error.message, id: complaint.id }));

    return res.json({ success: true });
  } catch (error: any) {
    logger.error('Soft delete complaint error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PATCH /laporan/:id/restore
 * Restore a soft-deleted complaint
 */
export async function handleRestoreComplaint(req: Request, res: Response) {
  try {
    const id = getParam(req, 'id');
    if (!id) return res.status(400).json({ error: 'id is required' });

    const village_id = getQuery(req, 'village_id') || (req.headers['x-village-id'] as string) || undefined;
    if (!village_id) return res.status(400).json({ error: 'village_id is required' });

    const complaint = await prisma.complaint.findFirst({
      where: { OR: [{ id }, { complaint_id: id }], deleted_at: { not: null } },
    });
    if (!complaint || complaint.village_id !== village_id) {
      return res.status(404).json({ error: 'Deleted complaint not found' });
    }

    const restoredAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.complaint.update({
        where: { id: complaint.id },
        data: { deleted_at: null },
      });

      await enqueueOutboxEvent(tx, {
        routingKey: RABBITMQ_CONFIG.ROUTING_KEYS.COMPLAINT_RESTORED,
        payload: {
          type: 'complaint_restored',
          village_id: complaint.village_id,
          complaint_id: complaint.complaint_id,
          id: complaint.id,
          restored_at: restoredAt.toISOString(),
        },
        entityType: 'complaint',
        entityId: complaint.complaint_id,
      });
    });

    invalidateStatsCache();
    const audit = getAuditMetadata(req);
    recordAuditLog({
      village_id: complaint.village_id,
      admin_id: audit.admin_id,
      admin_role: audit.admin_role,
      admin_name: audit.admin_name,
      reason: audit.reason,
      action: 'restore',
      entity_type: 'complaint',
      entity_id: complaint.id,
      entity_label: complaint.complaint_id,
      metadata: { complaint_id: complaint.complaint_id, restored_at: restoredAt.toISOString() },
    }).catch((error: any) => logger.warn('Failed to record complaint restore audit log', { error: error.message, id: complaint.id }));

    return res.json({ success: true });
  } catch (error: any) {
    logger.error('Restore complaint error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /laporan/deleted
 * List soft-deleted complaints
 */
export async function handleGetDeletedComplaints(req: Request, res: Response) {
  try {
    const village_id = getQuery(req, 'village_id') || undefined;
    if (!village_id) return res.status(400).json({ error: 'village_id is required' });

    const data = await prisma.complaint.findMany({
      where: { village_id, deleted_at: { not: null } },
      orderBy: { deleted_at: 'desc' },
      include: {
        category: true,
        type: true,
      },
    });

    return res.json({ data });
  } catch (error: any) {
    logger.error('Get deleted complaints error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}
