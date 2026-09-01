export type NotificationDevicePlatform = 'ios' | 'android';
export type NotificationPermission = 'granted' | 'denied' | 'unknown';
export type NotificationLanguage = 'en' | 'zh';

export type NotificationPreferences = {
  chatCompleted: boolean;
  chatFailed: boolean;
  taskNeedsInput: boolean;
  taskBlocked: boolean;
  taskFailed: boolean;
  taskCompleted: boolean;
  automationCompleted: boolean;
  automationFailed: boolean;
  proactiveInsight: boolean;
};

export type NotificationDevice = {
  id: string;
  platform: NotificationDevicePlatform;
  pushToken: string;
  enabled: boolean;
  permissions: NotificationPermission;
  preferences: NotificationPreferences;
  locale: NotificationLanguage;
  appVersion?: string;
  leaseExpiresAt: number;
  lastSeenAt: number;
  createdAt: number;
  updatedAt: number;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  chatCompleted: true,
  chatFailed: true,
  taskNeedsInput: true,
  taskBlocked: true,
  taskFailed: true,
  taskCompleted: false,
  automationCompleted: false,
  automationFailed: true,
  proactiveInsight: true,
};
