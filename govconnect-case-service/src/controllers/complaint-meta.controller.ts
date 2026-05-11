import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import logger from '../utils/logger';
import { getParam, getQuery } from '../utils/http';

/**
 * Extract village_id from request headers (set by Dashboard via X-Village-Id)
 * Used for multi-tenancy ownership validation on write operations
 */
function getVillageIdFromHeader(req: Request): string | undefined {
  return typeof req.headers['x-village-id'] === 'string'
    ? req.headers['x-village-id']
    : undefined;
}

function getAdminRoleFromHeader(req: Request): string | undefined {
  return typeof req.headers['x-admin-role'] === 'string'
    ? req.headers['x-admin-role']
    : undefined;
}

function requireVillageScopeForScopedAdmin(req: Request, res: Response): string | undefined | null {
  const villageId = getVillageIdFromHeader(req);
  const adminRole = getAdminRoleFromHeader(req);

  if (adminRole && adminRole !== 'superadmin' && !villageId) {
    res.status(400).json({ error: 'x-village-id is required for village-scoped admin requests' });
    return null;
  }

  if (!adminRole) {
    res.status(400).json({ error: 'x-admin-role is required for admin metadata requests' });
    return null;
  }

  return villageId;
}

function resolveAdminCollectionVillageScope(req: Request, res: Response): string | undefined | null {
  const scopedVillageId = requireVillageScopeForScopedAdmin(req, res);
  if (scopedVillageId === null) return null;

  const queryVillageId = getQuery(req, 'village_id') || undefined;
  const adminRole = getAdminRoleFromHeader(req);
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

  res.status(400).json({ error: 'x-admin-role is required for admin metadata requests' });
  return null;
}

function resolveAdminWriteVillageScope(req: Request, res: Response, requestedVillageId?: string): string | undefined | null {
  const scopedVillageId = requireVillageScopeForScopedAdmin(req, res);
  if (scopedVillageId === null) return null;

  const adminRole = getAdminRoleFromHeader(req);
  if (scopedVillageId) {
    if (requestedVillageId && requestedVillageId !== scopedVillageId) {
      res.status(403).json({ error: 'Tidak bisa mengubah data untuk desa lain' });
      return null;
    }
    return scopedVillageId;
  }

  if (adminRole === 'superadmin') {
    if (!requestedVillageId) {
      res.status(400).json({ error: 'village_id is required for superadmin writes' });
      return null;
    }
    return requestedVillageId;
  }

  res.status(400).json({ error: 'x-admin-role is required for admin metadata requests' });
  return null;
}

function normalizeComplaintMetaName(name: unknown): string {
  return typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
}

function buildComplaintMetaNameKey(name: string): string {
  return normalizeComplaintMetaName(name).toLocaleLowerCase('id-ID');
}

function isDuplicateConstraintError(error: unknown, field: 'category' | 'type'): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }

  const targets = Array.isArray(error.meta?.target) ? error.meta.target.map(String) : [];
  if (field === 'category') {
    return targets.includes('village_id') && targets.includes('name_key');
  }

  return targets.includes('category_id') && targets.includes('name_key');
}

async function findComplaintCategoryForVillage(id: string, villageId?: string) {
  return prisma.complaintCategory.findFirst({
    where: {
      id,
      ...(villageId ? { village_id: villageId } : {}),
    },
  });
}

async function findComplaintTypeForVillage(id: string, villageId?: string) {
  return prisma.complaintType.findFirst({
    where: {
      id,
      ...(villageId ? { category: { village_id: villageId } } : {}),
    },
    include: { category: true },
  });
}

type ImportantContactCategoryRow = {
  id: string;
  village_id: string;
};

async function findImportantContactCategoryForVillage(id: string, villageId: string) {
  const rows = await prisma.$queryRaw<ImportantContactCategoryRow[]>`
    SELECT id, village_id
    FROM important_contact_categories
    WHERE id = ${id} AND village_id = ${villageId}
    LIMIT 1
  `;

  return rows[0] ?? null;
}

