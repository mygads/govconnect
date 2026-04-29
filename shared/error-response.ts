export type ApiSuccessResponse<T = undefined> = T extends undefined
  ? { success: true }
  : { success: true; data: T };

export type ApiErrorResponse = {
  error: string;
} & Record<string, unknown>;

export function successResponse(): { success: true };
export function successResponse<T>(data: T): { success: true; data: T };
export function successResponse<T>(data?: T): { success: true } | { success: true; data: T } {
  if (data === undefined) return { success: true };
  return { success: true, data };
}

export function errorResponse(message: string, extra?: Record<string, unknown>): ApiErrorResponse {
  return { ...(extra || {}), error: message };
}
