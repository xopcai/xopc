import type { ProductNotificationPresentation } from '@/features/notifications/product-notification';

export type NotificationPreferences = {
  enabled: boolean;
  completed: boolean;
  failed: boolean;
  needsInput?: boolean;
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
  if (input.notification.systemAllowed === false) return { notify: false, reason: 'disabled' };
  if (!input.preferences.enabled) return { notify: false, reason: 'disabled' };
  if (input.notification.status === 'success' && !input.preferences.completed) {
    return { notify: false, reason: 'status-disabled' };
  }
  if (input.notification.status === 'error' && !input.preferences.failed) {
    return { notify: false, reason: 'status-disabled' };
  }
  if (input.notification.status === 'attention' && input.preferences.needsInput === false) {
    return { notify: false, reason: 'status-disabled' };
  }
  if (!input.permissionGranted) return { notify: false, reason: 'permission' };
  if (input.appFocused) return { notify: false, reason: 'focused' };
  if (input.alreadyDelivered) return { notify: false, reason: 'duplicate' };
  return { notify: true };
}

export function isPersonalNotificationViewed(notification: ProductNotificationPresentation): boolean {
  return notification.target.kind === 'chat' && notification.target.personal === true
    && window.location.hash.split('?')[0] === '#/personal'
    && document.visibilityState === 'visible' && document.hasFocus();
}

/** A focused application is not evidence that this particular question is visible. */
export function isClarificationNotificationViewed(notification: ProductNotificationPresentation): boolean {
  if (!notification.waitId || notification.target.kind !== 'chat'
    || document.visibilityState !== 'visible' || !document.hasFocus()) return false;
  const route = window.location.hash.split('?')[0];
  if (route !== '#/chat' && route !== `#/chat/${encodeURIComponent(notification.target.conversationId)}`
    && !(notification.target.personal && route === '#/personal')) return false;
  const card = Array.from(document.querySelectorAll<HTMLElement>('[data-clarification-id]'))
    .find(element => element.dataset.clarificationId === notification.waitId);
  if (!card || card.getClientRects().length === 0) return false;
  const bounds = card.getBoundingClientRect();
  return bounds.bottom > 0 && bounds.top < window.innerHeight && bounds.right > 0 && bounds.left < window.innerWidth;
}
