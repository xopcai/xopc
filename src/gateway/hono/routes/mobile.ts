import type { Hono } from 'hono';

import {
  acknowledgeMobileActivityEvent,
  listMobileActivityEvents,
  registerMobileDevice,
  removeMobileDevice,
  updateMobileDevicePreferences,
} from '../../../mobile/notification-store.js';
import type {
  MobileNotificationPermission,
  MobileNotificationPreferences,
  MobilePlatform,
} from '../../../mobile/notification-types.js';

import type { AuthenticatedRouteDeps } from './deps.js';

function stringField(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength
    ? value.trim()
    : null;
}

function parsePreferences(value: unknown): Partial<MobileNotificationPreferences> | null {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const result: Partial<MobileNotificationPreferences> = {};
  for (const key of ['needsInput', 'failed', 'completed', 'automationFailed'] as const) {
    if (source[key] === undefined) continue;
    if (typeof source[key] !== 'boolean') return null;
    result[key] = source[key];
  }
  return result;
}

function parsePlatform(value: unknown): MobilePlatform | null {
  return value === 'ios' || value === 'android' ? value : null;
}

function parsePermission(value: unknown): MobileNotificationPermission | null {
  return value === 'granted' || value === 'denied' || value === 'unknown' ? value : null;
}

function parseCursor(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseLimit(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(100, parsed)) : undefined;
}

export function registerMobileRoutes(authenticated: Hono, _deps: AuthenticatedRouteDeps): void {
  authenticated.post('/api/mobile/devices/register', async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const id = stringField(body?.id, 160);
    const pushToken = stringField(body?.pushToken, 1024);
    const platform = parsePlatform(body?.platform);
    const permissions = parsePermission(body?.permissions);
    const preferences = parsePreferences(body?.preferences);
    const appVersion = body?.appVersion === undefined ? undefined : stringField(body.appVersion, 128);
    if (!id || !pushToken || !platform || !permissions || preferences === null || appVersion === null) {
      return c.json({ ok: false, error: 'Invalid mobile device registration' }, 400);
    }
    const device = registerMobileDevice({ id, pushToken, platform, permissions, preferences, appVersion });
    return c.json({ ok: true, device }, 201);
  });

  authenticated.patch('/api/mobile/devices/:id/preferences', async (c) => {
    const preferences = parsePreferences(await c.req.json().catch(() => null));
    if (preferences === null || preferences === undefined) {
      return c.json({ ok: false, error: 'Invalid notification preferences' }, 400);
    }
    const device = updateMobileDevicePreferences(c.req.param('id'), preferences);
    if (!device) return c.json({ ok: false, error: 'Mobile device not found' }, 404);
    return c.json({ ok: true, device });
  });

  authenticated.delete('/api/mobile/devices/:id', (c) => {
    return c.json({ ok: true, removed: removeMobileDevice(c.req.param('id')) });
  });

  authenticated.get('/api/mobile/activity', (c) => {
    const result = listMobileActivityEvents({
      cursor: parseCursor(c.req.query('cursor')),
      limit: parseLimit(c.req.query('limit')),
    });
    return c.json({ ok: true, ...result });
  });

  authenticated.post('/api/mobile/activity/:id/ack', async (c) => {
    const body = await c.req.json().catch(() => null) as { deviceId?: unknown } | null;
    const deviceId = stringField(body?.deviceId, 160);
    if (!deviceId) return c.json({ ok: false, error: 'deviceId is required' }, 400);
    const acknowledged = acknowledgeMobileActivityEvent(c.req.param('id'), deviceId);
    if (!acknowledged) return c.json({ ok: false, error: 'Activity event or mobile device not found' }, 404);
    return c.json({ ok: true });
  });
}
