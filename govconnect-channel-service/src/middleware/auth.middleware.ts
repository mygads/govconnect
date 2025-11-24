import { Request, Response, NextFunction } from 'express';
import { config } from '../config/env';
import logger from '../utils/logger';

/**
 * Internal API authentication middleware
 * Validates X-Internal-API-Key header
 */
export function internalAuth(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-internal-api-key'] as string;

  if (!apiKey) {
    logger.warn('Internal API call without API key', { path: req.path });
    res.status(401).json({ error: 'Unauthorized: Missing API key' });
    return;
  }

  if (apiKey !== config.INTERNAL_API_KEY) {
    logger.warn('Internal API call with invalid API key', { path: req.path });
    res.status(403).json({ error: 'Forbidden: Invalid API key' });
    return;
  }

  next();
}
