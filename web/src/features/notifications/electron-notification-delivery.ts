import type { AgentRunNotification } from '@/features/notifications/agent-run-notification';
import {
  markNotificationDelivered,
  wasNotificationDelivered,
} from '@/features/notifications/notification-delivery-history';
import { decideNotification } from '@/features/notifications/notification-policy';
import { isElectron } from '@/lib/electron-env';

export async function deliverElectronNotification(notification: AgentRunNotification): Promise<boolean> {
  const system = window.electronAPI?.system;
  if (!isElectron() || !system?.showAgentRunNotification) return false;
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
    appFocused: false,
    alreadyDelivered: wasNotificationDelivered(notification.id),
  });
  if (!decision.notify) return false;
  const result = await system.showAgentRunNotification({
    id: notification.id,
    title: notification.title,
    body: notification.body,
    route: notification.route,
  }).catch(() => null);
  if (result?.ok && result.outcome === 'shown') {
    markNotificationDelivered(notification.id);
    return true;
  }
  return false;
}
