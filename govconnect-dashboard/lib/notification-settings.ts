// Notification Settings Types and Utilities
// NOTE: urgentCategories is now determined by ComplaintType.is_urgent in database

export interface NotificationSettings {
  enabled: boolean;
  urgentNotifications: boolean;
  soundEnabled: boolean;
  urgentCategories: string[]; // Loaded from database, not hardcoded
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  urgentNotifications: true,
  soundEnabled: true,
  urgentCategories: [], // Will be loaded from database via API
};

// Get notification settings from localStorage
export function getNotificationSettings(): NotificationSettings {
  if (typeof window === 'undefined') return DEFAULT_NOTIFICATION_SETTINGS;
  
  try {
    const stored = localStorage.getItem('notificationSettings');
    if (stored) {
      return { ...DEFAULT_NOTIFICATION_SETTINGS, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.error('Failed to parse notification settings:', e);
  }
  return DEFAULT_NOTIFICATION_SETTINGS;
}

// Save notification settings to localStorage
export function saveNotificationSettings(settings: NotificationSettings): void {
  if (typeof window === 'undefined') return;
  
  try {
    localStorage.setItem('notificationSettings', JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save notification settings:', e);
  }
}

// Play notification sound
export function playNotificationSound(type: 'normal' | 'urgent' = 'normal'): void {
  if (typeof window === 'undefined') return;
  
  const settings = getNotificationSettings();
  if (!settings.soundEnabled) return;
  
  try {
    // Using Web Audio API for notification sounds
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    if (type === 'urgent') {
      // Urgent: Higher frequency, longer duration, pulsing
      oscillator.frequency.value = 880; // A5
      oscillator.type = 'sine';
      gainNode.gain.value = 0.3;
      oscillator.start();
      
      // Pulse effect
      setTimeout(() => { gainNode.gain.value = 0; }, 200);
      setTimeout(() => { gainNode.gain.value = 0.3; }, 300);
      setTimeout(() => { gainNode.gain.value = 0; }, 500);
      setTimeout(() => { gainNode.gain.value = 0.3; }, 600);
      setTimeout(() => { oscillator.stop(); }, 800);
    } else {
      // Normal: Single beep
      oscillator.frequency.value = 523.25; // C5
      oscillator.type = 'sine';
      gainNode.gain.value = 0.2;
      oscillator.start();
      setTimeout(() => { oscillator.stop(); }, 150);
    }
  } catch (e) {
    console.error('Failed to play notification sound:', e);
  }
}

// Request browser notification permission
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  
  if (Notification.permission === 'granted') return true;
  
  const permission = await Notification.requestPermission();
  return permission === 'granted';
}

// Show browser notification
export function showBrowserNotification(
  title: string, 
  body: string, 
  options?: { urgent?: boolean; onClick?: () => void }
): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  
  const settings = getNotificationSettings();
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
  
  // Auto close after 10 seconds for non-urgent
  if (!options?.urgent) {
    setTimeout(() => notification.close(), 10000);
  }
}
