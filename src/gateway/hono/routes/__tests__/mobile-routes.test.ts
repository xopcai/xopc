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
import { createMobileActivityEvent } from '../../../../mobile/notification-store.js';
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
        preferences: { completed: true },
      }),
    });
    expect(registration.status).toBe(201);
    expect(await registration.json()).toMatchObject({
      ok: true,
      device: { id: 'device-1', preferences: { completed: true, needsInput: true } },
    });

    const update = await app.request('/api/mobile/devices/device-1/preferences', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ failed: false }),
    });
    expect(update.status).toBe(200);
    expect(await update.json()).toMatchObject({
      device: { preferences: { completed: true, failed: false } },
    });

    const invalid = await app.request('/api/mobile/devices/device-1/preferences', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ failed: 'no' }),
    });
    expect(invalid.status).toBe(400);
  });

  it('lists and acknowledges activity for a registered device', async () => {
    await app.request('/api/mobile/devices/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'device-1', platform: 'ios', pushToken: 'ExponentPushToken[token]', permissions: 'granted',
      }),
    });
    const event = createMobileActivityEvent({
      type: 'automation.failed',
      entity: { kind: 'automation', id: 'automation-1' },
      priority: 'high',
      title: 'Automation failed',
      deepLink: '/automation',
      payload: { route: '/automation' },
    });

    const list = await app.request('/api/mobile/activity?limit=1');
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ items: [expect.objectContaining({ id: event.id })] });

    const ack = await app.request(`/api/mobile/activity/${event.id}/ack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: 'device-1' }),
    });
    expect(ack.status).toBe(200);
  });
});
