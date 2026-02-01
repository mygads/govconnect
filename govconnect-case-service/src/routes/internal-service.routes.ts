import { Router } from 'express';
import { query } from 'express-validator';
import type { Router as ExpressRouter } from 'express';
import { internalAuth } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { InternalServiceController } from '../controllers/internal-service.controller';

const router: ExpressRouter = Router();

// Internal endpoint for AI: compact service search for LLM context
router.get(
  '/internal/services/search',
  internalAuth,
  [
    query('village_id').isString().notEmpty().withMessage('village_id is required'),
    query('q').isString().trim().isLength({ min: 1, max: 200 }).withMessage('q is required'),
  ],
  validate,
  InternalServiceController.searchServicesForAI
);

// Internal endpoint for AI: check service request status with simple ownership validation
router.get(
  '/internal/service-requests/status',
  internalAuth,
  [
    query('request_code').isString().trim().isLength({ min: 1, max: 80 }).withMessage('request_code is required'),
    query('phone_number').isString().trim().isLength({ min: 6, max: 30 }).withMessage('phone_number is required'),
  ],
  validate,
  InternalServiceController.checkRequestStatus
);

export default router;
