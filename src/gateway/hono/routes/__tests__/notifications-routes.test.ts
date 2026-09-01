import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNotificationEvent } from '../../../../notifications/store.js';
import {
  closeXopcDatabase,
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
        target: { kind: 'chat', sessionKey: 'session-1' },
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
      items: [{ id: notification.id, target: { kind: 'chat', sessionKey: 'session-1' } }],
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
});
