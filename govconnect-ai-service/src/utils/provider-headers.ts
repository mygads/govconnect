const AUTH_HEADER_BLACKLIST = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'x-goog-api-key',
  'api-key',
  'apikey',
  'x-auth-token',
]);

export function sanitizeProviderDefaultHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const headers: Record<string, string> = {};
  for (const [key, headerValue] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.trim().toLowerCase();
    if (AUTH_HEADER_BLACKLIST.has(normalizedKey)) continue;
    if (typeof headerValue === 'string' && headerValue.trim().length > 0) {
      headers[key] = headerValue;
    }
  }

  return headers;
}
