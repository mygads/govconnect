import { Router } from 'express';
import { handleWebhook, verifyWebhook } from '../controllers/webhook.controller';
import { validateWebhookPayload } from '../middleware/validation.middleware';

const router = Router();

/**
 * GET /webhook/whatsapp - Webhook verification
 */
router.get('/whatsapp', verifyWebhook);

/**
 * POST /webhook/whatsapp - Receive WhatsApp messages
 */
router.post('/whatsapp', validateWebhookPayload, handleWebhook);

export default router;
