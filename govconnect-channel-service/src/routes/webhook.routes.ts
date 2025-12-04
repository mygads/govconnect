import { Router } from 'express';
import { handleWebhook, verifyWebhook } from '../controllers/webhook.controller';
import { validateWebhookPayload } from '../middleware/validation.middleware';

const router = Router();

/**
 * @swagger
 * /webhook/whatsapp:
 *   get:
 *     tags: [Webhook]
 *     summary: WhatsApp webhook verification
 *     description: |
 *       Endpoint untuk verifikasi webhook WhatsApp.
 *       WhatsApp akan mengirim GET request dengan challenge untuk memverifikasi endpoint.
 *     parameters:
 *       - in: query
 *         name: hub.mode
 *         required: true
 *         schema:
 *           type: string
 *           enum: [subscribe]
 *         description: Mode subscription
 *       - in: query
 *         name: hub.verify_token
 *         required: true
 *         schema:
 *           type: string
 *         description: Token verifikasi yang harus cocok dengan server
 *       - in: query
 *         name: hub.challenge
 *         required: true
 *         schema:
 *           type: string
 *         description: Challenge string yang harus dikembalikan
 *     responses:
 *       200:
 *         description: Verification successful - returns challenge
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *       403:
 *         description: Invalid verify token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/whatsapp', verifyWebhook);

/**
 * @swagger
 * /webhook/whatsapp:
 *   post:
 *     tags: [Webhook]
 *     summary: Receive WhatsApp messages
 *     description: |
 *       Endpoint untuk menerima pesan dari WhatsApp via Genfity gateway.
 *       Pesan akan diproses dan diteruskan ke AI Service untuk response.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               jid:
 *                 type: string
 *                 description: WhatsApp JID (phone@s.whatsapp.net)
 *                 example: "6281234567890@s.whatsapp.net"
 *               pushName:
 *                 type: string
 *                 description: Nama user WhatsApp
 *                 example: "John Doe"
 *               message:
 *                 type: object
 *                 properties:
 *                   conversation:
 *                     type: string
 *                     description: Pesan teks
 *                     example: "Saya ingin melapor jalan rusak"
 *                   extendedTextMessage:
 *                     type: object
 *                     properties:
 *                       text:
 *                         type: string
 *               messageTimestamp:
 *                 type: integer
 *                 description: Unix timestamp
 *     responses:
 *       200:
 *         description: Message received and queued for processing
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "received"
 *                 message_id:
 *                   type: string
 *       400:
 *         description: Invalid payload
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/whatsapp', validateWebhookPayload, handleWebhook);

export default router;
