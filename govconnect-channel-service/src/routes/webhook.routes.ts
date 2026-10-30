import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { handleWebhook, verifyWebhook } from '../controllers/webhook.controller';
import { validateWebhookPayload, verifyWebhookOrigin, verifyWebhookHmac } from '../middleware/validation.middleware';
import { webhookRateLimit } from '../middleware/webhook-rate-limit.middleware';

const router: ExpressRouter = Router();

// Routes with /whatsapp path
router.get('/whatsapp', verifyWebhook);
// W8: rate limit di webhook channel (per pengirim + instance, in-memory per process).
router.post('/whatsapp', verifyWebhookOrigin, verifyWebhookHmac, validateWebhookPayload, webhookRateLimit, handleWebhook);

// Also support root path for backward compatibility
// This allows webhook URL to be configured without /whatsapp suffix
router.get('/', verifyWebhook);
router.post('/', verifyWebhookOrigin, verifyWebhookHmac, validateWebhookPayload, webhookRateLimit, handleWebhook);

export default router;
