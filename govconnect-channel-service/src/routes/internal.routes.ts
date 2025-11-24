import { Router } from 'express';
import { getMessages, sendMessage } from '../controllers/internal.controller';
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

export default router;
