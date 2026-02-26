import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { handleWebhook, verifyWebhook } from '../controllers/webhook.controller';
import { validateWebhookPayload, verifyWebhookOrigin } from '../middleware/validation.middleware';

const router: ExpressRouter = Router();

// Routes with /whatsapp path
router.get('/whatsapp', verifyWebhook);
router.post('/whatsapp', verifyWebhookOrigin, validateWebhookPayload, handleWebhook);

// Also support root path for backward compatibility
// This allows webhook URL to be configured without /whatsapp suffix
router.get('/', verifyWebhook);
router.post('/', verifyWebhookOrigin, validateWebhookPayload, handleWebhook);

export default router;
