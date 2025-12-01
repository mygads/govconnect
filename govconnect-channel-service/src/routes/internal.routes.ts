import { Router } from 'express';
import { getMessages, sendMessage } from '../controllers/internal.controller';
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
import { internalAuth } from '../middleware/auth.middleware';
import {
  validateGetMessages,
  validateSendMessage,
} from '../middleware/validation.middleware';

const router = Router();

// All internal routes require authentication
router.use(internalAuth);

/**
 * GET /internal/messages?wa_user_id=xxx&limit=30
 * Get message history for a user
 */
router.get('/messages', validateGetMessages, getMessages);

/**
 * POST /internal/send
 * Send a message via WhatsApp
 */
router.post('/send', validateSendMessage, sendMessage);

// =====================================================
// WhatsApp Session Management Routes
// =====================================================

/**
 * GET /internal/whatsapp/status
 * Get WhatsApp session status
 */
router.get('/whatsapp/status', getStatus);

/**
 * POST /internal/whatsapp/connect
 * Connect WhatsApp session
 */
router.post('/whatsapp/connect', connect);

/**
 * POST /internal/whatsapp/disconnect
 * Disconnect WhatsApp session (keeps session data)
 */
router.post('/whatsapp/disconnect', disconnect);

/**
 * POST /internal/whatsapp/logout
 * Logout WhatsApp session (requires QR rescan)
 */
router.post('/whatsapp/logout', logout);

/**
 * GET /internal/whatsapp/qr
 * Get QR code for authentication
 */
router.get('/whatsapp/qr', getQR);

/**
 * POST /internal/whatsapp/pairphone
 * Pair phone for authentication
 */
router.post('/whatsapp/pairphone', pair);

/**
 * GET /internal/whatsapp/settings
 * Get session settings
 */
router.get('/whatsapp/settings', getSettings);

/**
 * PATCH /internal/whatsapp/settings
 * Update session settings
 */
router.patch('/whatsapp/settings', updateSettings);

export default router;
