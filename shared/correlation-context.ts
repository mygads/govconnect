/**
 * Correlation ID context using AsyncLocalStorage
 * 
 * Propagates correlation IDs across async boundaries within a service,
 * enabling outgoing HTTP calls to forward the ID received from inbound requests.
 * 
 * Usage:
 *   1. In Express middleware: correlationMiddleware(req, res, next)
 *   2. In HTTP client interceptor: getCorrelationId() to retrieve current ID
 */

import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

interface CorrelationStore {
  correlationId: string;
}

export const correlationStorage = new AsyncLocalStorage<CorrelationStore>();

/**
 * Get the current correlation ID from AsyncLocalStorage.
 * Returns undefined if not inside a correlation context.
 */
export function getCorrelationId(): string | undefined {
  return correlationStorage.getStore()?.correlationId;
}

/**
 * Generate a new correlation ID
 */
export function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * Express middleware that extracts or generates a correlation ID,
 * stores it in AsyncLocalStorage, and sets it on the response.
 * 
 * Must be registered BEFORE routes.
 */
export function correlationMiddleware(req: any, res: any, next: any) {
  const correlationId = (req.headers['x-correlation-id'] as string) || generateCorrelationId();
  
  // Attach to request for backward compatibility with existing code
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);
  
  // Run the rest of the request inside AsyncLocalStorage context
  correlationStorage.run({ correlationId }, () => {
    next();
  });
}
