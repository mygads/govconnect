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
 * Validate webhook payload from genfity-wa
 * 
 * genfity-wa sends webhooks in two formats:
 * 1. JSON mode: { type: "Message", event: {...} }
 * 2. Form mode: { jsonData: "{...}", userID: "...", instanceName: "..." }
 * 
 * We accept both formats - validation is minimal to allow webhook through
 */
export const validateWebhookPayload = [
  // Custom validator that accepts both genfity-wa formats
  body().custom((_value, { req }) => {
    const body = req.body;
    
    // Check for genfity-wa JSON mode (has 'type' field)
    if (body.type && typeof body.type === 'string') {
      return true;
    }
    
    // Check for genfity-wa form mode (has 'jsonData' field)
    if (body.jsonData && typeof body.jsonData === 'string') {
      return true;
    }
    
    // Check for WhatsApp Cloud API format (has 'entry' array) - backward compatibility
    if (body.entry && Array.isArray(body.entry)) {
      return true;
    }
    
    throw new Error('Invalid webhook payload format. Expected genfity-wa or WhatsApp Cloud API format.');
  }),
  handleValidationErrors,
];

/**
 * Validate send message request
 * Accepts both Indonesian phone numbers (628xxx) and webchat session IDs (web_xxx)
 */
export const validateSendMessage = [
  body('village_id')
    .optional()
    .isString()
    .isLength({ min: 1, max: 100 }),
  body('wa_user_id')
    .isString()
    .custom((value) => {
      // Accept Indonesian phone number format
      if (/^628\d{8,12}$/.test(value)) {
        return true;
      }
      // Accept webchat session ID format (web_xxx)
      if (/^web_[a-z0-9_]+$/i.test(value)) {
        return true;
      }
      throw new Error('wa_user_id must be valid Indonesian phone number or webchat session ID');
    }),
  body('message')
    .isString()
    .isLength({ min: 1, max: 4096 })
    .withMessage('message must be between 1 and 4096 characters'),
  handleValidationErrors,
];

/**
 * Validate get messages query
 * Accepts both Indonesian phone numbers (628xxx) and webchat session IDs (web_xxx)
 */
export const validateGetMessages = [
  query('village_id')
    .optional()
    .isString()
    .isLength({ min: 1, max: 100 }),
  query('wa_user_id')
    .isString()
    .custom((value) => {
      // Accept Indonesian phone number format
      if (/^628\d{8,12}$/.test(value)) {
        return true;
      }
      // Accept webchat session ID format (web_xxx)
      if (/^web_[a-z0-9_]+$/i.test(value)) {
        return true;
      }
      throw new Error('wa_user_id must be valid Indonesian phone number or webchat session ID');
    }),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('limit must be between 1 and 100'),
  handleValidationErrors,
];
