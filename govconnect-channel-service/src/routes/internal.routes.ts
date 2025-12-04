import { Router } from 'express';
import { getMessages, sendMessage, setTyping } from '../controllers/internal.controller';
import {
  getStatus,
  connect,
  disconnect,
  logout,
  getQR,
  pair,
  getSettings,
  updateSettings,
} from '../controllers/whatsapp.controller';
import {
  handleStartTakeover,
  handleEndTakeover,
  handleGetActiveTakeovers,
  handleCheckTakeover,
  handleGetConversations,
  handleGetConversation,
  handleAdminSendMessage,
  handleMarkAsRead,
  handleDeleteConversation,
  handleRetryAI,
} from '../controllers/livechat.controller';
import { internalAuth } from '../middleware/auth.middleware';
import {
  validateGetMessages,
  validateSendMessage,
} from '../middleware/validation.middleware';

const router = Router();

// All internal routes require authentication
router.use(internalAuth);

/**
 * @swagger
 * /internal/messages:
 *   get:
 *     tags: [Internal]
 *     summary: Get message history
 *     description: Get message history for a specific WhatsApp user (FIFO 30 messages)
 *     security:
 *       - InternalApiKey: []
 *     parameters:
 *       - in: query
 *         name: wa_user_id
 *         required: true
 *         schema:
 *           type: string
 *         description: WhatsApp user ID (phone number)
 *         example: "6281234567890"
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 30
 *         description: Maximum number of messages to return
 *     responses:
 *       200:
 *         description: Message history
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 messages:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Message'
 *       401:
 *         description: Unauthorized - Invalid API key
 *       400:
 *         description: Bad request - Missing wa_user_id
 */
router.get('/messages', validateGetMessages, getMessages);

/**
 * @swagger
 * /internal/send:
 *   post:
 *     tags: [Internal]
 *     summary: Send WhatsApp message
 *     description: Send a message to a WhatsApp user via Genfity gateway
 *     security:
 *       - InternalApiKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SendMessageRequest'
 *     responses:
 *       200:
 *         description: Message sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SendMessageResponse'
 *       401:
 *         description: Unauthorized
 *       400:
 *         description: Bad request
 *       500:
 *         description: Failed to send message
 */
router.post('/send', validateSendMessage, sendMessage);

/**
 * @swagger
 * /internal/typing:
 *   post:
 *     tags: [Internal]
 *     summary: Send typing indicator
 *     description: Send typing indicator to show bot is processing
 *     security:
 *       - InternalApiKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - wa_user_id
 *               - state
 *             properties:
 *               wa_user_id:
 *                 type: string
 *                 example: "6281234567890"
 *               state:
 *                 type: string
 *                 enum: [composing, paused, stop]
 *                 example: "composing"
 *     responses:
 *       200:
 *         description: Typing indicator sent
 *       401:
 *         description: Unauthorized
 */
router.post('/typing', setTyping);

// =====================================================
// WhatsApp Session Management Routes
// =====================================================

/**
 * @swagger
 * /internal/whatsapp/status:
 *   get:
 *     tags: [WhatsApp Session]
 *     summary: Get WhatsApp session status
 *     description: Get current WhatsApp connection status and info
 *     security:
 *       - InternalApiKey: []
 *     responses:
 *       200:
 *         description: Session status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 connected:
 *                   type: boolean
 *                 phone:
 *                   type: string
 *                 name:
 *                   type: string
 */
router.get('/whatsapp/status', getStatus);

/**
 * @swagger
 * /internal/whatsapp/connect:
 *   post:
 *     tags: [WhatsApp Session]
 *     summary: Connect WhatsApp session
 *     security:
 *       - InternalApiKey: []
 *     responses:
 *       200:
 *         description: Connection initiated
 */
router.post('/whatsapp/connect', connect);

/**
 * @swagger
 * /internal/whatsapp/disconnect:
 *   post:
 *     tags: [WhatsApp Session]
 *     summary: Disconnect WhatsApp session
 *     description: Disconnect but keep session data for reconnection
 *     security:
 *       - InternalApiKey: []
 *     responses:
 *       200:
 *         description: Disconnected
 */
router.post('/whatsapp/disconnect', disconnect);

/**
 * @swagger
 * /internal/whatsapp/logout:
 *   post:
 *     tags: [WhatsApp Session]
 *     summary: Logout WhatsApp session
 *     description: Full logout - requires QR scan to reconnect
 *     security:
 *       - InternalApiKey: []
 *     responses:
 *       200:
 *         description: Logged out
 */
router.post('/whatsapp/logout', logout);

/**
 * @swagger
 * /internal/whatsapp/qr:
 *   get:
 *     tags: [WhatsApp Session]
 *     summary: Get QR code for authentication
 *     security:
 *       - InternalApiKey: []
 *     responses:
 *       200:
 *         description: QR code data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 qr:
 *                   type: string
 *                   description: QR code string or base64 image
 */
router.get('/whatsapp/qr', getQR);

/**
 * @swagger
 * /internal/whatsapp/pairphone:
 *   post:
 *     tags: [WhatsApp Session]
 *     summary: Pair phone for authentication
 *     security:
 *       - InternalApiKey: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               phone:
 *                 type: string
 *                 example: "6281234567890"
 *     responses:
 *       200:
 *         description: Pairing code sent
 */
router.post('/whatsapp/pairphone', pair);

