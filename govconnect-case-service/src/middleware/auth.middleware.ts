import { Request, Response, NextFunction } from 'express';
import { config } from '../config/env';
import logger from '../utils/logger';
import { internalApiKeyMatches } from '../utils/internal-auth';

/**
 * Internal API authentication middleware
 * Verifies X-Internal-API-Key header
 */
export function internalAuth(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-internal-api-key'];
  
  if (!internalApiKeyMatches(apiKey, config.internalApiKey)) {
    logger.warn('Unauthorized internal API access attempt', {
      ip: req.ip,
      path: req.path,
    });
    
    return res.status(403).json({
      error: 'Forbidden: Invalid API key',
    });
  }
  
  next();
}
