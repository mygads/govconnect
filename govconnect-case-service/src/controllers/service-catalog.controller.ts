import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import crypto from 'crypto';
import prisma from '../config/database';
import logger from '../utils/logger';
import { generateServiceRequestId } from '../utils/id-generator';
import { publishEvent } from '../services/rabbitmq.service';
import { RABBITMQ_CONFIG } from '../config/rabbitmq';
import { getParam, getQuery } from '../utils/http';
import {
  isValidCitizenWaNumber,
  normalizeCitizenWaForStorage,
  normalizeTo628,
  sameCitizenWa,
} from '../utils/wa-normalizer';

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
  const waUserId = (req.body?.wa_user_id || getQuery(req, 'wa_user_id') || getQuery(req, 'wa')) as string | undefined;
  return waUserId || null;
}

function isSameRequester(request: { channel: 'WHATSAPP' | 'WEBCHAT'; wa_user_id: string | null; channel_identifier: string | null }, params: {
  channel: 'WHATSAPP' | 'WEBCHAT';
  wa_user_id?: string;
  channel_identifier?: string | null;
}): boolean {
  if (params.channel === 'WEBCHAT') {
    return request.channel === 'WEBCHAT' && !!params.channel_identifier && request.channel_identifier === params.channel_identifier;
  }
  return sameCitizenWa(request.wa_user_id || '', params.wa_user_id || '');
}

