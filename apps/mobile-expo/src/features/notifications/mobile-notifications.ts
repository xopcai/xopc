import Constants from 'expo-constants';
import * as Device from 'expo-device';
import type { ImperativeRouter } from 'expo-router';
import { Platform } from 'react-native';

import { apiFetch } from '../../api/client';
import { KEYS, storage } from '../../storage/mmkv';
import { useGatewayStore } from '../../stores/gateway-store';

import { resolveNotificationRoute } from './notification-route';

type NotificationsModule = typeof import('expo-notifications');
type NotificationStatus = Awaited<ReturnType<NotificationsModule['getPermissionsAsync']>>['status'];
type NotificationSubscription = { remove: () => void };
type NotificationPermission = 'granted' | 'denied' | 'unknown';

type DeviceRegistration = {
  id: string;
  pushToken: string;
  platform: 'ios' | 'android';
  permissions: NotificationPermission;
  appVersion?: string;
};

function supportsRemoteNotifications(): boolean {
  return !(Platform.OS === 'android' && Constants.appOwnership === 'expo');
}

let notificationHandlerConfigured = false;

async function loadNotifications(): Promise<NotificationsModule | null> {
  if (!supportsRemoteNotifications()) return null;
  try {
    return await import('expo-notifications');
  } catch {
    return null;
  }
}

function ensureNotificationHandler(Notifications: NotificationsModule): void {
  if (notificationHandlerConfigured) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  notificationHandlerConfigured = true;
}

function installationId(): string {
  const existing = storage.getString(KEYS.mobileInstallationId)?.trim();
  if (existing) return existing;
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  storage.set(KEYS.mobileInstallationId, id);
  return id;
}

function notificationPermission(status: NotificationStatus): NotificationPermission {
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'unknown';
}

function expoProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined;
  return typeof extra?.eas?.projectId === 'string' ? extra.eas.projectId : undefined;
}

function navigateNotification(router: ImperativeRouter, data: unknown): void {
  const route = resolveNotificationRoute(data);
  if (route) router.push(route as never);
}

async function registerWithGateway(registration: DeviceRegistration): Promise<boolean> {
  try {
    const response = await apiFetch('/api/mobile/devices/register', {
      method: 'POST',
      body: JSON.stringify({
        ...registration,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function buildRegistration(requestPermission: boolean): Promise<DeviceRegistration | null> {
  const Notifications = await loadNotifications();
  if (!Notifications || !Device.isDevice) return null;
  ensureNotificationHandler(Notifications);
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('xopc-default', {
      name: 'xopc',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  let permissions = await Notifications.getPermissionsAsync();
  if (requestPermission && notificationPermission(permissions.status) !== 'granted') {
    permissions = await Notifications.requestPermissionsAsync();
  }
  const permission = notificationPermission(permissions.status);
  if (permission !== 'granted') return null;
  const projectId = expoProjectId();
  if (!projectId) return null;
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  return {
    id: installationId(),
    pushToken: token.data,
    platform: Platform.OS === 'android' ? 'android' : 'ios',
    permissions: permission,
    appVersion: Constants.expoConfig?.version,
  };
}

/** Request system permission only from an explicit settings action, then register this device. */
export async function enableMobileNotifications(): Promise<boolean> {
  const registration = await buildRegistration(true);
  return registration ? registerWithGateway(registration) : false;
}

/** Refreshes a previously authorized token without showing a system permission prompt. */
export async function syncMobileNotificationRegistration(): Promise<boolean> {
  const registration = await buildRegistration(false);
  return registration ? registerWithGateway(registration) : false;
}

export async function disableMobileNotifications(): Promise<void> {
  if (!supportsRemoteNotifications()) return;
  try {
    await apiFetch(`/api/mobile/devices/${encodeURIComponent(installationId())}`, { method: 'DELETE' });
  } catch {
    // The local preference still prevents future automatic registration.
  }
}

export function subscribeToMobileNotifications(router: ImperativeRouter): () => void {
  if (!supportsRemoteNotifications()) return () => {};

  let active = true;
  let responseSubscription: NotificationSubscription | undefined;
  let tokenSubscription: NotificationSubscription | undefined;

  void (async () => {
    const Notifications = await loadNotifications();
    if (!active || !Notifications) return;
    ensureNotificationHandler(Notifications);

    const response = await Notifications.getLastNotificationResponseAsync();
    if (!active) return;
    if (response) navigateNotification(router, response.notification.request.content.data);

    responseSubscription = Notifications.addNotificationResponseReceivedListener((nextResponse) => {
      navigateNotification(router, nextResponse.notification.request.content.data);
    });
    tokenSubscription = Notifications.addPushTokenListener((token) => {
      if (!useGatewayStore.getState().activeGatewayId) return;
      void registerWithGateway({
        id: installationId(),
        pushToken: token.data,
        platform: Platform.OS === 'android' ? 'android' : 'ios',
        permissions: 'granted',
        appVersion: Constants.expoConfig?.version,
      });
    });
  })();

  return () => {
    active = false;
    responseSubscription?.remove();
    tokenSubscription?.remove();
  };
}
