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

/**
 * POST /laporan/create
 * Create new complaint (from AI Service)
 */
export async function handleCreateComplaint(req: Request, res: Response) {
  try {
    const { wa_user_id, kategori, deskripsi, alamat, rt_rw, foto_url } = req.body;

    // Check for duplicate complaint
    const duplicateCheck = await checkDuplicateComplaint({
      wa_user_id,
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
      kategori,
      deskripsi,
      alamat,
      rt_rw,
    });

    const complaint = await createComplaint(req.body);

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
      status: req.query.status as string,
      kategori: req.query.kategori as string,
      category_id: req.query.category_id as string,
      type_id: req.query.type_id as string,
      rt_rw: req.query.rt_rw as string,
      wa_user_id: req.query.wa_user_id as string,
      village_id: req.query.village_id as string,
      limit: parseInt(req.query.limit as string) || 20,
      offset: parseInt(req.query.offset as string) || 0,
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

/**
 * GET /laporan/:id
 * Get complaint by ID (for admin/dashboard - no ownership check)
 */
export async function handleGetComplaintById(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const complaint = await getComplaintById(id);
    
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
    const { id } = req.params;
    const { wa_user_id } = req.body;
    
    if (!wa_user_id) {
      return res.status(400).json({ error: 'wa_user_id is required' });
    }
    
    const { getComplaintByIdWithOwnership } = await import('../services/complaint.service');
    const result = await getComplaintByIdWithOwnership(id, wa_user_id);
    
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
 * Update complaint status (from Dashboard)
 */
export async function handleUpdateComplaintStatus(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { status, admin_notes } = req.body;
    
    const complaint = await updateComplaintStatus(id, { status, admin_notes });
    
    return res.json({
      status: 'success',
      data: complaint,
    });
  } catch (error: any) {
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
    const stats = await getComplaintStatistics();
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
    const { id } = req.params;
    const { wa_user_id, cancel_reason } = req.body;
    
    if (!wa_user_id) {
      return res.status(400).json({ error: 'wa_user_id is required' });
    }
    
    const result = await cancelComplaint(id, { wa_user_id, cancel_reason });
    
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
    const { id } = req.params;
    const { wa_user_id, alamat, deskripsi, rt_rw } = req.body;

    const result = await updateComplaintByUser(id, { wa_user_id, alamat, deskripsi, rt_rw });

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
