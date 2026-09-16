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

describe('device push routes', () => {
  let stateDir: string;
  let app: Hono;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-device-push-routes-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    createDevice({
      id: 'device-1', displayName: 'Phone', platform: 'android',
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
      scopes: ['notifications.self'],
    });
    app = new Hono();
    app.use('*', async (c, next) => {
      setGatewayPrincipal(c, {
        kind: 'device', principalId: 'device-1', deviceId: 'device-1',
        accessSessionId: 'access-1', scopes: ['notifications.self'],
      });
      await next();
    });
    registerDevicePushRoutes(app);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('binds registration, preferences, and removal to the authenticated device', async () => {
    const registration = await app.request('/api/devices/me/push', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        platform: 'android', pushToken: 'ExponentPushToken[token]',
        permissions: 'granted', locale: 'zh', preferences: { chatCompleted: true },
      }),
    });
    expect(registration.status).toBe(201);
    expect(await registration.json()).toMatchObject({ device: { id: 'device-1', locale: 'zh' } });

    const update = await app.request('/api/devices/me/push/preferences', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatFailed: false }),
    });
    expect(await update.json()).toMatchObject({
      device: { id: 'device-1', preferences: { chatCompleted: true, chatFailed: false } },
    });

    const removed = await app.request('/api/devices/me/push', { method: 'DELETE' });
    expect(await removed.json()).toEqual({ ok: true, removed: true });
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
  it('rejects attempts to switch a paired device to another push provider', async () => {
    const response = await app.request('/api/devices/me/push', { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform: 'harmonyos', pushToken: 'token', permissions: 'granted', locale: 'en' }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'Push platform must match the paired device' });
  });
  it('registers HarmonyOS only when its independent provider is configured', async () => {
    createDevice({ id: 'harmony-device', displayName: 'Harmony', platform: 'harmonyos', publicKeyJwk: { kty: 'EC' }, scopes: ['notifications.self'] });
    const harmony = new Hono();
    harmony.use('*', async (c, next) => {
      setGatewayPrincipal(c, { kind: 'device', principalId: 'harmony-device', deviceId: 'harmony-device', accessSessionId: 'access-harmony', scopes: ['notifications.self'] });
      await next();
    });
    registerDevicePushRoutes(harmony);
    const request = () => harmony.request('/api/devices/me/push', { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform: 'harmonyos', pushToken: 'huawei-token', permissions: 'granted', locale: 'zh' }) });
    vi.stubEnv('XOPC_HARMONY_PUSH_SERVICE_ACCOUNT', '');
    expect((await request()).status).toBe(503);
    vi.stubEnv('XOPC_HARMONY_PUSH_SERVICE_ACCOUNT', '/private/account.json'); vi.stubEnv('XOPC_HARMONY_PUSH_CATEGORY', 'WORK');
    const response = await request(); expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ device: { platform: 'harmonyos', id: 'harmony-device' } });
  });
});
