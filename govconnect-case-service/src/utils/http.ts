/* eslint-disable no-restricted-syntax */
import type { Request } from 'express';

export function getQueryString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'string' ? first : undefined;
  }
  return undefined;
}

export const firstQuery = getQueryString;

export function getQueryInt(value: unknown, defaultValue: number): number {
  const raw = getQueryString(value);
  if (!raw) return defaultValue;

  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getQuery(req: Request, key: string): string | undefined {
  return getQueryString((req.query as any)?.[key]);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getParam(req: Request, key: string): string | undefined {
  return getQueryString((req.params as any)?.[key]);
}