// ===== Service Categories =====
export async function handleGetServiceCategories(req: Request, res: Response) {
  try {
    const village_id = getQuery(req, 'village_id');
    const data = await prisma.serviceCategory.findMany({
      where: village_id ? { village_id } : undefined,
      orderBy: { created_at: 'asc' }
    });
    return res.json({ data });
  } catch (error: any) {
    logger.error('Get service categories error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleCreateServiceCategory(req: Request, res: Response) {
  try {
    const { village_id, name, description } = req.body;
    if (!village_id || !name) {
      return res.status(400).json({ error: 'village_id and name are required' });
    }
    const category = await prisma.serviceCategory.create({
      data: { village_id, name, description }
    });
    return res.status(201).json({ data: category });
  } catch (error: any) {
    logger.error('Create service category error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ===== Services =====
export async function handleGetServices(req: Request, res: Response) {
  try {
    const village_id = getQuery(req, 'village_id');
    const category_id = getQuery(req, 'category_id');
    const data = await prisma.serviceItem.findMany({
      where: {
        ...(village_id ? { village_id } : {}),
        ...(category_id ? { category_id } : {}),
      },
      include: { requirements: true, category: true },
      orderBy: { created_at: 'asc' }
    });
    return res.json({ data });
  } catch (error: any) {
    logger.error('Get services error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleSearchServices(req: Request, res: Response) {
  try {
    const village_id = getQuery(req, 'village_id');
    const category_id = getQuery(req, 'category_id');
    const rawQuery = getQuery(req, 'q') || getQuery(req, 'query') || '';
    const include_inactive = (getQuery(req, 'include_inactive') || '').toString().toLowerCase() === 'true';

    const query = rawQuery.trim();
    if (!query) {
      return res.status(400).json({ error: 'q is required' });
    }

    const limitRaw = parseInt((getQuery(req, 'limit') || '20').toString(), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 20;

    logger.info('Search services', {
      village_id,
      category_id,
      query,
      include_inactive,
      limit,
    });

    const data = await prisma.serviceItem.findMany({
      where: {
        ...(village_id ? { village_id } : {}),
        ...(category_id ? { category_id } : {}),
        ...(include_inactive ? {} : { is_active: true }),
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { slug: { contains: query, mode: 'insensitive' } },
          { category: { name: { contains: query, mode: 'insensitive' } } },
        ],
      },
      include: { requirements: true, category: true },
      orderBy: { created_at: 'asc' },
      take: limit,
    });

    return res.json({ data });
  } catch (error: any) {
    logger.error('Search services error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleGetServiceById(req: Request, res: Response) {
  try {
    const id = getParam(req, 'id');
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    const service = await prisma.serviceItem.findUnique({
      where: { id },
      include: { requirements: true, category: true }
    });
    if (!service) return res.status(404).json({ error: 'Service not found' });
    return res.json({ data: service });
  } catch (error: any) {
    logger.error('Get service by id error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleCreateService(req: Request, res: Response) {
  try {
    const { village_id, category_id, name, description, slug, mode, is_active } = req.body;
    if (!village_id || !category_id || !name || !description || !slug) {
      return res.status(400).json({ error: 'village_id, category_id, name, description, slug are required' });
    }
    const service = await prisma.serviceItem.create({
      data: {
        village_id,
        category_id,
        name,
        description,
        slug,
        mode: mode || 'both',
        is_active: is_active ?? true,
      }
    });
    return res.status(201).json({ data: service });
  } catch (error: any) {
    logger.error('Create service error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleUpdateService(req: Request, res: Response) {
  try {
    const id = getParam(req, 'id');
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    const { name, description, slug, mode, is_active, category_id } = req.body;
    const service = await prisma.serviceItem.update({
      where: { id },
      data: {
        name: name ?? undefined,
        description: description ?? undefined,
        slug: slug ?? undefined,
        mode: mode ?? undefined,
        is_active: is_active ?? undefined,
        category_id: category_id ?? undefined,
      }
    });
    return res.json({ data: service });
  } catch (error: any) {
    logger.error('Update service error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleGetServiceBySlug(req: Request, res: Response) {
  try {
    const village_id = getQuery(req, 'village_id');
    const slug = getQuery(req, 'slug');
    if (!village_id || !slug) {
      return res.status(400).json({ error: 'village_id and slug are required' });
    }
    const service = await prisma.serviceItem.findFirst({
      where: { village_id, slug },
      include: { requirements: true, category: true }
    });
    if (!service) return res.status(404).json({ error: 'Service not found' });
    return res.json({ data: service });
  } catch (error: any) {
    logger.error('Get service by slug error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ===== Requirements =====
export async function handleGetRequirements(req: Request, res: Response) {
  try {
    const id = getParam(req, 'id');
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    const requirements = await prisma.serviceRequirement.findMany({
      where: { service_id: id },
      orderBy: { order_index: 'asc' }
    });
    return res.json({ data: requirements });
  } catch (error: any) {
    logger.error('Get requirements error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleCreateRequirement(req: Request, res: Response) {
  try {
    const id = getParam(req, 'id');
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    const { label, field_type, is_required, options_json, help_text, order_index } = req.body;
    if (!label || !field_type) {
      return res.status(400).json({ error: 'label and field_type are required' });
    }
    const requirement = await prisma.serviceRequirement.create({
      data: {
        service_id: id,
        label,
        field_type,
        is_required: is_required ?? true,
        options_json: options_json ?? undefined,
        help_text: help_text ?? undefined,
        order_index: order_index ?? 0,
      }
    });
    return res.status(201).json({ data: requirement });
  } catch (error: any) {
    logger.error('Create requirement error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleUpdateRequirement(req: Request, res: Response) {
  try {
    const id = getParam(req, 'id');
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    const { label, field_type, is_required, options_json, help_text, order_index } = req.body;
    const requirement = await prisma.serviceRequirement.update({
      where: { id },
      data: {
        label: label ?? undefined,
        field_type: field_type ?? undefined,
        is_required: is_required ?? undefined,
        options_json: options_json ?? undefined,
        help_text: help_text ?? undefined,
        order_index: order_index ?? undefined,
      }
    });
    return res.json({ data: requirement });
  } catch (error: any) {
    logger.error('Update requirement error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleDeleteRequirement(req: Request, res: Response) {
  try {
    const id = getParam(req, 'id');
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    await prisma.serviceRequirement.delete({ where: { id } });
    return res.json({ status: 'success' });
  } catch (error: any) {
    logger.error('Delete requirement error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ===== Service Requests =====
export async function handleGetServiceRequests(req: Request, res: Response) {
  try {
    const wa_user_id_raw = getQuery(req, 'wa_user_id');
    const wa_user_id = wa_user_id_raw ? normalizeTo628(wa_user_id_raw) : null;
    const channel = resolveChannelFromRequest(req);
    const channel_identifier = resolveChannelIdentifier(req, channel) || getQuery(req, 'channel_identifier');
    const service_id = getQuery(req, 'service_id');
    const status = getQuery(req, 'status');
    const request_number = getQuery(req, 'request_number');
    const village_id = getQuery(req, 'village_id');
    const data = await prisma.serviceRequest.findMany({
      where: {
        ...(channel_identifier ? { channel, channel_identifier } : {}),
        ...(wa_user_id ? { wa_user_id } : {}),
        ...(service_id ? { service_id } : {}),
        ...(status ? { status } : {}),
        ...(request_number ? { request_number } : {}),
        ...(village_id ? { service: { village_id } } : {}),
        deleted_at: null, // Exclude soft-deleted
      },
      include: { service: true },
      orderBy: { created_at: 'desc' }
    });
    return res.json({ data });
  } catch (error: any) {
    logger.error('Get service requests error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleCreateServiceRequest(req: Request, res: Response) {
  try {
    const { service_id, wa_user_id, citizen_data_json, requirement_data_json } = req.body;
    const channel = resolveChannelFromRequest(req);
    const channelIdentifier = resolveChannelIdentifier(req, channel) || req.body?.channel_identifier;

    if (!service_id) {
      return res.status(400).json({ error: 'service_id is required' });
    }

    let normalizedWaUserId: string | null = null;
    if (channel === 'WHATSAPP') {
      if (!wa_user_id) {
        return res.status(400).json({ error: 'wa_user_id diperlukan untuk channel WHATSAPP' });
      }
      normalizedWaUserId = normalizeCitizenWaForStorage(String(wa_user_id));
      if (!isValidCitizenWaNumber(normalizedWaUserId)) {
        return res.status(400).json({ error: 'wa_user_id tidak valid. Gunakan format 628xxxxxxxxxx' });
      }
    } else {
      if (!channelIdentifier) {
        return res.status(400).json({ error: 'session_id/channel_identifier diperlukan untuk channel WEBCHAT' });
      }
    }

    const requestNumber = await generateServiceRequestId();

    const created = await prisma.serviceRequest.create({
      data: {
        request_number: requestNumber,
        service_id,
        wa_user_id: normalizedWaUserId,
        channel,
        channel_identifier: channel === 'WEBCHAT' ? String(channelIdentifier) : normalizedWaUserId,
        citizen_data_json: citizen_data_json || {},
        requirement_data_json: requirement_data_json || {},
      },
      include: { service: true },
    });

    publishEvent(RABBITMQ_CONFIG.ROUTING_KEYS.SERVICE_REQUESTED, {
      village_id: created.service?.village_id,
      wa_user_id: normalizedWaUserId,
      channel: channel.toLowerCase(),
      channel_identifier: channel === 'WEBCHAT' ? String(channelIdentifier) : normalizedWaUserId,
      request_number: created.request_number,
      service_id,
      service_name: created.service?.name || null,
    }).catch((error) => {
      logger.warn('Failed to publish service.requested event', { error: error.message });
    });

    return res.status(201).json({ data: created });
  } catch (error: any) {
    logger.error('Create service request error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleGetServiceRequestById(req: Request, res: Response) {
  try {
    const id = getParam(req, 'id');
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    const data = await prisma.serviceRequest.findUnique({
      where: { id },
      include: { 
        service: {
          include: {
            requirements: {
              orderBy: { order_index: 'asc' }
            }
          }
        }
      },
    });
    if (!data) return res.status(404).json({ error: 'Request not found' });
    return res.json({ data });
  } catch (error: any) {
    logger.error('Get service request by id error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleUpdateServiceRequestStatus(req: Request, res: Response) {
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
    const existingRequest = await prisma.serviceRequest.findFirst({
      where: { OR: [{ id }, { request_number: id }] },
      include: { service: true },
    });
    if (!existingRequest || existingRequest.service?.village_id !== village_id) {
      return res.status(404).json({ error: 'Service request not found' });
    }
    
    const { status, admin_notes, result_file_url, result_file_name, result_description } = req.body;
    const normalizedStatus = (status || '').toString().toUpperCase();

    if (normalizedStatus && !['OPEN', 'PROCESS', 'DONE', 'CANCELED', 'REJECT'].includes(normalizedStatus)) {
      return res.status(400).json({ error: 'status tidak valid' });
    }

    if (['DONE', 'CANCELED', 'REJECT'].includes(normalizedStatus) && (!admin_notes || String(admin_notes).trim() === '')) {
      return res.status(400).json({ error: 'admin_notes wajib diisi untuk status DONE/CANCELED/REJECT' });
    }

    const data = await prisma.serviceRequest.update({
      where: { id },
      data: {
        status: normalizedStatus || undefined,
        admin_notes: admin_notes ?? undefined,
        result_file_url: result_file_url ?? undefined,
        result_file_name: result_file_name ?? undefined,
        result_description: result_description ?? undefined,
      },
      include: { service: true },
    });

    // Publish status update event for notification service
    if (normalizedStatus) {
      publishEvent(RABBITMQ_CONFIG.ROUTING_KEYS.STATUS_UPDATED, {
        village_id: data.service?.village_id,
        wa_user_id: data.wa_user_id,
        channel: data.channel || 'WHATSAPP',
        channel_identifier: data.channel_identifier || data.wa_user_id,
        request_number: data.request_number,
        status: normalizedStatus,
        admin_notes: admin_notes ?? undefined,
        result_file_url: data.result_file_url ?? undefined,
        result_file_name: data.result_file_name ?? undefined,
      }).catch((err: any) => {
        logger.warn('Failed to publish status.updated event', { error: err.message });
      });
    }

    return res.json({ data });
  } catch (error: any) {
    logger.error('Update service request status error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleGenerateServiceRequestEditToken(req: Request, res: Response) {
  try {
    const id = getParam(req, 'id');
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    const channel = resolveChannelFromRequest(req);
    const { wa_user_id } = req.body as { wa_user_id?: string };
    const channelIdentifier = resolveChannelIdentifier(req, channel) || req.body?.channel_identifier;

    if (channel === 'WHATSAPP' && !wa_user_id) {
      return res.status(400).json({ error: 'wa_user_id is required' });
    }

    if (channel === 'WEBCHAT' && !channelIdentifier) {
      return res.status(400).json({ error: 'session_id/channel_identifier is required' });
    }

    const request = await prisma.serviceRequest.findFirst({
      where: {
        OR: [{ id }, { request_number: id }],
      },
      include: { service: true },
    });

    if (!request) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Permohonan layanan tidak ditemukan' });
    }

    if (!isSameRequester(request, { channel, wa_user_id, channel_identifier: channelIdentifier })) {
      return res.status(403).json({ error: 'NOT_OWNER', message: 'Anda tidak memiliki akses untuk mengubah layanan ini' });
    }

    if (!['OPEN', 'PROCESS'].includes(request.status)) {
      return res.status(400).json({ error: 'LOCKED', message: 'Permohonan sudah selesai/dibatalkan/ditolak sehingga tidak bisa diubah' });
    }

    const editToken = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    const updated = await prisma.serviceRequest.update({
      where: { id: request.id },
      data: {
        edit_token: editToken,
        edit_token_expires_at: expiresAt,
        edit_token_used_at: null,
      },
    });

    return res.json({
      data: {
        request_number: updated.request_number,
        edit_token: editToken,
        edit_token_expires_at: expiresAt,
      },
    });
  } catch (error: any) {
    logger.error('Generate edit token error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleGetServiceRequestByToken(req: Request, res: Response) {
  try {
    const token = getQuery(req, 'token');
    if (!token) {
      return res.status(400).json({ error: 'token is required' });
    }

    const channel = resolveChannelFromRequest(req);
    const channelIdentifier = resolveChannelIdentifier(req, channel);
    const wa_user_id = channel === 'WHATSAPP' ? normalizeTo628(String(channelIdentifier || '')) : undefined;

    if (!channelIdentifier) {
      return res.status(400).json({ error: 'IDENTITY_REQUIRED', message: 'wa atau session_id wajib diisi' });
    }

    const request = await prisma.serviceRequest.findFirst({
      where: {
        edit_token: token,
        edit_token_expires_at: { gt: new Date() },
        edit_token_used_at: null,
      },
      include: {
        service: {
          include: {
            requirements: true,
            category: true,
          },
        },
      },
    });

    if (!request) {
      return res.status(404).json({ error: 'TOKEN_INVALID', message: 'Token edit tidak valid atau sudah kedaluwarsa' });
    }

    if (!isSameRequester(request, { channel, wa_user_id, channel_identifier: channelIdentifier })) {
      return res.status(403).json({ error: 'NOT_OWNER', message: 'Anda tidak memiliki akses untuk mengubah layanan ini' });
    }

    if (!['OPEN', 'PROCESS'].includes(request.status)) {
      return res.status(400).json({ error: 'LOCKED', message: 'Permohonan sudah selesai/dibatalkan/ditolak sehingga tidak bisa diubah' });
    }

    return res.json({ data: request });
  } catch (error: any) {
    logger.error('Get service request by token error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleUpdateServiceRequestByToken(req: Request, res: Response) {
  try {
    const id = getParam(req, 'id');
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    const { edit_token, citizen_data_json, requirement_data_json } = req.body as {
      edit_token?: string;
      citizen_data_json?: Record<string, any>;
      requirement_data_json?: Record<string, any>;
    };

    if (!edit_token) {
      return res.status(400).json({ error: 'edit_token is required' });
    }

    const channel = resolveChannelFromRequest(req);
    const channelIdentifier = resolveChannelIdentifier(req, channel);
    const wa_user_id = channel === 'WHATSAPP' ? normalizeTo628(String(channelIdentifier || '')) : undefined;

    if (!channelIdentifier) {
      return res.status(400).json({ error: 'IDENTITY_REQUIRED', message: 'wa atau session_id wajib diisi' });
    }

    const request = await prisma.serviceRequest.findFirst({
      where: {
        OR: [{ id }, { request_number: id }],
        edit_token,
        edit_token_expires_at: { gt: new Date() },
        edit_token_used_at: null,
      },
      include: { service: true },
    });

    if (!request) {
      return res.status(404).json({ error: 'TOKEN_INVALID', message: 'Token edit tidak valid atau sudah kedaluwarsa' });
    }

    if (!isSameRequester(request, { channel, wa_user_id, channel_identifier: channelIdentifier })) {
      return res.status(403).json({ error: 'NOT_OWNER', message: 'Anda tidak memiliki akses untuk mengubah layanan ini' });
    }

    if (!['OPEN', 'PROCESS'].includes(request.status)) {
      return res.status(400).json({ error: 'LOCKED', message: 'Permohonan sudah selesai/dibatalkan/ditolak sehingga tidak bisa diubah' });
    }

    const updated = await prisma.serviceRequest.update({
      where: { id: request.id },
      data: {
        citizen_data_json: (citizen_data_json === null || typeof citizen_data_json === 'undefined'
          ? request.citizen_data_json
          : citizen_data_json) as Prisma.InputJsonValue,
        requirement_data_json: (requirement_data_json === null || typeof requirement_data_json === 'undefined'
          ? request.requirement_data_json
          : requirement_data_json) as Prisma.InputJsonValue,
        edit_token: null,
        edit_token_expires_at: null,
        edit_token_used_at: new Date(),
      },
    });

    return res.json({ data: updated, message: 'Permohonan berhasil diperbarui' });
  } catch (error: any) {
    logger.error('Update service request by token error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleCancelServiceRequest(req: Request, res: Response) {
  try {
    const id = getParam(req, 'id');
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    const channel = resolveChannelFromRequest(req);
    const { wa_user_id, cancel_reason } = req.body as { wa_user_id?: string; cancel_reason?: string };
    const channelIdentifier = resolveChannelIdentifier(req, channel) || req.body?.channel_identifier;

    if (!cancel_reason || String(cancel_reason).trim() === '') {
      return res.status(400).json({ error: 'cancel_reason wajib diisi' });
    }

    if (channel === 'WHATSAPP' && !wa_user_id) {
      return res.status(400).json({ error: 'wa_user_id is required' });
    }

    if (channel === 'WEBCHAT' && !channelIdentifier) {
      return res.status(400).json({ error: 'session_id/channel_identifier is required' });
    }

    const existing = await prisma.serviceRequest.findFirst({
      where: {
        OR: [{ id }, { request_number: id }],
      },
      include: { service: true },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Request not found' });
    }

    if (!isSameRequester(existing, { channel, wa_user_id, channel_identifier: channelIdentifier })) {
      return res.status(403).json({ error: 'NOT_OWNER', message: 'Anda tidak memiliki akses untuk membatalkan layanan ini' });
    }

    if (!['OPEN', 'PROCESS'].includes(existing.status)) {
      return res.status(400).json({ error: 'LOCKED', message: 'Permohonan sudah selesai/dibatalkan/ditolak sehingga tidak bisa dibatalkan' });
    }

    const cancelNote = `Dibatalkan oleh masyarakat: ${String(cancel_reason).trim()}`;
    const updated = await prisma.serviceRequest.update({
      where: { id: existing.id },
      data: {
        status: 'CANCELED',
        admin_notes: cancelNote,
      },
    });

    // Publish status update event so citizen gets WhatsApp confirmation
    publishEvent(RABBITMQ_CONFIG.ROUTING_KEYS.STATUS_UPDATED, {
      village_id: existing.service?.village_id,
      wa_user_id: existing.wa_user_id,
      channel: (existing.channel || 'WHATSAPP').toLowerCase(),
      channel_identifier: existing.channel_identifier || existing.wa_user_id,
      request_number: existing.request_number,
      status: 'CANCELED',
      admin_notes: cancelNote,
    }).catch((err: any) => {
      logger.warn('Failed to publish status.updated event for cancel', { error: err.message });
    });

    return res.json({ data: updated });
  } catch (error: any) {
    logger.error('Cancel service request error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleDeleteServiceRequest(req: Request, res: Response) {
  try {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED', message: 'Hapus layanan tidak diizinkan. Gunakan pembatalan (cancel).' });
  } catch (error: any) {
    logger.error('Delete service request error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleGetServiceHistory(req: Request, res: Response) {
  try {
    const wa_user_id_raw = getParam(req, 'wa_user_id');
    const channel = resolveChannelFromRequest(req);
    const channelIdentifier = resolveChannelIdentifier(req, channel) || getQuery(req, 'channel_identifier');

    if (channel === 'WHATSAPP' && !wa_user_id_raw) {
      return res.status(400).json({ error: 'wa_user_id is required' });
    }

    if (channel === 'WEBCHAT' && !channelIdentifier) {
      return res.status(400).json({ error: 'session_id/channel_identifier is required' });
    }

    // Validate village_id for multi-tenancy security (MANDATORY)
    const village_id = getQuery(req, 'village_id') || (req.headers['x-village-id'] as string) || undefined;
    if (!village_id) {
      return res.status(400).json({ error: 'village_id is required for multi-tenancy isolation' });
    }

    const wa_user_id = wa_user_id_raw ? normalizeTo628(wa_user_id_raw) : null;
    const data = await prisma.serviceRequest.findMany({
      where: {
        ...(wa_user_id ? { wa_user_id } : {}),
        ...(channelIdentifier ? { channel, channel_identifier: String(channelIdentifier) } : {}),
        service: { village_id },
      },
      include: { service: true },
      orderBy: { created_at: 'desc' }
    });
    return res.json({ data });
  } catch (error: any) {
    logger.error('Get service history error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PATCH /service-requests/:id/soft-delete
 * Soft delete a service request
 */
export async function handleSoftDeleteServiceRequest(req: Request, res: Response) {
  try {
    const id = getParam(req, 'id');
    if (!id) return res.status(400).json({ error: 'id is required' });

    const village_id = getQuery(req, 'village_id') || (req.headers['x-village-id'] as string) || undefined;
    if (!village_id) return res.status(400).json({ error: 'village_id is required' });

    const sr = await prisma.serviceRequest.findFirst({
      where: { OR: [{ id }, { request_number: id }] },
      include: { service: true },
    });
    if (!sr || sr.service?.village_id !== village_id) {
      return res.status(404).json({ error: 'Service request not found' });
    }

    await prisma.serviceRequest.update({
      where: { id: sr.id },
      data: { deleted_at: new Date() },
    });

    return res.json({ success: true });
  } catch (error: any) {
    logger.error('Soft delete service request error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PATCH /service-requests/:id/restore
 * Restore a soft-deleted service request
 */
export async function handleRestoreServiceRequest(req: Request, res: Response) {
  try {
    const id = getParam(req, 'id');
    if (!id) return res.status(400).json({ error: 'id is required' });

    const village_id = getQuery(req, 'village_id') || (req.headers['x-village-id'] as string) || undefined;
    if (!village_id) return res.status(400).json({ error: 'village_id is required' });

    const sr = await prisma.serviceRequest.findFirst({
      where: { OR: [{ id }, { request_number: id }], deleted_at: { not: null } },
      include: { service: true },
    });
    if (!sr || sr.service?.village_id !== village_id) {
      return res.status(404).json({ error: 'Deleted service request not found' });
    }

    await prisma.serviceRequest.update({
      where: { id: sr.id },
      data: { deleted_at: null },
    });

    return res.json({ success: true });
  } catch (error: any) {
    logger.error('Restore service request error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /service-requests/deleted
 * List soft-deleted service requests
 */
export async function handleGetDeletedServiceRequests(req: Request, res: Response) {
  try {
    const village_id = getQuery(req, 'village_id') || undefined;
    if (!village_id) return res.status(400).json({ error: 'village_id is required' });

    const data = await prisma.serviceRequest.findMany({
      where: {
        deleted_at: { not: null },
        service: { village_id },
      },
      include: { service: true },
      orderBy: { deleted_at: 'desc' },
    });

    return res.json({ data });
  } catch (error: any) {
    logger.error('Get deleted service requests error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}
