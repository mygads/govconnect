import { Router } from 'express';
import { body } from 'express-validator';
import {
  handleCreateComplaint,
  handleGetComplaints,
  handleGetComplaintById,
  handleUpdateComplaintStatus,
  handleGetComplaintStatistics,
} from '../controllers/complaint.controller';
import { internalAuth } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';

const router: Router = Router();

/**
 * POST /laporan/create
 * Create new complaint (from AI Service - internal only)
 */
router.post(
  '/create',
  internalAuth,
  [
    body('wa_user_id').matches(/^628\d{8,12}$/).withMessage('Invalid phone number'),
    body('kategori')
      .isIn([
        'jalan_rusak',
        'lampu_mati',
        'sampah',
        'drainase',
        'pohon_tumbang',
        'fasilitas_rusak',
        'banjir',
        'lainnya',
      ])
      .withMessage('Invalid kategori'),
    body('deskripsi').isLength({ min: 10, max: 1000 }).withMessage('Deskripsi 10-1000 chars'),
    body('alamat').optional().isString(),
    body('rt_rw').optional().isString(),
    body('foto_url').optional().isURL(),
  ],
  validate,
  handleCreateComplaint
);

/**
 * GET /laporan
 * Get complaints list (public - for Dashboard)
 */
router.get('/', handleGetComplaints);

/**
 * GET /laporan/statistics
 * Get complaint statistics
 */
router.get('/statistics', handleGetComplaintStatistics);

/**
 * GET /laporan/:id
 * Get complaint by ID
 */
router.get('/:id', handleGetComplaintById);

/**
 * PATCH /laporan/:id/status
 * Update complaint status (for Dashboard)
 */
router.patch(
  '/:id/status',
  [
    body('status')
      .isIn(['baru', 'proses', 'selesai', 'ditolak'])
      .withMessage('Invalid status'),
    body('admin_notes').optional().isString(),
  ],
  validate,
  handleUpdateComplaintStatus
);

export default router;
