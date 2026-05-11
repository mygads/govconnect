export function extractAdminNotificationNumber(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;

  const value = (payload as {
    data?: {
      config?: {
        admin_notification_number?: unknown;
      };
    };
  }).data?.config?.admin_notification_number;

  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
