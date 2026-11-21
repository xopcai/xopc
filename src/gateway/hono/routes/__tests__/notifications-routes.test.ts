import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setGatewayPrincipal } from '../../../security/gateway-principal.js';
import { requiredGatewayScope } from '../../../security/gateway-scopes.js';
import { registerNotificationDevice } from '../../../../notifications/device-store.js';
import { createNotificationEvent } from '../../../../notifications/store.js';
import {
  closeXopcDatabase,
  createDevice,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../../storage/sqlite/index.js';
import { registerNotificationRoutes } from '../notifications.js';

describe('notification routes', () => {
  let stateDir: string;
  let app: Hono;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-notification-routes-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    app = new Hono();
    app.use('*', async (c, next) => {
      const deviceId = c.req.header('x-test-device');
      setGatewayPrincipal(c, deviceId
        ? { kind: 'device', principalId: deviceId, deviceId, scopes: ['notifications.self'] }
        : { kind: 'owner', principalId: 'owner', scopes: ['gateway.admin'] });
      await next();
    });
    registerNotificationRoutes(app, {} as never);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('serves catch-up events and records a cross-surface acknowledgement', async () => {
    const { notification } = createNotificationEvent({
      dedupeKey: 'chat.completed:run-1',
      notification: {
        type: 'chat.completed',
        target: { kind: 'chat', conversationId: 'session-1' },
        priority: 'normal',
        title: { en: 'Response ready', zh: '回答已就绪' },
        payload: { runId: 'run-1' },
      },
      deviceIds: [],
      createdAt: 10,
    });
    const list = await app.request('/api/notifications?since=0');
    expect(await list.json()).toMatchObject({
      ok: true,
      items: [{ id: notification.id, target: { kind: 'chat', conversationId: 'session-1' } }],
      nextCursor: notification.id,
    });
    const ack = await app.request(`/api/notifications/${notification.id}/ack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ consumerId: 'browser-1', surface: 'web' }),
    });
    expect(ack.status).toBe(200);
    const metrics = await app.request('/api/notifications/metrics');
    expect(await metrics.json()).toMatchObject({
      ok: true,
      deliveries: {
        pending: 0,
        accepted: 0,
        delivered: 0,
        dead: 0,
        devices: { deliverable: 0, expired: 0, disabled: 0 },
      },
    });
  });

  it('accepts only the device’s own mobile delivery acknowledgement', async () => {
    createDevice({ id: 'phone-1', displayName: 'Phone', platform: 'harmonyos',
      publicKeyJwk: { kty: 'EC' }, scopes: ['notifications.self'] });
    registerNotificationDevice({ deviceId: 'phone-1', platform: 'harmonyos', pushToken: 'test-token',
      permissions: 'granted', locale: 'zh' });
    const plan = {
      notification: {
        type: 'chat.completed' as const,
        target: { kind: 'chat' as const, conversationId: 'test-chat' },
        priority: 'normal' as const,
        title: { en: 'Ready', zh: '已就绪' },
        payload: {},
      },
    };
    const assigned = createNotificationEvent({ ...plan, dedupeKey: 'assigned', deviceIds: ['phone-1'] }).notification.id;
    const other = createNotificationEvent({ ...plan, dedupeKey: 'other', deviceIds: [] }).notification.id;
    const ack = (id: string, consumerId?: string) => app.request(`/api/notifications/${id}/ack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-device': 'phone-1' },
      body: JSON.stringify({ consumerId, surface: 'mobile' }),
    });
    expect(requiredGatewayScope('POST', `/api/notifications/${assigned}/ack`)).toBe('notifications.self');
    expect(requiredGatewayScope('GET', '/api/notifications')).toBe('gateway.admin');
    expect((await ack(assigned, 'harmonyos:phone-2')).status).toBe(403);
    expect((await ack(other, 'harmonyos:phone-1')).status).toBe(404);
    expect((await ack(assigned, 'harmonyos:phone-1')).status).toBe(200);
    expect(await (await ack(assigned)).json()).toEqual({
      ok: true, target: { kind: 'chat', conversationId: 'test-chat' },
    });
    expect((await ack(other)).status).toBe(404);
  });
});
