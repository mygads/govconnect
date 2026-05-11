import { createHmac, timingSafeEqual } from 'crypto';

export function validateWebhookSignature(
  signature: string,
  body: string | Buffer,
  secret: string,
): boolean {
  if (!signature || !secret) return false;

  const provided = signature.trim().startsWith('sha256=')
    ? signature.trim().slice(7)
    : signature.trim();
  const expected = createHmac('sha256', secret).update(body).digest('hex');

  try {
    const expectedBuffer = Buffer.from(expected, 'hex');
    const providedBuffer = Buffer.from(provided, 'hex');
    return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
  } catch {
    return false;
  }
}
