import { Request, Response, NextFunction } from 'express';
import { body, query, validationResult } from 'express-validator';
import logger from '../utils/logger';

// ==================== WEBHOOK ORIGIN VERIFICATION (Temuan 10) ====================

/**
 * IP Allowlist untuk webhook — hanya terima request dari IP Genfity-WA yang dikenal.
 *
 * Catatan arsitektur:
 * Genfity-WA (wa-support-v2) TIDAK mengirim header HMAC signature dan
 * CreateSessionRequest TIDAK punya field webhook_secret, sehingga HMAC
 * tidak bisa diterapkan tanpa modifikasi sisi server WA.
 *
 * Strategi pengganti (defense-in-depth):
 * 1. IP allowlist — hanya terima webhook dari IP yang dikenali (layer ini)
 * 2. instanceName validation — payload harus berisi instanceName yang match session di DB
 *    (sudah ada di webhook controller via resolveVillageIdFromInstanceName)
 * 3. WA_WEBHOOK_VERIFY_TOKEN — untuk GET verification challenge (sudah ada)
 *
 * Env var: WEBHOOK_ALLOWED_IPS (comma-separated, opsional)
 * Jika kosong → verifikasi IP dilewati (dev mode / trust reverse proxy).
 */
const ALLOWED_IPS = (process.env.WEBHOOK_ALLOWED_IPS || '')
  .split(',')
  .map(ip => ip.trim())
  .filter(Boolean);

export function verifyWebhookOrigin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Skip if no allowlist configured (development / behind trusted reverse proxy)
  if (ALLOWED_IPS.length === 0) {
    return next();
  }

  // Extract client IP — support reverse proxy (X-Forwarded-For) and direct connection
  const forwardedFor = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim();
  const clientIp = forwardedFor || req.ip || req.socket?.remoteAddress || '';

  // Normalize IPv6-mapped IPv4 (::ffff:1.2.3.4 → 1.2.3.4)
  const normalizedIp = clientIp.replace(/^::ffff:/, '');

  if (!ALLOWED_IPS.includes(normalizedIp)) {
    logger.warn('Webhook rejected: IP not in allowlist', {
      clientIp: normalizedIp,
      allowedIps: ALLOWED_IPS,
    });
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  next();
}

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
 * Supports both wa_user_id and channel_identifier query params
 */
export const validateGetMessages = [
  query('village_id')
    .optional()
    .isString()
    .isLength({ min: 1, max: 100 }),
  query('wa_user_id')
    .optional()
    .isString()
    .custom((value) => {
      if (!value) return true;
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
  query('channel_identifier')
    .optional()
    .isString()
    .custom((value) => {
      if (!value) return true;
      // Accept Indonesian phone number format
      if (/^628\d{8,12}$/.test(value)) {
        return true;
      }
      // Accept webchat session ID format (web_xxx)
      if (/^web_[a-z0-9_]+$/i.test(value)) {
        return true;
      }
      throw new Error('channel_identifier must be valid Indonesian phone number or webchat session ID');
    }),
  // Custom validation: at least one of wa_user_id or channel_identifier must be provided
  (req: any, res: any, next: any) => {
    const waUserId = req.query?.wa_user_id;
    const channelIdentifier = req.query?.channel_identifier;
    if (!waUserId && !channelIdentifier) {
      return res.status(400).json({
        error: 'Either wa_user_id or channel_identifier query parameter is required',
        messages: [],
        total: 0,
      });
    }
    next();
  },
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('limit must be between 1 and 100'),
  handleValidationErrors,
];
