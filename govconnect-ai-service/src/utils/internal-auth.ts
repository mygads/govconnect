import type { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';
import { config } from '../config/env';

function normalizeHeaderValue(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === 'string' && item.trim().length > 0);
    return first ? first.trim() : null;
  }

  return null;
}

export function internalApiKeyMatches(value: string | string[] | undefined): boolean {
  const provided = normalizeHeaderValue(value);
  const expected = config.internalApiKey?.trim();

  if (!provided || !expected) {
    return false;
  }

  const providedBuf = Buffer.from(provided, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');

  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

export function requireInternalApiKey(req: Request, res: Response, next: NextFunction): void {
  if (!internalApiKeyMatches(req.headers['x-internal-api-key'])) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  next();
}
