import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import type { ImperativeRouter } from 'expo-router';
import { Platform } from 'react-native';

import { apiFetch } from '../../api/client';
import { KEYS, storage } from '../../storage/mmkv';
import { useGatewayStore } from '../../stores/gateway-store';

import { resolveNotificationRoute } from './notification-route';

type NotificationPermission = 'granted' | 'denied' | 'unknown';

type DeviceRegistration = {
  id: string;
  pushToken: string;
  platform: 'ios' | 'android';
  permissions: NotificationPermission;
  appVersion?: string;
};

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

function installationId(): string {
  const existing = storage.getString(KEYS.mobileInstallationId)?.trim();
  if (existing) return existing;
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  storage.set(KEYS.mobileInstallationId, id);
  return id;
}

function notificationPermission(status: Notifications.PermissionStatus): NotificationPermission {
  if (status === Notifications.PermissionStatus.GRANTED) return 'granted';
  if (status === Notifications.PermissionStatus.DENIED) return 'denied';
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
  if (Platform.OS === 'web' || !Device.isDevice) return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('xopc-default', {
      name: 'xopc',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  let permissions = await Notifications.getPermissionsAsync();
  if (requestPermission && permissions.status !== Notifications.PermissionStatus.GRANTED) {
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
  try {
    await apiFetch(`/api/mobile/devices/${encodeURIComponent(installationId())}`, { method: 'DELETE' });
  } catch {
    // The local preference still prevents future automatic registration.
  }
}

export function subscribeToMobileNotifications(router: ImperativeRouter): () => void {
  if (Platform.OS === 'web') return () => {};
  void Notifications.getLastNotificationResponseAsync().then((response) => {
    if (response) navigateNotification(router, response.notification.request.content.data);
  });
  const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
    navigateNotification(router, response.notification.request.content.data);
  });
  const tokenSubscription = Notifications.addPushTokenListener((token) => {
    if (!useGatewayStore.getState().activeGatewayId) return;
    void registerWithGateway({
      id: installationId(),
      pushToken: token.data,
      platform: Platform.OS === 'android' ? 'android' : 'ios',
      permissions: 'granted',
      appVersion: Constants.expoConfig?.version,
    });
  });
  return () => {
    responseSubscription.remove();
    tokenSubscription.remove();
  };
}
