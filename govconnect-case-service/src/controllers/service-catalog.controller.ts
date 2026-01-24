import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import crypto from 'crypto';
import prisma from '../config/database';
import logger from '../utils/logger';
import { generateServiceRequestId } from '../utils/id-generator';
import { publishEvent } from '../services/rabbitmq.service';
import { RABBITMQ_CONFIG } from '../config/rabbitmq';
import { getQueryString } from '../utils/http';

// ===== Service Categories =====
export async function handleGetServiceCategories(req: Request, res: Response) {
  try {
    const village_id = getQueryString(req.query.village_id);
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
    const village_id = getQueryString(req.query.village_id);
    const category_id = getQueryString(req.query.category_id);
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

export async function handleGetServiceById(req: Request, res: Response) {
  try {
    const { id } = req.params;
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
    const { id } = req.params;
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
    const village_id = getQueryString(req.query.village_id);
    const slug = getQueryString(req.query.slug);
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
    const { id } = req.params;
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
    const { id } = req.params;
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
    const { id } = req.params;
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
    const { id } = req.params;
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
    const wa_user_id = getQueryString(req.query.wa_user_id);
    const service_id = getQueryString(req.query.service_id);
    const status = getQueryString(req.query.status);
    const request_number = getQueryString(req.query.request_number);
    const village_id = getQueryString(req.query.village_id);
    const data = await prisma.serviceRequest.findMany({
      where: {
        ...(wa_user_id ? { wa_user_id } : {}),
        ...(service_id ? { service_id } : {}),
        ...(status ? { status } : {}),
        ...(request_number ? { request_number } : {}),
        ...(village_id ? { service: { village_id } } : {}),
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
    if (!service_id || !wa_user_id) {
      return res.status(400).json({ error: 'service_id and wa_user_id are required' });
    }

    const requestNumber = await generateServiceRequestId();

    const created = await prisma.serviceRequest.create({
      data: {
        request_number: requestNumber,
        service_id,
        wa_user_id,
        citizen_data_json: citizen_data_json || {},
        requirement_data_json: requirement_data_json || {},
      }
    });

    publishEvent(RABBITMQ_CONFIG.ROUTING_KEYS.SERVICE_REQUESTED, {
      wa_user_id,
      request_number: created.request_number,
      service_id,
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
    const { id } = req.params;
    const data = await prisma.serviceRequest.findUnique({
      where: { id },
      include: { service: true },
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
    const { id } = req.params;
    const { status, admin_notes } = req.body;
    const data = await prisma.serviceRequest.update({
      where: { id },
      data: {
        status: status ?? undefined,
        admin_notes: admin_notes ?? undefined,
      }
    });
    return res.json({ data });
  } catch (error: any) {
    logger.error('Update service request status error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleGenerateServiceRequestEditToken(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { wa_user_id } = req.body as { wa_user_id?: string };

    if (!wa_user_id) {
      return res.status(400).json({ error: 'wa_user_id is required' });
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

    if (request.wa_user_id !== wa_user_id) {
      return res.status(403).json({ error: 'NOT_OWNER', message: 'Anda tidak memiliki akses untuk mengubah layanan ini' });
    }

    if (['selesai', 'ditolak', 'dibatalkan'].includes(request.status)) {
      return res.status(400).json({ error: 'LOCKED', message: 'Permohonan sudah selesai/ditolak/dibatalkan' });
    }

    const editToken = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

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
    const token = getQueryString(req.query.token);
    if (!token) {
      return res.status(400).json({ error: 'token is required' });
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

    return res.json({ data: request });
  } catch (error: any) {
    logger.error('Get service request by token error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleUpdateServiceRequestByToken(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { edit_token, citizen_data_json, requirement_data_json } = req.body as {
      edit_token?: string;
      citizen_data_json?: Record<string, any>;
      requirement_data_json?: Record<string, any>;
    };

    if (!edit_token) {
      return res.status(400).json({ error: 'edit_token is required' });
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

    if (['selesai', 'ditolak', 'dibatalkan'].includes(request.status)) {
      return res.status(400).json({ error: 'LOCKED', message: 'Permohonan sudah selesai/ditolak/dibatalkan' });
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
    const { id } = req.params;
    const { wa_user_id, cancel_reason } = req.body as { wa_user_id?: string; cancel_reason?: string };

    if (!wa_user_id) {
      return res.status(400).json({ error: 'wa_user_id is required' });
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

    if (existing.wa_user_id !== wa_user_id) {
      return res.status(403).json({ error: 'NOT_OWNER', message: 'Anda tidak memiliki akses untuk membatalkan layanan ini' });
    }

    if (['selesai', 'ditolak', 'dibatalkan'].includes(existing.status)) {
      return res.status(400).json({ error: 'LOCKED', message: 'Permohonan sudah selesai/ditolak/dibatalkan' });
    }

    const updated = await prisma.serviceRequest.update({
      where: { id: existing.id },
      data: {
        status: 'dibatalkan',
        admin_notes: cancel_reason ?? existing.admin_notes ?? undefined,
      },
    });

    return res.json({ data: updated });
  } catch (error: any) {
    logger.error('Cancel service request error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleDeleteServiceRequest(req: Request, res: Response) {
  try {
    const { id } = req.params;
    await prisma.serviceRequest.delete({ where: { id } });
    return res.json({ status: 'success' });
  } catch (error: any) {
    logger.error('Delete service request error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleGetServiceHistory(req: Request, res: Response) {
  try {
    const { wa_user_id } = req.params;
    const data = await prisma.serviceRequest.findMany({
      where: { wa_user_id },
      include: { service: true },
      orderBy: { created_at: 'desc' }
    });
    return res.json({ data });
  } catch (error: any) {
    logger.error('Get service history error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}