/**
 * @swagger
 * /internal/whatsapp/settings:
 *   get:
 *     tags: [WhatsApp Session]
 *     summary: Get session settings
 *     security:
 *       - InternalApiKey: []
 *     responses:
 *       200:
 *         description: Current settings
 */
router.get('/whatsapp/settings', getSettings);

/**
 * @swagger
 * /internal/whatsapp/settings:
 *   patch:
 *     tags: [WhatsApp Session]
 *     summary: Update session settings
 *     security:
 *       - InternalApiKey: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Settings updated
 */
router.patch('/whatsapp/settings', updateSettings);

// =====================================================
// Live Chat & Takeover Routes
// =====================================================

/**
 * @swagger
 * /internal/takeover/{wa_user_id}:
 *   post:
 *     tags: [Live Chat]
 *     summary: Start takeover
 *     description: Admin takes control of conversation from AI
 *     security:
 *       - InternalApiKey: []
 *     parameters:
 *       - in: path
 *         name: wa_user_id
 *         required: true
 *         schema:
 *           type: string
 *         example: "6281234567890"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - admin_id
 *               - admin_name
 *             properties:
 *               admin_id:
 *                 type: string
 *               admin_name:
 *                 type: string
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Takeover started
 *       409:
 *         description: Already in takeover by another admin
 */
router.post('/takeover/:wa_user_id', handleStartTakeover);

/**
 * @swagger
 * /internal/takeover/{wa_user_id}:
 *   delete:
 *     tags: [Live Chat]
 *     summary: End takeover
 *     description: Return control to AI
 *     security:
 *       - InternalApiKey: []
 *     parameters:
 *       - in: path
 *         name: wa_user_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Takeover ended
 */
router.delete('/takeover/:wa_user_id', handleEndTakeover);

/**
 * @swagger
 * /internal/takeover:
 *   get:
 *     tags: [Live Chat]
 *     summary: Get active takeovers
 *     description: List all conversations currently in takeover mode
 *     security:
 *       - InternalApiKey: []
 *     responses:
 *       200:
 *         description: List of active takeovers
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   wa_user_id:
 *                     type: string
 *                   admin_id:
 *                     type: string
 *                   admin_name:
 *                     type: string
 *                   started_at:
 *                     type: string
 *                     format: date-time
 */
router.get('/takeover', handleGetActiveTakeovers);

/**
 * @swagger
 * /internal/takeover/{wa_user_id}/status:
 *   get:
 *     tags: [Live Chat]
 *     summary: Check takeover status
 *     security:
 *       - InternalApiKey: []
 *     parameters:
 *       - in: path
 *         name: wa_user_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Takeover status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 is_takeover:
 *                   type: boolean
 *                 admin_id:
 *                   type: string
 *                 admin_name:
 *                   type: string
 */
router.get('/takeover/:wa_user_id/status', handleCheckTakeover);

/**
 * @swagger
 * /internal/conversations:
 *   get:
 *     tags: [Live Chat]
 *     summary: Get all conversations
 *     security:
 *       - InternalApiKey: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [all, ai, takeover]
 *         description: Filter by conversation status
 *     responses:
 *       200:
 *         description: List of conversations
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Conversation'
 */
router.get('/conversations', handleGetConversations);

/**
 * @swagger
 * /internal/conversations/{wa_user_id}:
 *   get:
 *     tags: [Live Chat]
 *     summary: Get conversation detail
 *     description: Get a specific conversation with message history
 *     security:
 *       - InternalApiKey: []
 *     parameters:
 *       - in: path
 *         name: wa_user_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Conversation with messages
 */
router.get('/conversations/:wa_user_id', handleGetConversation);

/**
 * @swagger
 * /internal/conversations/{wa_user_id}/send:
 *   post:
 *     tags: [Live Chat]
 *     summary: Admin send message
 *     description: Send a message as admin (during takeover)
 *     security:
 *       - InternalApiKey: []
 *     parameters:
 *       - in: path
 *         name: wa_user_id
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
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *                 example: "Terima kasih, laporan Anda sudah kami terima"
 *     responses:
 *       200:
 *         description: Message sent
 */
router.post('/conversations/:wa_user_id/send', handleAdminSendMessage);

/**
 * @swagger
 * /internal/conversations/{wa_user_id}/read:
 *   post:
 *     tags: [Live Chat]
 *     summary: Mark as read
 *     description: Mark a conversation as read
 *     security:
 *       - InternalApiKey: []
 *     parameters:
 *       - in: path
 *         name: wa_user_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Marked as read
 */
router.post('/conversations/:wa_user_id/read', handleMarkAsRead);

/**
 * @swagger
 * /internal/conversations/{wa_user_id}/retry:
 *   post:
 *     tags: [Live Chat]
 *     summary: Retry AI processing
 *     description: Retry AI processing for a failed message
 *     security:
 *       - InternalApiKey: []
 *     parameters:
 *       - in: path
 *         name: wa_user_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Retry initiated
 */
router.post('/conversations/:wa_user_id/retry', handleRetryAI);

/**
 * @swagger
 * /internal/conversations/{wa_user_id}:
 *   delete:
 *     tags: [Live Chat]
 *     summary: Delete conversation
 *     description: Delete conversation and all message history
 *     security:
 *       - InternalApiKey: []
 *     parameters:
 *       - in: path
 *         name: wa_user_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Conversation deleted
 */
router.delete('/conversations/:wa_user_id', handleDeleteConversation);

export default router;
