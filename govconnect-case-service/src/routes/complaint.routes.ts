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
      .isString()
      .notEmpty()
      .withMessage('kategori wajib diisi'),
    body('deskripsi').isLength({ min: 10, max: 1000 }).withMessage('Deskripsi 10-1000 chars'),
    body('alamat').optional().isString(),
    body('rt_rw').optional().isString(),
    // Allow single URL or JSON array of URLs (for multi-photo support, max 5)
    body('foto_url').optional().custom((value) => {
      if (!value) return true;
      const urlPattern = /^https?:\/\/.+/i;
      
      // Check if it's a JSON array string (multi-photo)
      if (value.startsWith('[')) {
        try {
          const urls = JSON.parse(value);
          if (!Array.isArray(urls) || urls.length === 0) {
            throw new Error('foto_url JSON array must not be empty');
          }
          if (urls.length > 5) {
            throw new Error('foto_url supports max 5 photos');
          }
          for (const url of urls) {
            if (typeof url !== 'string' || !urlPattern.test(url)) {
              throw new Error('Each foto_url in array must be a valid URL');
            }
          }
          return true;
        } catch (e: any) {
          if (e.message.includes('foto_url')) throw e;
          throw new Error('foto_url must be a valid URL or JSON array of URLs');
        }
      }
      
      // Single URL (backward compatible)
      if (!urlPattern.test(value)) {
        throw new Error('foto_url must be a valid URL');
      }
      return true;
    }),
  ],
  validate,
  handleCreateComplaint
);

router.get('/', internalAuth, handleGetComplaints);
router.get('/statistics', handleGetComplaintStatistics);
router.get('/:id', internalAuth, handleGetComplaintById);

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
  internalAuth,
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
