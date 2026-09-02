import type { Hono } from 'hono';

import {
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
    'chatCompleted', 'chatFailed', 'taskNeedsInput', 'taskBlocked', 'taskFailed',
    'taskCompleted', 'automationCompleted', 'automationFailed', 'proactiveInsight',
  ] as const) {
    if (source[key] === undefined) continue;
    if (typeof source[key] !== 'boolean') return null;
    result[key] = source[key];
  }
  return result;
}

function parsePlatform(value: unknown): NotificationDevicePlatform | null {
  return value === 'ios' || value === 'android' ? value : null;
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
    const permissions = parsePermission(body?.permissions);
    const preferences = parsePreferences(body?.preferences);
    const locale = parseLocale(body?.locale);
    const appVersion = body?.appVersion === undefined ? undefined : stringField(body.appVersion, 128);
    if (!pushToken || !platform || !permissions || !locale || preferences === null || appVersion === null) {
      return c.json({ ok: false, error: 'Invalid push registration' }, 400);
    }
    const device = registerNotificationDevice({
      deviceId, pushToken, platform, permissions, preferences, locale, appVersion,
    });
    return c.json({ ok: true, device }, 201);
  });

  authenticated.patch('/api/devices/me/push/preferences', async (c) => {
    const deviceId = currentDeviceId(c);
    if (!deviceId) return c.json({ ok: false, error: 'Device access required' }, 403);
    const preferences = parsePreferences(await c.req.json().catch(() => null));
    if (preferences === null || preferences === undefined) {
      return c.json({ ok: false, error: 'Invalid notification preferences' }, 400);
    }
    const device = updateNotificationDevicePreferences(deviceId, preferences);
    return device
      ? c.json({ ok: true, device })
      : c.json({ ok: false, error: 'Push registration not found' }, 404);
  });

  authenticated.delete('/api/devices/me/push', (c) => {
    const deviceId = currentDeviceId(c);
    if (!deviceId) return c.json({ ok: false, error: 'Device access required' }, 403);
    return c.json({ ok: true, removed: removeNotificationDevice(deviceId) });
  });
}
