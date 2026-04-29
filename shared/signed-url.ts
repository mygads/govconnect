/**
 * Signed URL Service (Fase 3.5)
 * 
 * Generates time-limited signed URLs for file access.
 * Supports both local file serving and S3/R2 presigned URLs.
 * 
 * Environment:
 *   SIGNED_URL_SECRET  - HMAC secret for signing local URLs
 *   SIGNED_URL_TTL     - TTL in seconds (default: 3600 = 1 hour)
 *   S3_ENDPOINT        - If set, uses S3 presigned URLs instead
 */

import crypto from 'crypto';

const DEFAULT_TTL = parseInt(process.env.SIGNED_URL_TTL || '3600', 10);

function getSignedUrlSecret(): string {
  return process.env.SIGNED_URL_SECRET?.trim() || '';
}

function safeTimingEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return aBuf.length === bBuf.length && crypto.timingSafeEqual(aBuf, bBuf);
}

function internalApiKeyMatches(value: string | string[] | undefined): boolean {
  const expected = process.env.INTERNAL_API_KEY?.trim();
  const provided = Array.isArray(value) ? value[0]?.trim() : value?.trim();
  return Boolean(expected && provided && safeTimingEqual(provided, expected));
}

/**
 * Generate a signed URL for a local file path.
 * Format: /files/<path>?expires=<unix>&sig=<hmac>
 */
export function generateSignedUrl(
  basePath: string,
  filePath: string,
  ttlSeconds: number = DEFAULT_TTL,
): string {
  const secret = getSignedUrlSecret();
  if (!secret) {
    throw new Error('SIGNED_URL_SECRET is required to generate signed URLs');
  }

  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const data = `${filePath}:${expires}`;
  const sig = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('hex');

  return `${basePath}/${filePath}?expires=${expires}&sig=${sig}`;
}

/**
 * Verify a signed URL's signature and expiry.
 * Returns true if valid.
 */
export function verifySignedUrl(
  filePath: string,
  expires: string | number,
  signature: string,
): boolean {
  const expiresNum = typeof expires === 'string' ? parseInt(expires, 10) : expires;

  // Check expiry
  if (isNaN(expiresNum) || expiresNum < Math.floor(Date.now() / 1000)) {
    return false;
  }

  const secret = getSignedUrlSecret();
  if (!secret) {
    return false;
  }

  const data = `${filePath}:${expiresNum}`;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('hex');

  return safeTimingEqual(signature, expectedSig);
}

/**
 * Express middleware for verifying signed URLs on static file routes.
 * Allows service-token-authenticated requests to pass through.
 */
export function signedUrlMiddleware() {
  return (req: any, res: any, next: any) => {
    const apiKey = req.headers['x-internal-api-key'] || req.headers['x-service-token'];
    if (internalApiKeyMatches(apiKey)) {
      return next();
    }

    const { expires, sig } = req.query;
    if (!expires || !sig) {
      return res.status(403).json({ error: 'Signed URL required' });
    }

    // Extract file path from URL (remove query string and base path prefix)
    const filePath = req.path.replace(/^\//, '');

    if (!verifySignedUrl(filePath, expires, sig)) {
      return res.status(403).json({ error: 'Invalid or expired signed URL' });
    }

    next();
  };
}
