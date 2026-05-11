import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import crypto from 'crypto';
import prisma from '../config/database';
import logger from '../utils/logger';
import { generateServiceRequestId } from '../utils/id-generator';
import { enqueueOutboxEvent } from '../services/outbox.service';
import { RABBITMQ_CONFIG } from '../config/rabbitmq';
import { getParam, getQuery } from '../utils/http';
import { invalidateStatsCache } from '../services/query-batcher.service';
import { recordAuditLog } from '../services/audit-log.service';
import {
  buildServiceRequestSchema,
  getCitizenFieldCatalog,
  normalizeCitizenFieldDefinitions,
  normalizeServiceMode,
  serializeServiceMode,
  validateServiceRequestPayload,
} from '../services/service-request-schema.service';

function getAuditMetadata(req: Request) {
  return {
    admin_id: (req.headers['x-admin-id'] as string) || null,
    admin_role: (req.headers['x-admin-role'] as string) || null,
    admin_name: (req.headers['x-admin-name'] as string) || null,
    reason: (req.body?.reason || req.body?.admin_notes || req.body?.note) as string | undefined,
  };
}
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

async function findServiceRequestByIdempotency(params: {
  service_id: string;
  channel: 'WHATSAPP' | 'WEBCHAT';
  channel_identifier: string;
  idempotency_key: string;
}) {
  return prisma.serviceRequest.findFirst({
    where: {
      service_id: params.service_id,
      channel: params.channel,
      channel_identifier: params.channel_identifier,
      idempotency_key: params.idempotency_key,
      deleted_at: null,
    },
    include: { service: true },
  });
}

const VALID_SERVICE_REQUEST_STATUS_TRANSITIONS: Record<string, string[]> = {
  OPEN: ['PROCESS', 'DONE', 'CANCELED', 'REJECT'],
  PROCESS: ['DONE', 'CANCELED', 'REJECT'],
  DONE: [],
  CANCELED: [],
  REJECT: [],
};

function isValidServiceRequestStatusTransition(currentStatus: string, nextStatus: string): boolean {
  const allowed = VALID_SERVICE_REQUEST_STATUS_TRANSITIONS[currentStatus];
  if (!allowed) return true;
  return allowed.includes(nextStatus);
}

function normalizeServiceCategoryName(name: unknown): string {
  return typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
}

function buildServiceCategoryNameKey(name: string): string {
  return normalizeServiceCategoryName(name).toLocaleLowerCase('id-ID');
}

function isServiceCategoryDuplicateError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }

  const targets = Array.isArray(error.meta?.target) ? error.meta.target.map(String) : [];
  return targets.includes('village_id') && targets.includes('name_key');
}

function getHeaderVillageId(req: Request): string | undefined {
  return (req.headers['x-village-id'] as string) || undefined;
}

function getHeaderAdminRole(req: Request): string | undefined {
  return (req.headers['x-admin-role'] as string) || undefined;
}

function requireVillageScopeForScopedAdmin(req: Request, res: Response): string | undefined | null {
  const villageId = getHeaderVillageId(req);
  const adminRole = getHeaderAdminRole(req);

  if (adminRole && adminRole !== 'superadmin' && !villageId) {
    res.status(400).json({ error: 'x-village-id is required for village-scoped admin requests' });
    return null;
  }

  if (!adminRole) {
    res.status(400).json({ error: 'x-admin-role is required for admin service catalog requests' });
    return null;
  }

  return villageId;
}

function resolveAdminCollectionVillageScope(req: Request, res: Response): string | undefined | null {
  const scopedVillageId = requireVillageScopeForScopedAdmin(req, res);
  if (scopedVillageId === null) return null;

  const queryVillageId = getQuery(req, 'village_id') || undefined;
  const adminRole = getHeaderAdminRole(req);
  const scope = (getQuery(req, 'scope') || '').toString().trim().toLowerCase();

  if (scopedVillageId) {
    if (queryVillageId && queryVillageId !== scopedVillageId) {
      res.status(403).json({ error: 'Forbidden' });
      return null;
    }
    return scopedVillageId;
  }

  if (adminRole === 'superadmin') {
    if (queryVillageId) return queryVillageId;
    if (scope === 'all') return undefined;
    res.status(400).json({ error: 'Superadmin must provide village_id or scope=all' });
    return null;
  }

  res.status(400).json({ error: 'x-admin-role is required for admin service catalog requests' });
  return null;
}

async function findServiceForVillage(id: string, villageId?: string) {
  return prisma.serviceItem.findFirst({
    where: {
      id,
      ...(villageId ? { village_id: villageId } : {}),
    },
  });
}

