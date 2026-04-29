/**
 * Service-to-Service Signed Token Auth (Fase 3.4)
 * 
 * Replaces shared INTERNAL_API_KEY with per-service JWT identity.
 * Each service signs requests with its own identity, and receivers
 * verify both the signature and the caller's service name.
 * 
 * Environment:
 *   SERVICE_AUTH_SECRET - Shared signing secret (256-bit hex recommended)
 *   SERVICE_NAME        - Identity of this service (e.g. "ai-service", "dashboard")
 * 
 * Backward compatible: falls back to INTERNAL_API_KEY if SERVICE_AUTH_SECRET not set.
 */

import crypto from 'crypto';

const SERVICE_AUTH_SECRET = process.env.SERVICE_AUTH_SECRET || '';
const SERVICE_NAME = process.env.SERVICE_NAME || 'unknown';
const TOKEN_TTL_SECONDS = 300; // 5 minutes

function safeTimingEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return aBuf.length === bBuf.length && crypto.timingSafeEqual(aBuf, bBuf);
}

interface ServiceTokenPayload {
  sub: string;  // service name
  iat: number;  // issued at (unix seconds)
  exp: number;  // expiry (unix seconds)
}

/**
 * Generate a signed service token (HMAC-SHA256 JWT-like)
 */
export function generateServiceToken(serviceName?: string): string {
  const secret = SERVICE_AUTH_SECRET;
  if (!secret) {
    // Fallback to legacy INTERNAL_API_KEY
    return process.env.INTERNAL_API_KEY || '';
  }

  const now = Math.floor(Date.now() / 1000);
  const payload: ServiceTokenPayload = {
    sub: serviceName || SERVICE_NAME,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };

  const headerB64 = base64url(JSON.stringify({ alg: 'HS256', typ: 'SVC' }));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signature = hmacSign(`${headerB64}.${payloadB64}`, secret);

  return `${headerB64}.${payloadB64}.${signature}`;
}

/**
 * Verify a service token and return the caller's service name
 * Returns null if verification fails.
 */
export function verifyServiceToken(token: string): ServiceTokenPayload | null {
  const secret = SERVICE_AUTH_SECRET;

  // Fallback: if no secret configured, fall back to INTERNAL_API_KEY comparison
  if (!secret) {
    const legacyKey = process.env.INTERNAL_API_KEY || '';
    if (safeTimingEqual(token, legacyKey) && legacyKey) {
      return { sub: 'legacy', iat: 0, exp: Infinity };
    }
    return null;
  }

  // JWT-like verification
  const parts = token.split('.');
  if (parts.length !== 3) {
    // Maybe it's a legacy INTERNAL_API_KEY — check that too
    const legacyKey = process.env.INTERNAL_API_KEY || '';
    if (safeTimingEqual(token, legacyKey) && legacyKey) {
      return { sub: 'legacy', iat: 0, exp: Infinity };
    }
    return null;
  }

  const [headerB64, payloadB64, signature] = parts;
  const expectedSig = hmacSign(`${headerB64}.${payloadB64}`, secret);

  if (!safeTimingEqual(signature, expectedSig)) {
    return null;
  }

  try {
    const payload: ServiceTokenPayload = JSON.parse(base64urlDecode(payloadB64));
    const now = Math.floor(Date.now() / 1000);

    if (payload.exp < now) {
      return null; // Expired
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Express middleware for verifying service tokens.
 * Backward compatible with x-internal-api-key header.
 */
export function serviceAuthMiddleware(allowedServices?: string[]) {
  return (req: any, res: any, next: any) => {
    const token =
      req.headers['x-service-token'] ||
      req.headers['x-internal-api-key'] ||
      '';

    const payload = verifyServiceToken(token);

    if (!payload) {
      return res.status(403).json({ error: 'Forbidden: invalid service token' });
    }

    if (allowedServices && allowedServices.length > 0) {
      if (!allowedServices.includes(payload.sub) && payload.sub !== 'legacy') {
        return res.status(403).json({ error: `Forbidden: service ${payload.sub} not allowed` });
      }
    }

    // Attach service identity to request
    req.serviceIdentity = payload.sub;
    next();
  };
}

/**
 * Get auth headers for outgoing service-to-service calls
 */
export function getServiceAuthHeaders(): Record<string, string> {
  const token = generateServiceToken();
  // Send both headers for backward compatibility
  return {
    'x-service-token': token,
    'x-internal-api-key': token,
  };
}

// ==================== Helpers ====================

function base64url(str: string): string {
  return Buffer.from(str, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(str: string): string {
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

function hmacSign(data: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
