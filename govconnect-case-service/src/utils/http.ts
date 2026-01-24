export function getQueryString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function getQueryInt(value: unknown, defaultValue: number): number {
  const raw = getQueryString(value);
  if (!raw) return defaultValue;

  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}