async function findRequirementForVillage(id: string, villageId?: string) {
  return prisma.serviceRequirement.findFirst({
    where: {
      id,
      ...(villageId ? { service: { village_id: villageId } } : {}),
    },
    include: { service: true },
  });
}

async function findCategoryForVillage(id: string, villageId?: string) {
  return prisma.serviceCategory.findFirst({
    where: {
      id,
      ...(villageId ? { village_id: villageId } : {}),
    },
  });
}

function normalizeCitizenFieldsInput(value: unknown): Prisma.InputJsonValue {
  return normalizeCitizenFieldDefinitions(value as Prisma.JsonValue | null | undefined) as unknown as Prisma.InputJsonValue;
}

function resolveServiceModeInput(value: unknown, fallback: 'BOTH' | undefined = undefined) {
  if (typeof value === 'undefined' || value === null) return fallback;
  if (typeof value === 'string' && !value.trim()) return fallback;
  return normalizeServiceMode(value);
}

function serializeServiceItem<T extends { mode: unknown }>(service: T): Omit<T, 'mode'> & { mode: 'online' | 'offline' | 'both' } {
  return {
    ...service,
    mode: serializeServiceMode(service.mode),
  };
}

function serializeServiceRequest<T extends { service?: ({ mode: unknown } & Record<string, any>) | null }>(request: T): T {
  if (!request.service) return request;

  return {
    ...request,
    service: serializeServiceItem(request.service),
  };
}

function attachSubmissionSchema<T extends {
  mode: unknown;
  citizen_fields_json?: Prisma.JsonValue | null;
  requirements?: Array<{
    id: string;
    label: string;
    field_type: string;
    is_required: boolean;
    help_text?: string | null;
    options_json?: Prisma.JsonValue | null;
  }>;
}>(service: T) {
  return {
    ...serializeServiceItem(service),
    submission_schema: buildServiceRequestSchema(service),
  };
}

