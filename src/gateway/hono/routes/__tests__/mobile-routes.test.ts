import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../../storage/sqlite/index.js';
import { registerMobileRoutes } from '../mobile.js';

describe('mobile routes', () => {
  let stateDir: string;
  let app: Hono;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-mobile-routes-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    app = new Hono();
    registerMobileRoutes(app, {} as never);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('registers a device and updates only valid notification preferences', async () => {
    const registration = await app.request('/api/mobile/devices/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'device-1',
        platform: 'android',
        pushToken: 'ExponentPushToken[token]',
        permissions: 'granted',
        locale: 'zh',
        preferences: { chatCompleted: true },
      }),
    });
    expect(registration.status).toBe(201);
    expect(await registration.json()).toMatchObject({
      ok: true,
      device: { id: 'device-1', locale: 'zh', preferences: { chatCompleted: true, taskNeedsInput: true } },
    });

    const update = await app.request('/api/mobile/devices/device-1/preferences', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatFailed: false }),
    });
    expect(update.status).toBe(200);
    expect(await update.json()).toMatchObject({
      device: { preferences: { chatCompleted: true, chatFailed: false } },
    });

    const invalid = await app.request('/api/mobile/devices/device-1/preferences', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatFailed: 'no' }),
    });
    expect(invalid.status).toBe(400);
  });

  it('requires a supported locale and removes a registration explicitly', async () => {
    const invalid = await app.request('/api/mobile/devices/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'device-1', platform: 'ios', pushToken: 'ExponentPushToken[token]', permissions: 'granted', locale: 'fr',
      }),
    });
    expect(invalid.status).toBe(400);

    await app.request('/api/mobile/devices/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'device-1', platform: 'ios', pushToken: 'ExponentPushToken[token]', permissions: 'granted', locale: 'en',
      }),
    });
    const removed = await app.request('/api/mobile/devices/device-1', { method: 'DELETE' });
    expect(await removed.json()).toEqual({ ok: true, removed: true });
  });
});
