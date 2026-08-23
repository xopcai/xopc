import type { NotificationPreferences } from '@/features/notifications/notification-policy';

const STORAGE_KEY = 'xopc.browser-notifications.v1';
const DEFAULT_PREFERENCES: NotificationPreferences = {
  enabled: false,
  completed: true,
  failed: true,
};

export function getBrowserNotificationPreferences(): NotificationPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<NotificationPreferences>;
    return {
      enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_PREFERENCES.enabled,
      completed: typeof value.completed === 'boolean' ? value.completed : DEFAULT_PREFERENCES.completed,
      failed: typeof value.failed === 'boolean' ? value.failed : DEFAULT_PREFERENCES.failed,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function setBrowserNotificationPreferences(
  patch: Partial<NotificationPreferences>,
): NotificationPreferences {
  const next = { ...getBrowserNotificationPreferences(), ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Keep the in-memory UI usable when browser storage is unavailable.
  }
  return next;
}