// ===== Complaint Categories =====
export async function handleGetComplaintCategories(req: Request, res: Response) {
  try {
    const village_id = resolveAdminCollectionVillageScope(req, res);
    if (village_id === null) return;
    const data = await prisma.complaintCategory.findMany({
      where: village_id ? { village_id } : undefined,
      orderBy: { created_at: 'asc' },
    });
    return res.json({ data });
  } catch (error: any) {
    logger.error('Get complaint categories error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleCreateComplaintCategory(req: Request, res: Response) {
  try {
    const requestedVillageId = typeof req.body?.village_id === 'string' ? req.body.village_id.trim() : '';
    const normalizedName = normalizeComplaintMetaName(req.body?.name);
    const villageId = resolveAdminWriteVillageScope(req, res, requestedVillageId);
    if (villageId === null) return;

    if (!villageId || !normalizedName) {
      return res.status(400).json({ error: 'village_id and name are required' });
    }

    const data = await prisma.complaintCategory.create({
      data: {
        village_id: villageId,
        name: normalizedName,
        name_key: buildComplaintMetaNameKey(normalizedName),
        description: typeof req.body?.description === 'string' ? (req.body.description.trim() || null) : null,
      }
    });
    return res.status(201).json({ data });
  } catch (error: any) {
    if (isDuplicateConstraintError(error, 'category')) {
      return res.status(409).json({ error: 'Nama kategori pengaduan sudah dipakai di desa ini.' });
    }
    logger.error('Create complaint category error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleUpdateComplaintCategory(req: Request, res: Response) {
  try {
    const id = getParam(req, 'id');
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }

    const normalizedName = normalizeComplaintMetaName(req.body?.name);
    if (!normalizedName) {
      return res.status(400).json({ error: 'name is required' });
    }

    const headerVillageId = requireVillageScopeForScopedAdmin(req, res);
    if (headerVillageId === null) return;

    const existing = await findComplaintCategoryForVillage(id, headerVillageId);
    if (!existing) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const data = await prisma.complaintCategory.update({
      where: { id },
      data: {
        name: normalizedName,
        name_key: buildComplaintMetaNameKey(normalizedName),
        description: typeof req.body?.description === 'string' ? (req.body.description.trim() || null) : null,
      },
    });
    return res.json({ data });
  } catch (error: any) {
    if (isDuplicateConstraintError(error, 'category')) {
      return res.status(409).json({ error: 'Nama kategori pengaduan sudah dipakai di desa ini.' });
    }
    logger.error('Update complaint category error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleDeleteComplaintCategory(req: Request, res: Response) {
  try {
    const id = getParam(req, 'id');
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    const headerVillageId = requireVillageScopeForScopedAdmin(req, res);
    if (headerVillageId === null) return;

    const existing = await findComplaintCategoryForVillage(id, headerVillageId);
    if (!existing) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const typeCount = await prisma.complaintType.count({ where: { category_id: id } });
    if (typeCount > 0) {
      return res.status(409).json({
        error: 'Kategori tidak bisa dihapus karena masih memiliki jenis pengaduan. Hapus semua jenis terlebih dahulu.'
      });
    }

    await prisma.complaintCategory.delete({ where: { id } });
    return res.json({ status: 'success' });
  } catch (error: any) {
    logger.error('Delete complaint category error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ===== Complaint Types =====
export async function handleGetComplaintTypes(req: Request, res: Response) {
  try {
    const category_id = getQuery(req, 'category_id');
    const village_id = resolveAdminCollectionVillageScope(req, res);
    if (village_id === null) return;
    const is_urgent = getQuery(req, 'is_urgent');
    
    const data = await prisma.complaintType.findMany({
      where: {
        ...(category_id ? { category_id } : {}),
        ...(village_id ? { category: { village_id } } : {}),
        ...(is_urgent === 'true' ? { is_urgent: true } : {}),
        ...(is_urgent === 'false' ? { is_urgent: false } : {}),
      },
      include: { category: true },
      orderBy: { created_at: 'asc' },
    });
    return res.json({ data });
  } catch (error: any) {
    logger.error('Get complaint types error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleCreateComplaintType(req: Request, res: Response) {
  try {
    const {
      category_id,
      description,
      is_urgent,
      require_address,
      send_important_contacts,
      important_contact_category_id,
    } = req.body;
    const normalizedName = normalizeComplaintMetaName(req.body?.name);
    if (!category_id || !normalizedName) {
      return res.status(400).json({ error: 'category_id and name are required' });
    }
    if (send_important_contacts && !important_contact_category_id) {
      return res.status(400).json({ error: 'important contact category id is required when auto-send is enabled' });
    }
    const headerVillageId = requireVillageScopeForScopedAdmin(req, res);
    if (headerVillageId === null) return;

    const category = await findComplaintCategoryForVillage(category_id, headerVillageId);
    if (!category) {
      return res.status(headerVillageId ? 403 : 400).json({ error: headerVillageId ? 'Tidak memiliki akses ke kategori ini' : 'Kategori pengaduan tidak ditemukan' });
    }

    if (send_important_contacts) {
      const importantContactCategory = await findImportantContactCategoryForVillage(important_contact_category_id, category.village_id);
      if (!importantContactCategory) {
        return res.status(400).json({ error: 'important contact category tidak valid untuk desa ini' });
      }
    }

    const data = await prisma.complaintType.create({
      data: {
        category_id,
        name: normalizedName,
        name_key: buildComplaintMetaNameKey(normalizedName),
        description: typeof description === 'string' ? (description.trim() || null) : null,
        is_urgent: is_urgent ?? false,
        require_address: require_address ?? false,
        send_important_contacts: send_important_contacts ?? false,
        important_contact_category: null,
        important_contact_category_id: send_important_contacts ? important_contact_category_id ?? null : null,
      }
    });
    return res.status(201).json({ data });
  } catch (error: any) {
    if (isDuplicateConstraintError(error, 'type')) {
      return res.status(409).json({ error: 'Nama jenis pengaduan sudah dipakai di kategori ini.' });
    }
    logger.error('Create complaint type error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleUpdateComplaintType(req: Request, res: Response) {
  try {
    const id = getParam(req, 'id');
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    const {
      description,
      is_urgent,
      require_address,
      send_important_contacts,
      important_contact_category_id,
    } = req.body;
    const normalizedName = normalizeComplaintMetaName(req.body?.name);
    if (!normalizedName) {
      return res.status(400).json({ error: 'name is required' });
    }
    const headerVillageId = requireVillageScopeForScopedAdmin(req, res);
    if (headerVillageId === null) return;

    const existing = await findComplaintTypeForVillage(id, headerVillageId);
    if (!existing) {
      return res.status(404).json({ error: 'Type not found' });
    }
    const shouldSendImportantContacts = send_important_contacts ?? existing.send_important_contacts;
    if (shouldSendImportantContacts && !important_contact_category_id && !existing.important_contact_category_id) {
      return res.status(400).json({ error: 'important contact category id is required when auto-send is enabled' });
    }

    const resolvedImportantContactCategoryId = shouldSendImportantContacts
      ? important_contact_category_id ?? existing.important_contact_category_id ?? null
      : null;

    if (shouldSendImportantContacts && important_contact_category_id) {
      const importantContactCategory = await findImportantContactCategoryForVillage(important_contact_category_id, existing.category.village_id);
      if (!importantContactCategory) {
        return res.status(400).json({ error: 'important contact category tidak valid untuk desa ini' });
      }
    }

    const data = await prisma.complaintType.update({
      where: { id },
      data: {
        name: normalizedName,
        name_key: buildComplaintMetaNameKey(normalizedName),
        description: typeof description === 'string' ? (description.trim() || null) : null,
        is_urgent: is_urgent ?? existing.is_urgent,
        require_address: require_address ?? existing.require_address,
        send_important_contacts: shouldSendImportantContacts,
        important_contact_category: null,
        important_contact_category_id: resolvedImportantContactCategoryId,
      },
    });
    return res.json({ data });
  } catch (error: any) {
    if (isDuplicateConstraintError(error, 'type')) {
      return res.status(409).json({ error: 'Nama jenis pengaduan sudah dipakai di kategori ini.' });
    }
    logger.error('Update complaint type error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleDeleteComplaintType(req: Request, res: Response) {
  try {
    const id = getParam(req, 'id');
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    const headerVillageId = requireVillageScopeForScopedAdmin(req, res);
    if (headerVillageId === null) return;

    const existing = await findComplaintTypeForVillage(id, headerVillageId);
    if (!existing) {
      return res.status(404).json({ error: 'Type not found' });
    }
    await prisma.complaintType.delete({ where: { id } });
    return res.json({ status: 'success' });
  } catch (error: any) {
    logger.error('Delete complaint type error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ===== Complaint Updates =====
export async function handleCreateComplaintUpdate(req: Request, res: Response) {
  try {
    const id = getParam(req, 'id');
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }

    const village_id = getQuery(req, 'village_id') || getVillageIdFromHeader(req);
    if (!village_id) {
      return res.status(400).json({ error: 'village_id is required for multi-tenancy isolation' });
    }

    const existingComplaint = await prisma.complaint.findFirst({
      where: { OR: [{ id }, { complaint_id: id }] },
    });
    if (!existingComplaint || existingComplaint.village_id !== village_id) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    const { admin_id, note_text, image_url } = req.body;
    if (!note_text) {
      return res.status(400).json({ error: 'note_text is required' });
    }
    const update = await prisma.complaintUpdate.create({
      data: {
        complaint_id: existingComplaint.id,
        admin_id,
        note_text,
        image_url: image_url ?? null,
      }
    });
    return res.status(201).json({ data: update });
  } catch (error: any) {
    logger.error('Create complaint update error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}
