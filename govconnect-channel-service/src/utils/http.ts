/* eslint-disable no-restricted-syntax */
export function firstQuery(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'string' ? first : undefined;
  }
  return undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getQuery(req: import('express').Request, key: string): string | undefined {
  return firstQuery((req.query as any)?.[key]);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getParam(req: import('express').Request, key: string): string | undefined {
  return firstQuery((req.params as any)?.[key]);
}
