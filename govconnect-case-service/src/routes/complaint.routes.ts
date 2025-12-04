import { Router } from 'express';
import { body } from 'express-validator';
import {
  handleCreateComplaint,
  handleGetComplaints,
  handleGetComplaintById,
  handleUpdateComplaintStatus,
  handleGetComplaintStatistics,
  handleCancelComplaint,
} from '../controllers/complaint.controller';
import { internalAuth } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';

const router: Router = Router();

/**
 * @swagger
 * /laporan/create:
 *   post:
 *     tags: [Laporan]
 *     summary: Create new complaint
 *     description: Create a new complaint (from AI Service - internal only)
 *     security:
 *       - InternalApiKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateComplaintRequest'
 *     responses:
 *       201:
 *         description: Complaint created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Complaint'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
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

/**
 * @swagger
 * /laporan:
 *   get:
 *     tags: [Laporan]
 *     summary: Get complaints list
 *     description: Get paginated list of complaints with optional filters
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [baru, proses, selesai, ditolak]
 *         description: Filter by status
 *       - in: query
 *         name: kategori
 *         schema:
 *           type: string
 *         description: Filter by kategori
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Number of items per page
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Offset for pagination
 *     responses:
 *       200:
 *         description: List of complaints
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Complaint'
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 */
router.get('/', handleGetComplaints);

/**
 * @swagger
 * /laporan/statistics:
 *   get:
 *     tags: [Laporan]
 *     summary: Get complaint statistics
 *     description: Get statistics summary of complaints
 *     responses:
 *       200:
 *         description: Statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 total:
 *                   type: integer
 *                 byStatus:
 *                   type: object
 *                 byKategori:
 *                   type: object
 */
router.get('/statistics', handleGetComplaintStatistics);

/**
 * @swagger
 * /laporan/{id}:
 *   get:
 *     tags: [Laporan]
 *     summary: Get complaint by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Complaint ID (LAP-YYYYMMDD-XXX format or UUID)
 *     responses:
 *       200:
 *         description: Complaint detail
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Complaint'
 *       404:
 *         description: Complaint not found
 */
router.get('/:id', handleGetComplaintById);

/**
 * @swagger
 * /laporan/{id}/status:
 *   patch:
 *     tags: [Laporan]
 *     summary: Update complaint status
 *     description: Update status of a complaint (for Dashboard admin)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [baru, proses, selesai, ditolak]
 *               admin_notes:
 *                 type: string
 *                 description: Notes from admin
 *     responses:
 *       200:
 *         description: Status updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Complaint'
 *       404:
 *         description: Complaint not found
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

/**
 * @swagger
 * /laporan/{id}/cancel:
 *   post:
 *     tags: [Laporan]
 *     summary: Cancel complaint by user
 *     description: User cancels their own complaint (from AI Service)
 *     security:
 *       - InternalApiKey: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - wa_user_id
 *             properties:
 *               wa_user_id:
 *                 type: string
 *                 example: "6281234567890"
 *               cancel_reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Complaint cancelled
 *       404:
 *         description: Complaint not found
 */
router.post(
  '/:id/cancel',
  internalAuth,
  [
    body('wa_user_id').matches(/^628\d{8,12}$/).withMessage('Invalid phone number'),
    body('cancel_reason').optional().isString(),
  ],
  validate,
  handleCancelComplaint
);

export default router;
