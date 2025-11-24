import { Request, Response, NextFunction } from 'express';
import { body, query, validationResult } from 'express-validator';
import logger from '../utils/logger';

/**
 * Handle validation errors
 */
export function handleValidationErrors(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    logger.warn('Validation failed', {
      path: req.path,
      errors: errors.array(),
    });

    res.status(400).json({
      error: 'Validation failed',
      details: errors.array(),
    });
    return;
  }

  next();
}

/**
 * Validate webhook payload
 */
export const validateWebhookPayload = [
  body('entry').isArray().withMessage('entry must be an array'),
  body('entry.*.changes').isArray().withMessage('changes must be an array'),
  handleValidationErrors,
];

/**
 * Validate send message request
 */
export const validateSendMessage = [
  body('wa_user_id')
    .isString()
    .matches(/^628\d{8,12}$/)
    .withMessage('wa_user_id must be valid Indonesian phone number'),
  body('message')
    .isString()
    .isLength({ min: 1, max: 4096 })
    .withMessage('message must be between 1 and 4096 characters'),
  handleValidationErrors,
];

/**
 * Validate get messages query
 */
export const validateGetMessages = [
  query('wa_user_id')
    .isString()
    .matches(/^628\d{8,12}$/)
    .withMessage('wa_user_id must be valid Indonesian phone number'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('limit must be between 1 and 100'),
  handleValidationErrors,
];
