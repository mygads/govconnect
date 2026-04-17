/**
 * Correlation ID context using AsyncLocalStorage
 * 
 * Propagates correlation IDs across async boundaries within a service,
 * enabling outgoing HTTP calls to forward the ID received from inbound requests.
 */

import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

interface CorrelationStore {
  correlationId: string;
}

export const correlationStorage = new AsyncLocalStorage<CorrelationStore>();

export function getCorrelationId(): string | undefined {
  return correlationStorage.getStore()?.correlationId;
}

export function generateCorrelationId(): string {
  return randomUUID();
}

export function correlationMiddleware(req: any, res: any, next: any) {
  const correlationId = (req.headers['x-correlation-id'] as string) || generateCorrelationId();
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);
  correlationStorage.run({ correlationId }, () => {
    next();
  });
}
