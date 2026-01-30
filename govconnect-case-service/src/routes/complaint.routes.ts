import { Router } from 'express';
import { body } from 'express-validator';
import {
  handleCreateComplaint,
  handleGetComplaints,
  handleGetComplaintById,
  handleCheckComplaintStatus,
  handleUpdateComplaintStatus,
  handleGetComplaintStatistics,
  handleCancelComplaint,
  handleUpdateComplaintByUser,
} from '../controllers/complaint.controller';
import { internalAuth } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';

const router: Router = Router();

router.post(
  '/create',
  internalAuth,
  [
    // Accept WhatsApp phone (628xxx) or webchat session (web_xxx)
    body('wa_user_id').optional().matches(/^(628\d{8,12}|web_[a-z0-9_]+)$/i).withMessage('Invalid user ID format'),
    body('kategori')
      .isIn([
        'jalan_rusak',
        'lampu_mati',
        'sampah',
        'drainase',
        'pohon_tumbang',
        'fasilitas_rusak',
        'banjir',
        'tindakan_kriminal',
        'lainnya',
      ])
      .withMessage('Invalid kategori'),
    body('deskripsi').isLength({ min: 10, max: 1000 }).withMessage('Deskripsi 10-1000 chars'),
    body('alamat').optional().isString(),
    body('rt_rw').optional().isString(),
    // Allow URLs with localhost for development, or any http/https URL
    body('foto_url').optional().custom((value) => {
      if (!value) return true;
      // Accept http:// or https:// URLs (including localhost for dev)
      const urlPattern = /^https?:\/\/.+/i;
      if (!urlPattern.test(value)) {
        throw new Error('foto_url must be a valid URL');
      }
      return true;
    }),
  ],
  validate,
  handleCreateComplaint
);

router.get('/', handleGetComplaints);
router.get('/statistics', handleGetComplaintStatistics);
router.get('/:id', handleGetComplaintById);

// Check complaint status with ownership validation (user via AI)
router.post(
  '/:id/check',
  internalAuth,
  [
    // Accept WhatsApp phone (628xxx) or webchat session (web_xxx)
    body('wa_user_id').optional().matches(/^(628\d{8,12}|web_[a-z0-9_]+)$/i).withMessage('Invalid user ID format'),
  ],
  validate,
  handleCheckComplaintStatus
);

router.patch(
  '/:id/status',
  [
    body('status')
      .isIn(['OPEN', 'PROCESS', 'DONE', 'CANCELED', 'REJECT'])
      .withMessage('Invalid status'),
    body('admin_notes').optional().isString(),
  ],
  validate,
  handleUpdateComplaintStatus
);

router.post(
  '/:id/cancel',
  internalAuth,
  [
    // Accept WhatsApp phone (628xxx) or webchat session (web_xxx)
    body('wa_user_id').optional().matches(/^(628\d{8,12}|web_[a-z0-9_]+)$/i).withMessage('Invalid user ID format'),
    body('cancel_reason').isString().notEmpty().withMessage('cancel_reason wajib diisi'),
  ],
  validate,
  handleCancelComplaint
);

router.patch(
  '/:id/update',
  internalAuth,
  [
    body('wa_user_id').optional().matches(/^(628\d{8,12}|web_[a-z0-9_]+)$/i).withMessage('Invalid user ID format'),
    body('alamat').optional().isString(),
    body('deskripsi').optional().isString(),
    body('rt_rw').optional().isString(),
  ],
  validate,
  handleUpdateComplaintByUser
);

export default router;
