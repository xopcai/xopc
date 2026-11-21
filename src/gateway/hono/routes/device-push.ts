import type { Hono } from 'hono';

import {
  getNotificationDevice,
  disableNotificationDevice,
  registerNotificationDevice,
  removeNotificationDevice,
  updateNotificationDevicePreferences,
} from '../../../notifications/device-store.js';
import type {
  NotificationDevicePlatform,
  NotificationLanguage,
  NotificationPermission,
  NotificationPreferences,
} from '../../../notifications/types.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import { getDevice } from '../../../storage/sqlite/device-access-repository.js';
import { PlatformPushError, registerPlatformPushDevice, removePlatformPushDevice } from '../../../notifications/platform-push.js';
import { getOrCreateGatewayIdentity } from '../../../storage/sqlite/gateway-identity-repository.js';

function stringField(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength
    ? value.trim()
    : null;
}

function parsePreferences(value: unknown): Partial<NotificationPreferences> | null {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const result: Partial<NotificationPreferences> = {};
  for (const key of [
    'chatNeedsInput', 'chatCompleted', 'chatFailed', 'taskNeedsInput', 'taskBlocked', 'taskFailed',
    'taskCompleted', 'automationCompleted', 'automationFailed', 'homeOpportunity',
  ] as const) {
    if (source[key] === undefined) continue;
    if (typeof source[key] !== 'boolean') return null;
    result[key] = source[key];
  }
  return result;
}

function parsePlatform(value: unknown): NotificationDevicePlatform | null {
  return value === 'harmonyos' || value === 'ios' || value === 'android' ? value : null;
}

function parsePermission(value: unknown): NotificationPermission | null {
  return value === 'granted' || value === 'denied' || value === 'unknown' ? value : null;
}

function parseLocale(value: unknown): NotificationLanguage | null {
  return value === 'en' || value === 'zh' ? value : null;
}

function currentDeviceId(c: Parameters<typeof getGatewayPrincipal>[0]): string | null {
  const principal = getGatewayPrincipal(c);
  return principal.kind === 'device' && principal.deviceId ? principal.deviceId : null;
}

export function registerDevicePushRoutes(authenticated: Hono): void {
  authenticated.put('/api/devices/me/push', async (c) => {
    const deviceId = currentDeviceId(c);
    if (!deviceId) return c.json({ ok: false, error: 'Device access required' }, 403);
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (body && ('id' in body || 'deviceId' in body)) {
      return c.json({ ok: false, error: 'Device identity must come from authentication' }, 400);
    }
    const pushToken = stringField(body?.pushToken, 1024);
    const platform = parsePlatform(body?.platform);
    const environment = body?.environment === 'sandbox' || body?.environment === 'production' ? body.environment : undefined;
    if (platform === 'ios' ? !environment : body?.environment !== undefined) {
      return c.json({ ok: false, error: 'Invalid push environment' }, 400);
    }
    const permissions = parsePermission(body?.permissions);
    const preferences = parsePreferences(body?.preferences);
    const locale = parseLocale(body?.locale);
    const appVersion = body?.appVersion === undefined ? undefined : stringField(body.appVersion, 128);
    if (!pushToken || !platform || !permissions || !locale || preferences === null || appVersion === null) {
      return c.json({ ok: false, error: 'Invalid push registration' }, 400);
    }
    const paired = getDevice(deviceId);
    if (!paired || paired.revokedAt !== undefined || paired.platform !== platform) {
      return c.json({ ok: false, error: 'Push platform must match the paired device' }, 400);
    }
    let reference: string;
    try {
      if (permissions === 'granted') {
        reference = await registerPlatformPushDevice(getOrCreateGatewayIdentity().id, deviceId, pushToken, platform, environment);
      } else {
        disableNotificationDevice(deviceId);
        const current = getNotificationDevice(deviceId);
        if (current) await removePlatformPushDevice(current.pushToken);
        reference = 'disabled:' + deviceId;
      }
    } catch (error) {
      const code = error instanceof PlatformPushError ? error.code : 'PUSH_PLATFORM_REQUEST_FAILED';
      return c.json({ ok: false, error: { code } }, 503);
    }
    if (getDevice(deviceId)?.revokedAt) {
      // Keep a disabled reference for the service to revoke if the platform is offline.
      registerNotificationDevice({ deviceId, platform, pushToken: reference, permissions: 'denied', locale });
      return c.json({ ok: false, error: 'Device access required' }, 403);
    }
    const device = registerNotificationDevice({
      deviceId, pushToken: reference, platform, permissions, preferences, locale, appVersion,
    });
    const { pushToken: _pushToken, ...publicDevice } = device;
    return c.json({ ok: true, device: publicDevice }, 201);
  });

  authenticated.patch('/api/devices/me/push/preferences', async (c) => {
    const deviceId = currentDeviceId(c);
    if (!deviceId) return c.json({ ok: false, error: 'Device access required' }, 403);
    const preferences = parsePreferences(await c.req.json().catch(() => null));
    if (preferences === null || preferences === undefined) {
      return c.json({ ok: false, error: 'Invalid notification preferences' }, 400);
    }
    const device = updateNotificationDevicePreferences(deviceId, preferences);
    if (!device) return c.json({ ok: false, error: 'Push registration not found' }, 404);
    const { pushToken: _pushToken, ...publicDevice } = device;
    return c.json({ ok: true, device: publicDevice });
  });

  authenticated.delete('/api/devices/me/push', async (c) => {
    const deviceId = currentDeviceId(c);
    if (!deviceId) return c.json({ ok: false, error: 'Device access required' }, 403);
    disableNotificationDevice(deviceId);
    const device = getNotificationDevice(deviceId);
    try {
      if (device) await removePlatformPushDevice(device.pushToken);
    } catch (error) {
      const code = error instanceof PlatformPushError ? error.code : 'PUSH_PLATFORM_REQUEST_FAILED';
      return c.json({ ok: false, error: { code } }, 503);
    }
    return c.json({ ok: true, removed: removeNotificationDevice(deviceId) });
  });
}
