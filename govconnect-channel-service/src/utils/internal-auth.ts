import crypto from 'crypto';

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

export function internalApiKeyMatches(
  providedValue: string | string[] | undefined,
  expectedValue: string,
): boolean {
  const provided = normalizeHeaderValue(providedValue);
  const expected = expectedValue?.trim();

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
