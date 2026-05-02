import { Request, Response, NextFunction } from 'express';
import { body, query, validationResult } from 'express-validator';
import { createHmac, timingSafeEqual } from 'crypto';
import logger from '../utils/logger';
import prisma from '../config/database';
import { config } from '../config/env';
import { webhookCandidateFromBody } from '../utils/webhook-payload';

// ==================== WEBHOOK ORIGIN VERIFICATION (Temuan 10) ====================

/**
 * IP allowlist defense layer.
 *
 * Genfity-WA *does* sign outbound webhooks with `x-hmac-signature`
 * (hex HMAC-SHA256 of the raw body using the per-session secret configured
 * via /session/hmac/config). Use {@link verifyWebhookHmac} for cryptographic
 * verification; the IP allowlist below remains as a defence-in-depth.
 *
 * Env var: WEBHOOK_ALLOWED_IPS (comma-separated, optional)
 * Empty value disables the check (development / behind trusted reverse proxy).
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

  // Extract client IP. Only trust X-Forwarded-For when Express trust proxy is explicitly enabled.
  const forwardedFor = config.TRUST_PROXY
    ? (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    : undefined;
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

function verifySignature(rawBody: Buffer, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const provided = signature.startsWith('sha256=') ? signature.slice(7) : signature;

  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(provided, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function verifyWebhookHmac(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const required = config.WEBHOOK_HMAC_REQUIRED;
  const signature = (req.headers['x-hmac-signature'] as string | undefined)?.trim();
  const candidate = webhookCandidateFromBody(req.body || {});

  if (!signature) {
    if (required) {
      logger.warn('Webhook rejected: x-hmac-signature header missing', { candidate: candidate || 'unknown' });
      res.status(401).json({ error: 'Missing webhook signature' });
      return;
    }
    return next();
  }

  const rawBody: Buffer | undefined = (req as any).rawBody;
  if (!rawBody || rawBody.length === 0) {
    logger.warn('Webhook signature present but raw body unavailable', { candidate: candidate || 'unknown' });
    res.status(400).json({ error: 'Cannot verify signature: empty body' });
    return;
  }

  try {
    if (candidate) {
      const session = await prisma.wa_sessions.findFirst({
        where: {
          OR: [
            { instance_name: candidate },
            { village_id: candidate },
            { wa_support_session_id: candidate },
            { wa_number: candidate.replace(/@s\.whatsapp\.net$/i, '').replace(/:\d+$/, '').replace(/\D/g, '') },
          ],
        },
        select: { id: true, webhook_secret: true },
      });

      if (session?.webhook_secret && verifySignature(rawBody, signature, session.webhook_secret)) {
        return next();
      }

      if (session?.webhook_secret) {
        logger.warn('Webhook rejected: HMAC signature mismatch', { candidate });
        res.status(401).json({ error: 'Invalid webhook signature' });
        return;
      }
    }

    const signedSessions = await prisma.wa_sessions.findMany({
      where: { webhook_secret: { not: null } },
      select: { id: true, village_id: true, webhook_secret: true },
    });
    const matches = signedSessions.filter(session => session.webhook_secret && verifySignature(rawBody, signature, session.webhook_secret));

    if (matches.length === 1) return next();

    logger.warn('Webhook rejected: could not match HMAC signature to exactly one session', {
      candidate: candidate || 'unknown',
      matchedSessions: matches.length,
    });
    res.status(401).json({ error: 'Unknown signing key' });
  } catch (err: any) {
    logger.error('Webhook HMAC: session lookup failed', { error: err?.message });
    res.status(500).json({ error: 'HMAC verification failed' });
  }
}
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
