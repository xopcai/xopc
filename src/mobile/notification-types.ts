export type MobilePlatform = 'ios' | 'android';
export type MobileNotificationPermission = 'granted' | 'denied' | 'unknown';
export type MobileNotificationPriority = 'normal' | 'high';
export type MobileNotificationEventType =
  | 'goal.needs_input'
  | 'goal.blocked'
  | 'goal.completed'
  | 'automation.failed'
  | 'automation.completed';

export type MobileNotificationPreferences = {
  needsInput: boolean;
  failed: boolean;
  completed: boolean;
  automationFailed: boolean;
};

export type MobileDevice = {
  id: string;
  platform: MobilePlatform;
  pushToken: string;
  enabled: boolean;
  permissions: MobileNotificationPermission;
  preferences: MobileNotificationPreferences;
  appVersion?: string;
  lastSeenAt: number;
  createdAt: number;
  updatedAt: number;
};

export type MobileActivityEvent = {
  id: string;
  type: MobileNotificationEventType;
  entity: { kind: 'goal' | 'automation'; id: string };
  priority: MobileNotificationPriority;
  title: string;
  body?: string;
  deepLink: string;
  payload: Record<string, unknown>;
  createdAt: number;
};

export const DEFAULT_MOBILE_NOTIFICATION_PREFERENCES: MobileNotificationPreferences = {
  needsInput: true,
  failed: true,
  completed: false,
  automationFailed: true,
};
