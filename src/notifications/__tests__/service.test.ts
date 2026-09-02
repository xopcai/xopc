import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeXopcDatabase,
  createDevice,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { getNotificationDevice, registerNotificationDevice } from '../device-store.js';
import { NotificationService } from '../service.js';
import {
  notificationDeliveryMetrics,
  rescheduleNotificationDelivery,
} from '../store.js';

const chatEvent = {
  schemaVersion: 1,
  runId: 'run-chat',
  sessionKey: 'session-1',
  status: 'success',
  completedAtMs: 1,
  source: 'webchat',
  target: { kind: 'chat', sessionKey: 'session-1' },
};

describe('NotificationService', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-notification-service-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    createDevice({
      id: 'device-1', displayName: 'Phone', platform: 'ios',
      publicKeyJwk: { kty: 'EC' }, scopes: ['notifications.self'],
    });
    registerNotificationDevice({
      deviceId: 'device-1',
      platform: 'ios',
      pushToken: 'ExponentPushToken[token]',
      permissions: 'granted',
      locale: 'en',
    });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('persists, publishes, sends, and confirms an Expo delivery', async () => {
    const published: unknown[] = [];
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: 'ok', id: 'ticket-1' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { 'ticket-1': { status: 'ok' } } }), { status: 200 }));
    const service = new NotificationService({
      publish: (_type, payload) => published.push(payload),
      fetch: fetchMock,
    });

    service.handleGatewayEvent('agent.run.ended', chatEvent);
    await vi.waitFor(() => expect(notificationDeliveryMetrics()).toMatchObject({ accepted: 1 }));
    const event = published[0] as { id: string };
    rescheduleNotificationDelivery(event.id, 'device-1', 'accepted', 0, 'test receipt now');
    await service.drain();

    expect(notificationDeliveryMetrics()).toMatchObject({ delivered: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('disables an Expo token rejected as DeviceNotRegistered', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      data: {
        status: 'error',
        message: 'The device is no longer registered',
        details: { error: 'DeviceNotRegistered' },
      },
    }), { status: 200 }));
    const service = new NotificationService({ publish: () => {}, fetch: fetchMock });

    service.handleGatewayEvent('agent.run.ended', chatEvent);
    await vi.waitFor(() => expect(notificationDeliveryMetrics()).toMatchObject({ dead: 1 }));
    expect(getNotificationDevice('device-1')?.enabled).toBe(false);
  });
});
