import type { ProductNotificationPresentation } from '@/features/notifications/product-notification';
import {
  markNotificationDelivered,
  wasNotificationDelivered,
} from '@/features/notifications/notification-delivery-history';
import { decideNotification, isPersonalNotificationViewed, isClarificationNotificationViewed } from '@/features/notifications/notification-policy';
import { isElectron } from '@/lib/electron-env';

export async function deliverElectronNotification(notification: ProductNotificationPresentation): Promise<boolean> {
  const system = window.electronAPI?.system;
  if (!isElectron() || !system?.showProductNotification) return false;
  const behavior = await system.getBehavior().catch(() => null);
  if (!behavior) return false;
  const decision = decideNotification({
    notification,
    preferences: {
      enabled: behavior.notifyEnabled,
      completed: true,
      failed: true,
    },
    permissionGranted: true,
    appFocused: notification.waitId ? isClarificationNotificationViewed(notification) : isPersonalNotificationViewed(notification),
    alreadyDelivered: wasNotificationDelivered(notification.id),
  });
  if (!decision.notify) return false;
  const result = await system.showProductNotification({
    id: notification.id,
    title: notification.title,
    body: notification.body,
    target: notification.target,
    ...(notification.waitId && !isClarificationNotificationViewed(notification) ? { allowWhenFocused: true } : {}),
  }).catch(() => null);
  if (result?.ok && result.outcome === 'shown') {
    markNotificationDelivered(notification.id);
    return true;
  }
  return false;
}