// ===== Service Categories =====
export async function handleGetServiceCategories(req: Request, res: Response) {
  try {
    const village_id = resolveAdminCollectionVillageScope(req, res);
    if (village_id === null) return;

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
    const normalizedName = normalizeServiceCategoryName(name);
    if (!village_id || !normalizedName) {
      return res.status(400).json({ error: 'village_id and name are required' });
    }

    const scopedVillageId = requireVillageScopeForScopedAdmin(req, res);
    if (scopedVillageId === null) return;
    if (scopedVillageId && village_id !== scopedVillageId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const category = await prisma.serviceCategory.create({
      data: {
        village_id,
        name: normalizedName,
        name_key: buildServiceCategoryNameKey(normalizedName),
        description,
      }
    });
    return res.status(201).json({ data: category });
  } catch (error: any) {
    if (isServiceCategoryDuplicateError(error)) {
      return res.status(409).json({ error: 'Nama kategori layanan sudah dipakai di desa ini.' });
    }
    logger.error('Create service category error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleUpdateServiceCategory(req: Request, res: Response) {
  try {
    const id = getParam(req, 'id');
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }

    const headerVillageId = requireVillageScopeForScopedAdmin(req, res);
    if (headerVillageId === null) return;

    const existingCategory = await findCategoryForVillage(id, headerVillageId);
    if (!existingCategory) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const rawName = req.body?.name !== undefined ? normalizeServiceCategoryName(req.body.name) : undefined;
    const description = typeof req.body?.description === 'string'
      ? (req.body.description.trim() || null)
      : req.body?.description;
    const is_active = typeof req.body?.is_active === 'boolean' ? req.body.is_active : undefined;

    if (req.body?.name !== undefined && !rawName) {
      return res.status(400).json({ error: 'name is required' });
    }

    const category = await prisma.serviceCategory.update({
      where: { id },
      data: {
        name: rawName ?? undefined,
        name_key: rawName ? buildServiceCategoryNameKey(rawName) : undefined,
        description: description ?? undefined,
        is_active,
      },
    });

    return res.json({ data: category });
  } catch (error: any) {
    if (isServiceCategoryDuplicateError(error)) {
      return res.status(409).json({ error: 'Nama kategori layanan sudah dipakai di desa ini.' });
    }
    logger.error('Update service category error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleDeleteServiceCategory(req: Request, res: Response) {
  try {
    const id = getParam(req, 'id');
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }

    const headerVillageId = requireVillageScopeForScopedAdmin(req, res);
    if (headerVillageId === null) return;

    const existingCategory = await findCategoryForVillage(id, headerVillageId);
    if (!existingCategory) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const linkedServices = await prisma.serviceItem.count({ where: { category_id: id } });
    if (linkedServices > 0) {
      return res.status(409).json({
        error: 'Kategori masih dipakai oleh layanan. Pindahkan atau hapus layanannya dulu.',
      });
    }

    await prisma.serviceCategory.delete({ where: { id } });
    return res.status(204).send();
  } catch (error: any) {
    logger.error('Delete service category error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ===== Services =====
export async function handleGetServices(req: Request, res: Response) {
  try {
    const village_id = resolveAdminCollectionVillageScope(req, res);
    if (village_id === null) return;

    const category_id = getQuery(req, 'category_id');
    const data = await prisma.serviceItem.findMany({
      where: {
        ...(village_id ? { village_id } : {}),
        ...(category_id ? { category_id } : {}),
      },
      select: {
        id: true,
        village_id: true,
        category_id: true,
        name: true,
        description: true,
        slug: true,
        mode: true,
        estimated_cost: true,
        estimated_processing_time: true,
        citizen_fields_json: true,
        is_active: true,
        created_at: true,
        updated_at: true,
        requirements: true,
        category: true,
      },
      orderBy: { created_at: 'asc' }
    });
    return res.json({
      data: data.map(attachSubmissionSchema),
      meta: { citizen_field_catalog: getCitizenFieldCatalog() },
    });
  } catch (error: any) {
    logger.error('Get services error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleSearchServices(req: Request, res: Response) {
  try {
    const village_id = resolveAdminCollectionVillageScope(req, res);
    if (village_id === null) return;

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
          { name: { contains: query, mode: Prisma.QueryMode.insensitive } },
          { description: { contains: query, mode: Prisma.QueryMode.insensitive } },
          { slug: { contains: query, mode: Prisma.QueryMode.insensitive } },
          { category: { name: { contains: query, mode: Prisma.QueryMode.insensitive } } },
        ],
      },
      select: {
        id: true,
        village_id: true,
        category_id: true,
        name: true,
        description: true,
        slug: true,
        mode: true,
        estimated_cost: true,
        estimated_processing_time: true,
        citizen_fields_json: true,
        is_active: true,
        created_at: true,
        updated_at: true,
        requirements: true,
        category: true,
      },
      orderBy: { created_at: 'asc' },
      take: limit,
    });

    return res.json({
      data: data.map(attachSubmissionSchema),
      meta: { citizen_field_catalog: getCitizenFieldCatalog() },
    });
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
    const headerVillageId = requireVillageScopeForScopedAdmin(req, res);
    if (headerVillageId === null) return;
    const service = await prisma.serviceItem.findFirst({
      where: {
        id,
        ...(headerVillageId ? { village_id: headerVillageId } : {}),
      },
      select: {
        id: true,
        village_id: true,
        category_id: true,
        name: true,
        description: true,
        slug: true,
        mode: true,
        estimated_cost: true,
        estimated_processing_time: true,
        citizen_fields_json: true,
        is_active: true,
        created_at: true,
        updated_at: true,
        requirements: true,
        category: true,
      },
    });
    if (!service) return res.status(404).json({ error: 'Service not found' });
    return res.json({
      data: attachSubmissionSchema(service),
      meta: { citizen_field_catalog: getCitizenFieldCatalog() },
    });
  } catch (error: any) {
    logger.error('Get service by id error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleCreateService(req: Request, res: Response) {
  try {
    const {
      village_id,
      category_id,
      name,
      description,
      slug,
      mode,
      estimated_cost,
      estimated_processing_time,
      citizen_fields_json,
      is_active,
    } = req.body;
    if (!village_id || !category_id || !name || !description || !slug) {
      return res.status(400).json({ error: 'village_id, category_id, name, description, slug are required' });
    }

    const headerVillageId = requireVillageScopeForScopedAdmin(req, res);
    if (headerVillageId === null) return;
    if (headerVillageId && village_id !== headerVillageId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const category = await findCategoryForVillage(category_id, village_id);
    if (!category) {
      return res.status(400).json({ error: 'Kategori layanan tidak ditemukan untuk desa ini.' });
    }

    const normalizedMode = resolveServiceModeInput(mode, 'BOTH');
    if (!normalizedMode) {
      return res.status(400).json({ error: 'mode harus salah satu dari online, offline, atau both' });
    }

    const service = await prisma.serviceItem.create({
      data: {
        village_id,
        category_id,
        name,
        description,
        slug,
        mode: normalizedMode,
        estimated_cost: estimated_cost ?? null,
        estimated_processing_time: estimated_processing_time ?? null,
        citizen_fields_json: normalizeCitizenFieldsInput(citizen_fields_json),
        is_active: is_active ?? true,
      }
    });
    return res.status(201).json({ data: serializeServiceItem(service) });
  } catch (error: any) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: 'Slug layanan sudah dipakai di desa ini.' });
    }
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
    const {
      name,
      description,
      slug,
      mode,
      estimated_cost,
      estimated_processing_time,
      citizen_fields_json,
      is_active,
      category_id,
    } = req.body;

    const headerVillageId = requireVillageScopeForScopedAdmin(req, res);
    if (headerVillageId === null) return;
    const existingService = await findServiceForVillage(id, headerVillageId);
    if (!existingService) {
      return res.status(404).json({ error: 'Service not found' });
    }

    if (category_id) {
      const category = await findCategoryForVillage(category_id, existingService.village_id);
      if (!category) {
        return res.status(400).json({ error: 'Kategori layanan tidak ditemukan untuk desa ini.' });
      }
    }

    const normalizedMode = typeof mode === 'undefined' ? undefined : resolveServiceModeInput(mode);
    if (typeof mode !== 'undefined' && !normalizedMode) {
      return res.status(400).json({ error: 'mode harus salah satu dari online, offline, atau both' });
    }

    const service = await prisma.serviceItem.update({
      where: { id },
      data: {
        name: name ?? undefined,
        description: description ?? undefined,
        slug: slug ?? undefined,
        mode: normalizedMode ?? undefined,
        estimated_cost: estimated_cost ?? undefined,
        estimated_processing_time: estimated_processing_time ?? undefined,
        citizen_fields_json: typeof citizen_fields_json === 'undefined'
          ? undefined
          : normalizeCitizenFieldsInput(citizen_fields_json),
        is_active: is_active ?? undefined,
        category_id: category_id ?? undefined,
      }
    });
    return res.json({ data: serializeServiceItem(service) });
  } catch (error: any) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: 'Slug layanan sudah dipakai di desa ini.' });
    }
    logger.error('Update service error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleDeleteService(req: Request, res: Response) {
  try {
    const id = getParam(req, 'id');
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }

    const headerVillageId = requireVillageScopeForScopedAdmin(req, res);
    if (headerVillageId === null) return;
    const existingService = await findServiceForVillage(id, headerVillageId);
    if (!existingService) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const linkedRequests = await prisma.serviceRequest.count({ where: { service_id: id } });
    if (linkedRequests > 0) {
      return res.status(409).json({
        error: 'Layanan masih dipakai oleh permohonan warga. Nonaktifkan layanan ini jika sudah tidak ingin ditampilkan.',
      });
    }

    await prisma.serviceItem.delete({ where: { id } });
    return res.status(204).send();
  } catch (error: any) {
    logger.error('Delete service error', { error: error.message });
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
      select: {
        id: true,
        village_id: true,
        category_id: true,
        name: true,
        description: true,
        slug: true,
        mode: true,
        estimated_cost: true,
        estimated_processing_time: true,
        citizen_fields_json: true,
        is_active: true,
        created_at: true,
        updated_at: true,
        requirements: true,
        category: true,
      },
    });
    if (!service) return res.status(404).json({ error: 'Service not found' });
    if (!service.is_active) {
      return res.status(410).json({ error: 'Layanan ini sedang tidak tersedia.' });
    }
    return res.json({ data: attachSubmissionSchema(service) });
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
    const headerVillageId = requireVillageScopeForScopedAdmin(req, res);
    if (headerVillageId === null) return;
    const service = await findServiceForVillage(id, headerVillageId);
    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
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
    const headerVillageId = requireVillageScopeForScopedAdmin(req, res);
    if (headerVillageId === null) return;
    const service = await findServiceForVillage(id, headerVillageId);
    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
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
    const headerVillageId = requireVillageScopeForScopedAdmin(req, res);
    if (headerVillageId === null) return;
    const existingRequirement = await findRequirementForVillage(id, headerVillageId);
    if (!existingRequirement) {
      return res.status(404).json({ error: 'Requirement not found' });
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
    const headerVillageId = requireVillageScopeForScopedAdmin(req, res);
    if (headerVillageId === null) return;
    const existingRequirement = await findRequirementForVillage(id, headerVillageId);
    if (!existingRequirement) {
      return res.status(404).json({ error: 'Requirement not found' });
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
    const search = (getQuery(req, 'search') || '').trim();
    const village_id = getQuery(req, 'village_id') || (req.headers['x-village-id'] as string) || undefined;
    if (!village_id) {
      return res.status(400).json({ error: 'village_id is required for multi-tenancy isolation' });
    }

    const limitRaw = parseInt((getQuery(req, 'limit') || '20').toString(), 10);
    const offsetRaw = parseInt((getQuery(req, 'offset') || '0').toString(), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;
    const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

    const where: Prisma.ServiceRequestWhereInput = {
      ...(channel_identifier ? { channel, channel_identifier } : {}),
      ...(wa_user_id ? { wa_user_id } : {}),
      ...(service_id ? { service_id } : {}),
      ...(status ? { status } : {}),
      ...(request_number ? { request_number } : {}),
      deleted_at: null,
      AND: [
        { village_id },
        ...(search
          ? [{
              OR: [
                { request_number: { contains: search, mode: Prisma.QueryMode.insensitive } },
                { wa_user_id: { contains: search } },
                { channel_identifier: { contains: search, mode: Prisma.QueryMode.insensitive } },
                { service: { name: { contains: search, mode: Prisma.QueryMode.insensitive } } },
                {
                  citizen_data_json: {
                    path: ['nama_lengkap'],
                    string_contains: search,
                    mode: Prisma.QueryMode.insensitive,
                  } as Prisma.JsonFilter,
                },
                {
                  citizen_data_json: {
                    path: ['nik'],
                    string_contains: search,
                  } as Prisma.JsonFilter,
                },
                {
                  citizen_data_json: {
                    path: ['no_hp'],
                    string_contains: search,
                  } as Prisma.JsonFilter,
                },
              ],
            }]
          : []),
      ],
    };

    const [total, data] = await prisma.$transaction([
      prisma.serviceRequest.count({ where }),
      prisma.serviceRequest.findMany({
        where,
        include: { service: true },
        orderBy: { created_at: 'desc' },
        take: limit,
        skip: offset,
      }),
    ]);

    return res.json({
      data: data.map(serializeServiceRequest),
      pagination: {
        total,
        limit,
        offset,
      },
    });
  } catch (error: any) {
    logger.error('Get service requests error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleCreateServiceRequest(req: Request, res: Response) {
  try {
    const { service_id, village_id, wa_user_id, citizen_data_json, requirement_data_json, idempotency_key } = req.body;
    const channel = resolveChannelFromRequest(req);
    const channelIdentifier = resolveChannelIdentifier(req, channel) || req.body?.channel_identifier;
    const normalizedIdempotencyKey = typeof idempotency_key === 'string' ? idempotency_key.trim() : '';

    if (idempotency_key !== undefined && normalizedIdempotencyKey.length === 0) {
      return res.status(400).json({ error: 'idempotency_key tidak boleh kosong' });
    }

    if (normalizedIdempotencyKey.length > 120) {
      return res.status(400).json({ error: 'idempotency_key terlalu panjang' });
    }

    if (!service_id) {
      return res.status(400).json({ error: 'service_id is required' });
    }

    const service = await prisma.serviceItem.findUnique({
      where: { id: service_id },
      select: {
        id: true,
        village_id: true,
        name: true,
        mode: true,
        is_active: true,
        citizen_fields_json: true,
        requirements: {
          select: {
            id: true,
            label: true,
            field_type: true,
            is_required: true,
            help_text: true,
            options_json: true,
          },
          orderBy: { order_index: 'asc' },
        },
      },
    });

    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    if (village_id && village_id !== service.village_id) {
      return res.status(400).json({ error: 'village_id does not match selected service' });
    }

    if (!service.is_active) {
      return res.status(410).json({ error: 'Layanan ini sedang tidak tersedia.' });
    }

    const submissionSchema = buildServiceRequestSchema(service);
    if (!submissionSchema.submissionPolicy.allowsPublicSubmission) {
      return res.status(400).json({ error: 'Layanan ini hanya bisa diproses offline di kantor desa/kecamatan.' });
    }

    const validation = validateServiceRequestPayload(
      submissionSchema,
      citizen_data_json,
      requirement_data_json,
    );
    if (!validation.ok) {
      return res.status(400).json({
        error: validation.errors[0] || 'Data permohonan belum valid',
        errors: validation.errors,
      });
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

    const resolvedChannelIdentifier = channel === 'WEBCHAT'
      ? String(channelIdentifier)
      : String(normalizedWaUserId);

    if (normalizedIdempotencyKey) {
      const existing = await findServiceRequestByIdempotency({
        service_id,
        channel,
        channel_identifier: resolvedChannelIdentifier,
        idempotency_key: normalizedIdempotencyKey,
      });

      if (existing) {
        return res.status(200).json({
          data: serializeServiceRequest(existing),
          idempotent_replay: true,
        });
      }
    }

    const requestNumber = await generateServiceRequestId();

    const created = await prisma.$transaction(async (tx) => {
      const createdRequest = await tx.serviceRequest.create({
        data: {
          request_number: requestNumber,
          service_id,
          village_id: service.village_id,
          wa_user_id: normalizedWaUserId,
          channel,
          channel_identifier: resolvedChannelIdentifier,
          citizen_data_json: validation.citizenData as Prisma.InputJsonValue,
          requirement_data_json: validation.requirementData as Prisma.InputJsonValue,
          idempotency_key: normalizedIdempotencyKey || null,
        },
        include: { service: true },
      });

      await enqueueOutboxEvent(tx, {
        routingKey: RABBITMQ_CONFIG.ROUTING_KEYS.SERVICE_REQUESTED,
        payload: {
          village_id: createdRequest.village_id,
          wa_user_id: normalizedWaUserId,
          channel,
          channel_identifier: resolvedChannelIdentifier,
          request_number: createdRequest.request_number,
          service_id,
          service_name: createdRequest.service?.name || null,
        },
        entityType: 'service_request',
        entityId: createdRequest.request_number,
      });

      return createdRequest;
    });

    return res.status(201).json({ data: serializeServiceRequest(created) });
  } catch (error: any) {
    const replayKey = typeof req.body?.idempotency_key === 'string' ? req.body.idempotency_key.trim() : '';
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && replayKey) {
      const replayChannel = resolveChannelFromRequest(req);
      const replayChannelIdentifier = replayChannel === 'WEBCHAT'
        ? String(resolveChannelIdentifier(req, replayChannel) || req.body?.channel_identifier || '')
        : normalizeCitizenWaForStorage(String(req.body?.wa_user_id || ''));
      const replayServiceId = String(req.body?.service_id || '');

      if (replayServiceId && replayChannelIdentifier) {
        const existing = await findServiceRequestByIdempotency({
          service_id: replayServiceId,
          channel: replayChannel,
          channel_identifier: replayChannelIdentifier,
          idempotency_key: replayKey,
        });

        if (existing) {
          return res.status(200).json({
            data: serializeServiceRequest(existing),
            idempotent_replay: true,
          });
        }
      }
    }

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
    const village_id = getQuery(req, 'village_id') || (req.headers['x-village-id'] as string) || undefined;
    if (!village_id) {
      return res.status(400).json({ error: 'village_id is required for multi-tenancy isolation' });
    }

    const data = await prisma.serviceRequest.findFirst({
      where: {
        OR: [{ id }, { request_number: id }],
        deleted_at: null,
      },
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
    if (!data || data.village_id !== village_id) return res.status(404).json({ error: 'Request not found' });
    return res.json({ data: serializeServiceRequest(data) });
  } catch (error: any) {
    logger.error('Get service request by id error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleCheckServiceRequestStatus(req: Request, res: Response) {
  try {
    const id = getParam(req, 'id');
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }

    const channel = resolveChannelFromRequest(req);
    const channelIdentifier = resolveChannelIdentifier(req, channel) || req.body?.channel_identifier;
    const wa_user_id = channel === 'WHATSAPP'
      ? normalizeTo628(String(req.body?.wa_user_id || ''))
      : undefined;

    if (channel === 'WHATSAPP' && !wa_user_id) {
      return res.status(400).json({ error: 'wa_user_id is required' });
    }

    if (channel === 'WEBCHAT' && !channelIdentifier) {
      return res.status(400).json({ error: 'session_id/channel_identifier is required' });
    }

    const request = await prisma.serviceRequest.findFirst({
      where: {
        OR: [{ id }, { request_number: id }],
        deleted_at: null,
      },
      include: {
        service: {
          include: {
            requirements: {
              orderBy: { order_index: 'asc' },
            },
          },
        },
      },
    });

    if (!request) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Permohonan layanan tidak ditemukan' });
    }

    if (!isSameRequester(request, { channel, wa_user_id, channel_identifier: channelIdentifier })) {
      return res.status(403).json({ error: 'NOT_OWNER', message: 'Permohonan layanan ini tidak terdaftar atas nomor Anda' });
    }

    return res.json({ data: serializeServiceRequest(request) });
  } catch (error: any) {
    logger.error('Check service request status error', { error: error.message });
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
    if (!existingRequest || existingRequest.village_id !== village_id) {
      return res.status(404).json({ error: 'Service request not found' });
    }
    
    const body = req.body ?? {};
    const { status, admin_notes, result_file_url, result_file_name, result_description } = body;
    const hasStatus = Object.prototype.hasOwnProperty.call(body, 'status');
    const hasAdminNotes = Object.prototype.hasOwnProperty.call(body, 'admin_notes');
    const hasResultFileUrl = Object.prototype.hasOwnProperty.call(body, 'result_file_url');
    const hasResultFileName = Object.prototype.hasOwnProperty.call(body, 'result_file_name');
    const hasResultDescription = Object.prototype.hasOwnProperty.call(body, 'result_description');

    if (!hasStatus && !hasAdminNotes && !hasResultFileUrl && !hasResultFileName && !hasResultDescription) {
      return res.status(400).json({ error: 'Tidak ada perubahan yang dikirim' });
    }

    const normalizedStatus = hasStatus ? String(status || '').trim().toUpperCase() : undefined;

    if (hasStatus && (!normalizedStatus || !['OPEN', 'PROCESS', 'DONE', 'CANCELED', 'REJECT'].includes(normalizedStatus))) {
      return res.status(400).json({ error: 'status tidak valid' });
    }

    if (normalizedStatus && ['DONE', 'CANCELED', 'REJECT'].includes(normalizedStatus) && (!admin_notes || String(admin_notes).trim() === '')) {
      return res.status(400).json({ error: 'admin_notes wajib diisi untuk status DONE/CANCELED/REJECT' });
    }

    if (normalizedStatus && !isValidServiceRequestStatusTransition(existingRequest.status, normalizedStatus)) {
      return res.status(400).json({
        error: `Transisi status tidak valid: ${existingRequest.status} → ${normalizedStatus}. Status ${existingRequest.status} sudah final.`,
      });
    }

    const data = await prisma.$transaction(async (tx) => {
      const updateData: Prisma.ServiceRequestUpdateInput = {
        ...(normalizedStatus
          ? {
              status: normalizedStatus,
              status_notified_at: null,
              status_delivered_at: null,
              last_delivery_message_id: null,
              last_delivery_status: null,
              last_delivery_error: null,
              last_delivery_attempt_at: null,
            }
          : {}),
        ...(hasAdminNotes ? { admin_notes } : {}),
        ...(hasResultFileUrl ? { result_file_url } : {}),
        ...(hasResultFileName ? { result_file_name } : {}),
        ...(hasResultDescription ? { result_description } : {}),
      };

      const updated = await tx.serviceRequest.update({
        where: { id: existingRequest.id },
        data: updateData,
        include: { service: true, updates: { orderBy: { created_at: 'asc' } } },
      });

      const auditMetadata = getAuditMetadata(req);
      await tx.serviceRequestUpdate.create({
        data: {
          service_request_id: existingRequest.id,
          admin_id: auditMetadata.admin_id,
          admin_name: auditMetadata.admin_name,
          admin_role: auditMetadata.admin_role,
          old_status: normalizedStatus ? existingRequest.status : null,
          new_status: normalizedStatus || null,
          note_text: hasAdminNotes ? admin_notes ?? null : auditMetadata.reason ?? null,
          result_file_url: hasResultFileUrl ? result_file_url ?? null : null,
          result_file_name: hasResultFileName ? result_file_name ?? null : null,
          result_description: hasResultDescription ? result_description ?? null : null,
        },
      });

      if (normalizedStatus) {
        await enqueueOutboxEvent(tx, {
          routingKey: RABBITMQ_CONFIG.ROUTING_KEYS.STATUS_UPDATED,
          payload: {
            village_id: updated.village_id,
            wa_user_id: updated.wa_user_id,
            channel: updated.channel || 'WHATSAPP',
            channel_identifier: updated.channel_identifier || updated.wa_user_id,
            request_number: updated.request_number,
            status: normalizedStatus,
            admin_notes: updated.admin_notes,
            result_file_url: updated.result_file_url ?? undefined,
            result_file_name: updated.result_file_name ?? undefined,
          },
          entityType: 'service_request',
          entityId: updated.request_number,
        });
      }

      return updated;
    });

    return res.json({ data: serializeServiceRequest(data) });
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

    return res.json({
      data: {
        ...request,
        service: request.service ? attachSubmissionSchema(request.service) : request.service,
      },
    });
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
      include: {
        service: {
          include: {
            requirements: {
              orderBy: { order_index: 'asc' },
            },
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

    const submissionSchema = buildServiceRequestSchema(request.service);
    const validation = validateServiceRequestPayload(
      submissionSchema,
      citizen_data_json === null || typeof citizen_data_json === 'undefined'
        ? request.citizen_data_json
        : citizen_data_json,
      requirement_data_json === null || typeof requirement_data_json === 'undefined'
        ? request.requirement_data_json
        : requirement_data_json,
    );
    if (!validation.ok) {
      return res.status(400).json({
        error: validation.errors[0] || 'Data permohonan belum valid',
        errors: validation.errors,
      });
    }

    const updated = await prisma.serviceRequest.update({
      where: { id: request.id },
      data: {
        citizen_data_json: validation.citizenData as Prisma.InputJsonValue,
        requirement_data_json: validation.requirementData as Prisma.InputJsonValue,
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
    const normalizedCancelReason = typeof cancel_reason === 'string' && cancel_reason.trim()
      ? cancel_reason.trim()
      : 'tanpa alasan tambahan';

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

    const cancelNote = `Dibatalkan oleh masyarakat: ${normalizedCancelReason}`;
    const updated = await prisma.$transaction(async (tx) => {
      const cancelled = await tx.serviceRequest.update({
        where: { id: existing.id },
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
          village_id: existing.village_id,
          wa_user_id: existing.wa_user_id,
          channel: existing.channel || 'WHATSAPP',
          channel_identifier: existing.channel_identifier || existing.wa_user_id,
          request_number: existing.request_number,
          status: 'CANCELED',
          admin_notes: cancelNote,
        },
        entityType: 'service_request',
        entityId: existing.request_number,
      });

      return cancelled;
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
        deleted_at: null,
        village_id,
      },
      include: { service: true },
      orderBy: { created_at: 'desc' }
    });
    return res.json({ data: data.map(serializeServiceRequest) });
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
    if (!sr || sr.village_id !== village_id) {
      return res.status(404).json({ error: 'Service request not found' });
    }

    const archivedAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.serviceRequest.update({
        where: { id: sr.id },
        data: { deleted_at: archivedAt },
      });

      await enqueueOutboxEvent(tx, {
        routingKey: RABBITMQ_CONFIG.ROUTING_KEYS.SERVICE_REQUEST_ARCHIVED,
        payload: {
          type: 'service_request_archived',
          village_id,
          service_request_id: sr.id,
          request_number: sr.request_number,
          archived_at: archivedAt.toISOString(),
        },
        entityType: 'service_request',
        entityId: sr.request_number,
      });
    });

    invalidateStatsCache();
    const audit = getAuditMetadata(req);
    recordAuditLog({
      village_id,
      admin_id: audit.admin_id,
      admin_role: audit.admin_role,
      admin_name: audit.admin_name,
      reason: audit.reason,
      action: 'archive',
      entity_type: 'service_request',
      entity_id: sr.id,
      entity_label: sr.request_number,
      metadata: { request_number: sr.request_number, archived_at: archivedAt.toISOString() },
    }).catch((error: any) => logger.warn('Failed to record service request archive audit log', { error: error.message, id: sr.id }));

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
    if (!sr || sr.village_id !== village_id) {
      return res.status(404).json({ error: 'Deleted service request not found' });
    }

    const restoredAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.serviceRequest.update({
        where: { id: sr.id },
        data: { deleted_at: null },
      });

      await enqueueOutboxEvent(tx, {
        routingKey: RABBITMQ_CONFIG.ROUTING_KEYS.SERVICE_REQUEST_RESTORED,
        payload: {
          type: 'service_request_restored',
          village_id,
          service_request_id: sr.id,
          request_number: sr.request_number,
          restored_at: restoredAt.toISOString(),
        },
        entityType: 'service_request',
        entityId: sr.request_number,
      });
    });

    invalidateStatsCache();
    const audit = getAuditMetadata(req);
    recordAuditLog({
      village_id,
      admin_id: audit.admin_id,
      admin_role: audit.admin_role,
      admin_name: audit.admin_name,
      reason: audit.reason,
      action: 'restore',
      entity_type: 'service_request',
      entity_id: sr.id,
      entity_label: sr.request_number,
      metadata: { request_number: sr.request_number, restored_at: restoredAt.toISOString() },
    }).catch((error: any) => logger.warn('Failed to record service request restore audit log', { error: error.message, id: sr.id }));

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
        village_id,
      },
      include: { service: true },
      orderBy: { deleted_at: 'desc' },
    });

    return res.json({ data: data.map(serializeServiceRequest) });
  } catch (error: any) {
    logger.error('Get deleted service requests error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}
