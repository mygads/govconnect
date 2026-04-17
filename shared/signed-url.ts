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

const SIGNED_URL_SECRET = process.env.SIGNED_URL_SECRET || process.env.INTERNAL_API_KEY || '';
const DEFAULT_TTL = parseInt(process.env.SIGNED_URL_TTL || '3600', 10);

/**
 * Generate a signed URL for a local file path.
 * Format: /files/<path>?expires=<unix>&sig=<hmac>
 */
export function generateSignedUrl(
  basePath: string,
  filePath: string,
  ttlSeconds: number = DEFAULT_TTL,
): string {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const data = `${filePath}:${expires}`;
  const sig = crypto
    .createHmac('sha256', SIGNED_URL_SECRET)
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

  // Verify HMAC
  const data = `${filePath}:${expiresNum}`;
  const expectedSig = crypto
    .createHmac('sha256', SIGNED_URL_SECRET)
    .update(data)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSig),
  );
}

/**
 * Express middleware for verifying signed URLs on static file routes.
 * Allows service-token-authenticated requests to pass through.
 */
export function signedUrlMiddleware() {
  return (req: any, res: any, next: any) => {
    // Allow internal service calls with API key
    const apiKey = req.headers['x-internal-api-key'] || req.headers['x-service-token'];
    if (apiKey && apiKey === (process.env.INTERNAL_API_KEY || '')) {
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
