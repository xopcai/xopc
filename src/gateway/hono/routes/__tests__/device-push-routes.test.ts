import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setGatewayPrincipal } from '../../../security/gateway-principal.js';
import {
  closeXopcDatabase,
  createDevice,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../../storage/sqlite/index.js';
import { registerDevicePushRoutes } from '../device-push.js';

import { PlatformPushError, registerPlatformPushDevice, removePlatformPushDevice } from '../../../../notifications/platform-push.js';

vi.mock('../../../../notifications/platform-push.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../notifications/platform-push.js')>(),
  registerPlatformPushDevice: vi.fn(),
  removePlatformPushDevice: vi.fn(),
}));

describe('device push routes', () => {
  let stateDir: string;
  let app: Hono;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-device-push-routes-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    createDevice({
      id: 'device-1', displayName: 'Phone', platform: 'harmonyos',
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
      scopes: ['notifications.self'],
    });
    vi.mocked(registerPlatformPushDevice).mockResolvedValue('platform-push:00000000-0000-4000-8000-000000000001');
    vi.mocked(removePlatformPushDevice).mockResolvedValue(undefined);
    app = new Hono();
    app.use('*', async (c, next) => {
      const id = c.req.header('x-test-device') ?? 'device-1';
      setGatewayPrincipal(c, {
        kind: 'device', principalId: id, deviceId: id,
        accessSessionId: 'access-1', scopes: ['notifications.self'],
      });
      await next();
    });
    registerDevicePushRoutes(app);
  });

  afterEach(() => {
    vi.resetAllMocks();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('binds registration, preferences, and removal to the authenticated device', async () => {
    const registration = await app.request('/api/devices/me/push', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        platform: 'harmonyos', pushToken: 'huawei-token',
        permissions: 'granted', locale: 'zh', preferences: { chatCompleted: true },
      }),
    });
    expect(registration.status).toBe(201);
    const record = await registration.json();
    expect(record).toMatchObject({ device: { id: 'device-1', locale: 'zh' } });
    expect(record.device).not.toHaveProperty('pushToken');
    expect(registerPlatformPushDevice).toHaveBeenCalledWith(expect.any(String), 'device-1', 'huawei-token', 'harmonyos', undefined);

    const update = await app.request('/api/devices/me/push/preferences', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatFailed: false }),
    });
    expect(await update.json()).toMatchObject({
      device: { id: 'device-1', preferences: { chatCompleted: true, chatFailed: false } },
    });

    const removed = await app.request('/api/devices/me/push', { method: 'DELETE' });
    expect(await removed.json()).toEqual({ ok: true, removed: true });
    expect(removePlatformPushDevice).toHaveBeenCalledWith('platform-push:00000000-0000-4000-8000-000000000001');
  });

  it('rejects invalid registration without accepting a caller-selected device id', async () => {
    const response = await app.request('/api/devices/me/push', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'attacker-selected', platform: 'ios', pushToken: 'token',
        permissions: 'granted', locale: 'en',
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'Device identity must come from authentication' });
  });
  it('rejects a platform different from the paired device', async () => {
    const response = await app.request('/api/devices/me/push', { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform: 'android', pushToken: 'token', permissions: 'granted', locale: 'en' }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'Push platform must match the paired device' });
  });
  it.each([
    { platform: 'android' as const, environment: undefined },
    { platform: 'ios' as const, environment: 'production' as const },
  ])('registers a paired $platform device through Cloud', async ({ platform, environment }) => {
    const id = platform + '-device';
    createDevice({ id, displayName: 'Phone', platform, publicKeyJwk: { kty: 'EC' }, scopes: ['notifications.self'] });
    const response = await app.request('/api/devices/me/push', {
      method: 'PUT', headers: { 'content-type': 'application/json', 'x-test-device': id },
      body: JSON.stringify({ platform, environment, pushToken: 'aabb', permissions: 'granted', locale: 'en' }),
    });
    expect(response.status).toBe(201);
    expect(vi.mocked(registerPlatformPushDevice))
      .toHaveBeenCalledWith(expect.any(String), id, 'aabb', platform, environment);
    const result = await response.json();
    expect(result.device).toMatchObject({ id, platform });
    expect(result.device).not.toHaveProperty('pushToken');
  });

  it('registers HarmonyOS only when the platform accepts the registration', async () => {
    createDevice({ id: 'harmony-device', displayName: 'Harmony', platform: 'harmonyos', publicKeyJwk: { kty: 'EC' }, scopes: ['notifications.self'] });
    const harmony = new Hono();
    harmony.use('*', async (c, next) => {
      setGatewayPrincipal(c, { kind: 'device', principalId: 'harmony-device', deviceId: 'harmony-device', accessSessionId: 'access-harmony', scopes: ['notifications.self'] });
      await next();
    });
    registerDevicePushRoutes(harmony);
    const request = () => harmony.request('/api/devices/me/push', { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform: 'harmonyos', pushToken: 'huawei-token', permissions: 'granted', locale: 'zh' }) });
    vi.mocked(registerPlatformPushDevice).mockRejectedValueOnce(new PlatformPushError(403, 'PUSH_CLOUD_AUTH_REQUIRED'));
    const rejected = await request();
    expect(rejected.status).toBe(503);
    expect(await rejected.json()).toMatchObject({ error: { code: 'PUSH_CLOUD_AUTH_REQUIRED' } });
    const response = await request(); expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ device: { platform: 'harmonyos', id: 'harmony-device' } });
  });
});
