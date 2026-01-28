import { Request, Response } from 'express';
import prisma from '../config/database';
import logger from '../utils/logger';
import { getParamString, getQueryString } from '../utils/http';

// ===== Complaint Categories =====
export async function handleGetComplaintCategories(req: Request, res: Response) {
  try {
    const village_id = getQueryString(req.query.village_id);
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
    const { village_id, name, description } = req.body;
    if (!village_id || !name) {
      return res.status(400).json({ error: 'village_id and name are required' });
    }
    const data = await prisma.complaintCategory.create({
      data: { village_id, name, description }
    });
    return res.status(201).json({ data });
  } catch (error: any) {
    logger.error('Create complaint category error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleUpdateComplaintCategory(req: Request, res: Response) {
  try {
    const id = getParamString((req.params as any)?.id);
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    const { name, description } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    const existing = await prisma.complaintCategory.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Category not found' });
    }
    const data = await prisma.complaintCategory.update({
      where: { id },
      data: { name, description },
    });
    return res.json({ data });
  } catch (error: any) {
    logger.error('Update complaint category error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleDeleteComplaintCategory(req: Request, res: Response) {
  try {
    const id = getParamString((req.params as any)?.id);
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    const existing = await prisma.complaintCategory.findUnique({ where: { id } });
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
    const category_id = getQueryString(req.query.category_id);
    const village_id = getQueryString(req.query.village_id);
    const data = await prisma.complaintType.findMany({
      where: {
        ...(category_id ? { category_id } : {}),
        ...(village_id ? { category: { village_id } } : {}),
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
    const { category_id, name, description, is_urgent, require_address, send_important_contacts, important_contact_category } = req.body;
    if (!category_id || !name) {
      return res.status(400).json({ error: 'category_id and name are required' });
    }
    const data = await prisma.complaintType.create({
      data: {
        category_id,
        name,
        description,
        is_urgent: is_urgent ?? false,
        require_address: require_address ?? false,
        send_important_contacts: send_important_contacts ?? false,
        important_contact_category: important_contact_category ?? null,
      }
    });
    return res.status(201).json({ data });
  } catch (error: any) {
    logger.error('Create complaint type error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleUpdateComplaintType(req: Request, res: Response) {
  try {
    const id = getParamString((req.params as any)?.id);
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    const { name, description, is_urgent, require_address, send_important_contacts, important_contact_category } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    const existing = await prisma.complaintType.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Type not found' });
    }
    const data = await prisma.complaintType.update({
      where: { id },
      data: {
        name,
        description,
        is_urgent: is_urgent ?? existing.is_urgent,
        require_address: require_address ?? existing.require_address,
        send_important_contacts: send_important_contacts ?? existing.send_important_contacts,
        important_contact_category: send_important_contacts ? important_contact_category ?? null : null,
      },
    });
    return res.json({ data });
  } catch (error: any) {
    logger.error('Update complaint type error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleDeleteComplaintType(req: Request, res: Response) {
  try {
    const id = getParamString((req.params as any)?.id);
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    const existing = await prisma.complaintType.findUnique({ where: { id } });
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
    const id = getParamString((req.params as any)?.id);
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    const { admin_id, note_text, image_url } = req.body;
    if (!note_text) {
      return res.status(400).json({ error: 'note_text is required' });
    }
    const update = await prisma.complaintUpdate.create({
      data: {
        complaint_id: id,
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
