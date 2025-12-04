import { Router } from 'express';
import { handleGetUserHistory } from '../controllers/user.controller';
import { internalAuth } from '../middleware/auth.middleware';

const router: Router = Router();

/**
 * @swagger
 * /user/{wa_user_id}/history:
 *   get:
 *     tags: [User]
 *     summary: Get user history
 *     description: Get user's complaint and ticket history (internal API - called by AI Service)
 *     security:
 *       - InternalApiKey: []
 *     parameters:
 *       - in: path
 *         name: wa_user_id
 *         required: true
 *         schema:
 *           type: string
 *         description: WhatsApp User ID
 *     responses:
 *       200:
 *         description: User history retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 complaints:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Complaint'
 *                 tickets:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Ticket'
 *       401:
 *         description: Unauthorized - Invalid API key
 *       404:
 *         description: User not found
 */
router.get('/:wa_user_id/history', internalAuth, handleGetUserHistory);

export default router;
