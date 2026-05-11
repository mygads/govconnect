import { Router } from 'express';
import { internalAuth } from '../middleware/auth.middleware';
import { handleDeliveryCallback } from '../controllers/internal.controller';

const router: Router = Router();

router.post('/delivery-callback', internalAuth, handleDeliveryCallback);

export default router;
