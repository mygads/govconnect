export function getQueryString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'string' ? first : undefined;
  }
  return undefined;
}

export function getParamString(value: unknown): string | undefined {
  return getQueryString(value);
}

export function getQueryInt(value: unknown, defaultValue: number): number {
  const raw = getQueryString(value);
  if (!raw) return defaultValue;

  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}
