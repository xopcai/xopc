import type { ProductNotificationPresentation } from '@/features/notifications/product-notification';

export type NotificationPreferences = {
  enabled: boolean;
  completed: boolean;
  failed: boolean;
};

export type NotificationPolicyInput = {
  notification: ProductNotificationPresentation;
  preferences: NotificationPreferences;
  permissionGranted: boolean;
  appFocused: boolean;
  alreadyDelivered: boolean;
};

export type NotificationDecision =
  | { notify: true }
  | { notify: false; reason: 'disabled' | 'status-disabled' | 'permission' | 'focused' | 'duplicate' };

export function decideNotification(input: NotificationPolicyInput): NotificationDecision {
  if (!input.preferences.enabled) return { notify: false, reason: 'disabled' };
  if (input.notification.status === 'success' && !input.preferences.completed) {
    return { notify: false, reason: 'status-disabled' };
  }
  if (input.notification.status === 'error' && !input.preferences.failed) {
    return { notify: false, reason: 'status-disabled' };
  }
  if (!input.permissionGranted) return { notify: false, reason: 'permission' };
  if (input.appFocused) return { notify: false, reason: 'focused' };
  if (input.alreadyDelivered) return { notify: false, reason: 'duplicate' };
  return { notify: true };
}
