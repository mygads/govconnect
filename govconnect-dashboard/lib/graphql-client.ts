/**
 * Public Form REST Client (deprecated)
 *
 * Gunakan endpoint REST di folder /app/api untuk integrasi form publik.
 */

export class ApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

export async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const message = await response.text();
    throw new ApiError(message || 'Request failed', response.status);
  }
  return response.json() as Promise<T>;
}
