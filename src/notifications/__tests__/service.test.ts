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
import type { NotificationDomainDelivery } from '../domain-delivery.js';
import type { NotificationPlan } from '../planner.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import {
  createNotificationEvent,
  notificationDeliveryMetrics,
  rescheduleNotificationDelivery,
} from '../store.js';

const chatEvent = {
  schemaVersion: 1,
  runId: 'run-chat',
  conversationId: 'session-1',
  status: 'success',
  completedAtMs: 1,
  source: 'webchat',
  target: { kind: 'chat', conversationId: 'session-1' },
};

const domainPlan: NotificationPlan = {
  dedupeKey: 'scene-result', notification: {
    type: 'scene.result', target: { kind: 'scene_result', activationId: 'activation', presentationId: 'presentation' },
    priority: 'normal', title: { en: 'Private title', zh: '私人标题' }, payload: {},
  },
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

  it('delivers ordinary notifications without any Proactive or Heartbeat tables', async () => {
    const db = getSqliteDatabase();
    db.exec('PRAGMA foreign_keys = OFF');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND (name GLOB 'proactive_*' OR name = 'heartbeat_checks')").all();
    for (const row of tables) db.exec(`DROP TABLE "${String(row.name).replaceAll('"', '""')}"`);
    db.exec('PRAGMA foreign_keys = ON');
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: { status: 'ok', id: 'ticket' } })));
    const service = new NotificationService({ publish: vi.fn(), fetch: fetchMock });
    service.persistGatewayEvent('agent.run.ended', chatEvent);
    await service.drain();
    expect(notificationDeliveryMetrics()).toMatchObject({ accepted: 1 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects uninstalled domain publication and does not send an already queued domain event', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const service = new NotificationService({ publish: vi.fn(), fetch: fetchMock });
    expect(() => service.persistPlan(domainPlan)).toThrow('domain delivery is not installed');
    createNotificationEvent({ ...domainPlan, deviceIds: ['device-1'] });
    await service.drain();
    expect(notificationDeliveryMetrics()).toMatchObject({ dead: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('honors injected notification preferences before persistence and queued delivery', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    let allowed = false;
    const service = new NotificationService({ publish: vi.fn(), fetch: fetchMock, allowsNotification: () => allowed });
    expect(service.persistGatewayEvent('agent.run.ended', chatEvent)).toBeNull();
    allowed = true;
    expect(service.persistGatewayEvent('agent.run.ended', chatEvent)).not.toBeNull();
    allowed = false;
    await service.drain();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(notificationDeliveryMetrics()).toMatchObject({ dead: 1 });
  });

  it('enqueues domain work atomically once and applies injected mobile policy and private preview', async () => {
    const enqueue = vi.fn();
    const domain: NotificationDomainDelivery = {
      owns: (type) => type === 'scene.result', allowsDevice: () => true, planEvent: () => null,
      prepare: (plan, devices) => ({ plan, deviceIds: devices.map((device) => device.id), enqueue }),
      flush: () => [], drain: async () => {}, recheckMobile: () => 'send',
      mobilePreview: () => ({ title: 'Result ready', body: 'Open the app.' }),
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: { status: 'ok', id: 'ticket' } })));
    const service = new NotificationService({ publish: vi.fn(), fetch: fetchMock, domainDelivery: domain });
    enqueue.mockImplementationOnce(() => { throw new Error('ledger unavailable'); });
    expect(() => service.persistPlan(domainPlan)).toThrow('ledger unavailable');
    expect(getSqliteDatabase().prepare('SELECT count(*) AS n FROM notification_events').get()?.n).toBe(0);
    enqueue.mockClear();
    expect(service.persistPlan(domainPlan)).not.toBeNull();
    expect(service.persistPlan(domainPlan)).toBeNull();
    expect(enqueue).toHaveBeenCalledOnce();
    await service.drain();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ title: 'Result ready', body: 'Open the app.' });
    expect(notificationDeliveryMetrics()).toMatchObject({ accepted: 1 });
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

  it('routes HarmonyOS only to its own provider and never polls Expo receipts for it', async () => {
    registerNotificationDevice({ deviceId: 'device-1', platform: 'harmonyos', pushToken: 'harmony-token', permissions: 'granted', locale: 'zh' });
    const fetchMock = vi.fn<typeof fetch>();
    const sendHarmony = vi.fn().mockResolvedValue('huawei-request-id');
    const published: Array<{ id: string }> = [];
    const service = new NotificationService({ publish: (_type, value) => published.push(value as { id: string }), fetch: fetchMock, sendHarmony });
    service.handleGatewayEvent('agent.run.ended', chatEvent);
    await vi.waitFor(() => expect(notificationDeliveryMetrics()).toMatchObject({ accepted: 1, delivered: 0 }));
    expect(sendHarmony).toHaveBeenCalledOnce(); expect(fetchMock).not.toHaveBeenCalled();
    rescheduleNotificationDelivery(published[0]!.id, 'device-1', 'accepted', 0, 'receipt now');
    await service.drain(); expect(fetchMock).not.toHaveBeenCalled();
  });

  it('publishes and queues a review notification when work discovery completes', async () => {
    const published: unknown[] = [];
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      data: { status: 'ok', id: 'ticket-understanding' },
    }), { status: 200 }));
    const service = new NotificationService({
      publish: (_type, payload) => published.push(payload),
      fetch: fetchMock,
    });

    service.handleGatewayEvent('work-discovery.completed', {
      runId: 'run-understanding',
      conversationId: 'session-understanding',
      status: 'completed',
    });

    await vi.waitFor(() => expect(notificationDeliveryMetrics()).toMatchObject({ accepted: 1 }));
    expect(published).toEqual([
      expect.objectContaining({
        type: 'work_discovery.completed',
        target: {
          kind: 'work_discovery',
          runId: 'run-understanding',
          conversationId: 'session-understanding',
        },
      }),
    ]);
  });

  it('requires an explicit mobile preference before delivering home opportunities', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      data: { status: 'ok', id: 'ticket-home' },
    }), { status: 200 }));
    const service = new NotificationService({ publish: vi.fn(), fetch: fetchMock });
    const event = (notificationKey: string) => ({
      notificationKey,
      opportunityId: `opportunity-${notificationKey}`,
      title: 'Prepare the launch review',
    });

    service.handleGatewayEvent('home.opportunity.ready', event('default-off'));
    await service.drain();
    expect(fetchMock).not.toHaveBeenCalled();

    registerNotificationDevice({
      deviceId: 'device-1', platform: 'ios', pushToken: 'ExponentPushToken[token]',
      permissions: 'granted', locale: 'en', preferences: { homeOpportunity: true },
    });
    service.handleGatewayEvent('home.opportunity.ready', event('explicit-on'));
    await vi.waitFor(() => expect(notificationDeliveryMetrics()).toMatchObject({ accepted: 1 }));
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
