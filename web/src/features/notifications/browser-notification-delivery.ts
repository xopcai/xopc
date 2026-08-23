import type { AgentRunNotification } from '@/features/notifications/agent-run-notification';
import { getBrowserNotificationPreferences } from '@/features/notifications/browser-notification-preferences';
import {
  markNotificationDelivered,
  wasNotificationDelivered,
} from '@/features/notifications/notification-delivery-history';
import { decideNotification } from '@/features/notifications/notification-policy';
import { isElectron } from '@/lib/electron-env';

export function browserNotificationsSupported(): boolean {
  return !isElectron()
    && typeof Notification !== 'undefined'
    && 'serviceWorker' in navigator
    && window.isSecureContext;
}

async function notificationRegistration(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register('/notification-sw.js');
  await navigator.serviceWorker.ready;
  return registration;
}

export async function deliverBrowserNotification(notification: AgentRunNotification): Promise<boolean> {
  if (!browserNotificationsSupported()) return false;
  const decision = decideNotification({
    notification,
    preferences: getBrowserNotificationPreferences(),
    permissionGranted: Notification.permission === 'granted',
    appFocused: document.visibilityState === 'visible' && document.hasFocus(),
    alreadyDelivered: wasNotificationDelivered(notification.id),
  });
  if (!decision.notify) return false;
  try {
    const registration = await notificationRegistration();
    await registration.showNotification(notification.title, {
      body: notification.body,
      tag: notification.id,
      icon: '/pwa-192x192.png',
      data: { route: notification.route },
    });
    markNotificationDelivered(notification.id);
    return true;
  } catch {
    return false;
  }
}

export async function enableBrowserNotifications(): Promise<NotificationPermission | 'unsupported'> {
  if (!browserNotificationsSupported()) return 'unsupported';
  const permission = Notification.permission === 'default'
    ? await Notification.requestPermission()
    : Notification.permission;
  if (permission === 'granted') await notificationRegistration();
  return permission;
}

export async function showBrowserTestNotification(title: string, body: string): Promise<boolean> {
  if (!browserNotificationsSupported() || Notification.permission !== 'granted') return false;
  try {
    const registration = await notificationRegistration();
    await registration.showNotification(title, {
      body,
      tag: 'xopc-notification-test',
      icon: '/pwa-192x192.png',
      data: { route: '/chat/new' },
    });
    return true;
  } catch {
    return false;
  }
}
