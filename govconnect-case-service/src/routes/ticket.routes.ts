import { Router } from 'express';
import { body } from 'express-validator';
import {
  handleCreateTicket,
  handleGetTickets,
  handleGetTicketById,
  handleUpdateTicketStatus,
  handleGetTicketStatistics,
  handleCancelTicket,
} from '../controllers/ticket.controller';
import { internalAuth } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';

const router: Router = Router();

/**
 * @swagger
 * /tiket/create:
 *   post:
 *     tags: [Tiket]
 *     summary: Create new ticket
 *     description: Create a new service ticket (from AI Service - internal only)
 *     security:
 *       - InternalApiKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateTicketRequest'
 *     responses:
 *       201:
 *         description: Ticket created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Ticket'
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
    body('jenis')
      .isIn(['surat_keterangan', 'surat_pengantar', 'izin_keramaian'])
      .withMessage('Invalid jenis'),
    body('data_json').isObject().withMessage('data_json must be an object'),
  ],
  validate,
  handleCreateTicket
);

/**
 * @swagger
 * /tiket:
 *   get:
 *     tags: [Tiket]
 *     summary: Get tickets list
 *     description: Get paginated list of tickets with optional filters
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, proses, selesai, ditolak]
 *         description: Filter by status
 *       - in: query
 *         name: jenis
 *         schema:
 *           type: string
 *         description: Filter by jenis
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: List of tickets
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Ticket'
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 */
router.get('/', handleGetTickets);

/**
 * @swagger
 * /tiket/statistics:
 *   get:
 *     tags: [Tiket]
 *     summary: Get ticket statistics
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
 *                 byJenis:
 *                   type: object
 */
router.get('/statistics', handleGetTicketStatistics);

/**
 * @swagger
 * /tiket/{id}:
 *   get:
 *     tags: [Tiket]
 *     summary: Get ticket by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Ticket ID (TKT-YYYYMMDD-XXX format or UUID)
 *     responses:
 *       200:
 *         description: Ticket detail
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Ticket'
 *       404:
 *         description: Ticket not found
 */
router.get('/:id', handleGetTicketById);

/**
 * @swagger
 * /tiket/{id}/status:
 *   patch:
 *     tags: [Tiket]
 *     summary: Update ticket status
 *     description: Update status of a ticket (for Dashboard admin)
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
 *                 enum: [pending, proses, selesai, ditolak]
 *               admin_notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Status updated
 *       404:
 *         description: Ticket not found
 */
router.patch(
  '/:id/status',
  [
    body('status')
      .isIn(['pending', 'proses', 'selesai', 'ditolak'])
      .withMessage('Invalid status'),
    body('admin_notes').optional().isString(),
  ],
  validate,
  handleUpdateTicketStatus
);

/**
 * @swagger
 * /tiket/{id}/cancel:
 *   post:
 *     tags: [Tiket]
 *     summary: Cancel ticket by user
 *     description: User cancels their own ticket (from AI Service)
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
 *               cancel_reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Ticket cancelled
 *       404:
 *         description: Ticket not found
 */
router.post(
  '/:id/cancel',
  internalAuth,
  [
    body('wa_user_id').matches(/^628\d{8,12}$/).withMessage('Invalid phone number'),
    body('cancel_reason').optional().isString(),
  ],
  validate,
  handleCancelTicket
);

export default router;
