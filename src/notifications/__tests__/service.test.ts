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
import { registerNotificationDevice } from '../device-store.js';
import { NotificationService } from '../service.js';
import {
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

describe('NotificationService', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-notification-service-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    createDevice({
      id: 'device-1', displayName: 'Phone', platform: 'harmonyos',
      publicKeyJwk: { kty: 'EC' }, scopes: ['notifications.self'],
    });
    registerNotificationDevice({
      deviceId: 'device-1',
      platform: 'harmonyos',
      pushToken: 'harmony-token',
      permissions: 'granted',
      locale: 'en',
    });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('delivers ordinary notifications', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const sendHarmony = vi.fn().mockResolvedValue('huawei-request-id');
    const service = new NotificationService({ publish: vi.fn(), fetch: fetchMock, sendHarmony });
    service.persistGatewayEvent('agent.run.ended', chatEvent);
    await service.drain();
    expect(notificationDeliveryMetrics()).toMatchObject({ accepted: 1 });
    expect(sendHarmony).toHaveBeenCalledOnce();
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


  it('routes HarmonyOS only to its own provider without receipt polling', async () => {
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
    const fetchMock = vi.fn<typeof fetch>();
    const sendHarmony = vi.fn().mockResolvedValue('huawei-request-id');
    const service = new NotificationService({
      publish: (_type, payload) => published.push(payload),
      fetch: fetchMock,
      sendHarmony,
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
    const fetchMock = vi.fn<typeof fetch>();
    const sendHarmony = vi.fn().mockResolvedValue('huawei-request-id');
    const service = new NotificationService({ publish: vi.fn(), fetch: fetchMock, sendHarmony });
    const event = (notificationKey: string) => ({
      notificationKey,
      opportunityId: `opportunity-${notificationKey}`,
      title: 'Prepare the launch review',
    });

    service.handleGatewayEvent('home.opportunity.ready', event('default-off'));
    await service.drain();
    expect(fetchMock).not.toHaveBeenCalled();

    registerNotificationDevice({
      deviceId: 'device-1', platform: 'harmonyos', pushToken: 'harmony-token',
      permissions: 'granted', locale: 'en', preferences: { homeOpportunity: true },
    });
    service.handleGatewayEvent('home.opportunity.ready', event('explicit-on'));
    await vi.waitFor(() => expect(notificationDeliveryMetrics()).toMatchObject({ accepted: 1 }));
    expect(sendHarmony).toHaveBeenCalledOnce();
  });
});
