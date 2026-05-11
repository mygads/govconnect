// Notification Settings Types and Utilities
// NOTE: urgentCategories is now determined by ComplaintType.is_urgent in database

export interface NotificationSettings {
  enabled: boolean;
  urgentNotifications: boolean;
  soundEnabled: boolean;
  urgentCategories: string[];
  adminNotificationNumber: string;
  villageId?: string;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  urgentNotifications: true,
  soundEnabled: true,
  urgentCategories: [],
  adminNotificationNumber: '',
};

function getLocalStorageKey(villageId?: string | null): string {
  return villageId ? `notificationSettings:${villageId}` : 'notificationSettings';
}

export function getNotificationSettings(villageId?: string | null): NotificationSettings {
  if (typeof window === 'undefined') return DEFAULT_NOTIFICATION_SETTINGS;

  try {
    const stored = localStorage.getItem(getLocalStorageKey(villageId));
    if (stored) {
      return { ...DEFAULT_NOTIFICATION_SETTINGS, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.error('Failed to parse notification settings:', e);
  }
  return DEFAULT_NOTIFICATION_SETTINGS;
}

export function saveNotificationSettings(settings: NotificationSettings, villageId?: string | null): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(getLocalStorageKey(villageId || settings.villageId), JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save notification settings:', e);
  }
}

export function mergeNotificationSettings(
  base: Partial<NotificationSettings> | null | undefined,
  local?: Partial<NotificationSettings> | null,
): NotificationSettings {
  return {
    ...DEFAULT_NOTIFICATION_SETTINGS,
    ...(base || {}),
    ...(local || {}),
    urgentCategories: Array.isArray(local?.urgentCategories)
      ? local!.urgentCategories
      : Array.isArray(base?.urgentCategories)
        ? base!.urgentCategories
        : DEFAULT_NOTIFICATION_SETTINGS.urgentCategories,
  };
}

export async function fetchNotificationSettings(): Promise<NotificationSettings> {
  const response = await fetch('/api/settings/notifications', {
    credentials: 'same-origin',
    cache: 'no-store',
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || 'Gagal memuat pengaturan notifikasi');
  }

  const data = await response.json();
  const remote = data?.data || {};
  const local = getNotificationSettings(remote.villageId);
  return mergeNotificationSettings(remote, {
    soundEnabled: local.soundEnabled,
    villageId: remote.villageId,
  });
}

export async function persistNotificationSettings(settings: NotificationSettings): Promise<NotificationSettings> {
  const response = await fetch('/api/settings/notifications', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      enabled: settings.enabled,
      urgentNotifications: settings.urgentNotifications,
      soundEnabled: settings.soundEnabled,
      adminNotificationNumber: settings.adminNotificationNumber,
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || 'Gagal menyimpan pengaturan notifikasi');
  }

  const data = await response.json();
  const remote = data?.data || {};
  const merged = mergeNotificationSettings(remote, {
    soundEnabled: settings.soundEnabled,
    urgentCategories: settings.urgentCategories,
    villageId: remote.villageId,
  });
  saveNotificationSettings(merged, remote.villageId);
  return merged;
}

export function playNotificationSound(type: 'normal' | 'urgent' = 'normal', settings?: NotificationSettings): void {
  if (typeof window === 'undefined') return;

  const effectiveSettings = settings || getNotificationSettings();
  if (!effectiveSettings.soundEnabled) return;

  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    if (type === 'urgent') {
      oscillator.frequency.value = 880;
      oscillator.type = 'sine';
      gainNode.gain.value = 0.3;
      oscillator.start();

      setTimeout(() => { gainNode.gain.value = 0; }, 200);
      setTimeout(() => { gainNode.gain.value = 0.3; }, 300);
      setTimeout(() => { gainNode.gain.value = 0; }, 500);
      setTimeout(() => { gainNode.gain.value = 0.3; }, 600);
      setTimeout(() => { oscillator.stop(); }, 800);
    } else {
      oscillator.frequency.value = 523.25;
      oscillator.type = 'sine';
      gainNode.gain.value = 0.2;
      oscillator.start();
      setTimeout(() => { oscillator.stop(); }, 150);
    }
  } catch (e) {
    console.error('Failed to play notification sound:', e);
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;

  if (Notification.permission === 'granted') return true;

  const permission = await Notification.requestPermission();
  return permission === 'granted';
}

export function showBrowserNotification(
  title: string,
  body: string,
  options?: { urgent?: boolean; onClick?: () => void; settings?: NotificationSettings }
): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const settings = options?.settings || getNotificationSettings();
  if (!settings.enabled) return;
  if (options?.urgent && !settings.urgentNotifications) return;

  const notification = new Notification(title, {
    body,
    icon: '/images/logo-light.svg',
    tag: options?.urgent ? 'urgent' : 'normal',
    requireInteraction: options?.urgent,
  });

  if (options?.onClick) {
    notification.onclick = options.onClick;
  }

  if (!options?.urgent) {
    setTimeout(() => notification.close(), 10000);
  }
}
