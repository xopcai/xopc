import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  createDevice,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import {
  getNotificationDevice,
  listDeliverableNotificationDevices,
  registerNotificationDevice,
  updateNotificationDevicePreferences,
} from '../device-store.js';
import {
  acknowledgeNotification,
  createNotificationEvent,
  listDueNotificationDeliveries,
  listNotificationEvents,
} from '../store.js';

describe('notification persistence', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-notifications-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  function addDevice(id: string, platform: 'ios' | 'android' = 'ios'): void {
    createDevice({ id, displayName: id, platform, publicKeyJwk: { kty: 'EC' }, scopes: ['notifications.self'] });
  }

  it('renews a device lease, rotates duplicate tokens, and keeps explicit preferences', () => {
    addDevice('old');
    addDevice('current', 'android');
    registerNotificationDevice({
      deviceId: 'old', platform: 'ios', pushToken: 'ExponentPushToken[token]', permissions: 'granted', locale: 'en',
    });
    const current = registerNotificationDevice({
      deviceId: 'current', platform: 'android', pushToken: 'ExponentPushToken[token]', permissions: 'granted', locale: 'zh',
      preferences: { chatFailed: false },
    });
    expect(getNotificationDevice('old')).toBeNull();
    expect(current).toMatchObject({ locale: 'zh', preferences: { chatCompleted: true, chatFailed: false } });
    expect(current.leaseExpiresAt).toBeGreaterThan(current.updatedAt);
    expect(updateNotificationDevicePreferences('current', { taskCompleted: true })?.preferences.taskCompleted).toBe(true);
    expect(listDeliverableNotificationDevices()).toHaveLength(1);
    expect(listDeliverableNotificationDevices(current.leaseExpiresAt + 1)).toHaveLength(0);
  });

  it('atomically deduplicates events and enqueues their device deliveries', () => {
    addDevice('device-1');
    registerNotificationDevice({
      deviceId: 'device-1', platform: 'ios', pushToken: 'ExponentPushToken[token]', permissions: 'granted', locale: 'en',
    });
    const input = {
      dedupeKey: 'chat.completed:run-1',
      notification: {
        type: 'chat.completed' as const,
        target: { kind: 'chat' as const, sessionKey: 'session-1' },
        priority: 'normal' as const,
        title: { en: 'Response ready', zh: '回答已就绪' },
        payload: { runId: 'run-1' },
      },
      deviceIds: ['device-1'],
      createdAt: 10,
    };
    const first = createNotificationEvent(input);
    const repeated = createNotificationEvent(input);
    expect(first.created).toBe(true);
    expect(repeated).toMatchObject({ created: false, notification: { id: first.notification.id } });
    expect(listNotificationEvents({ since: 0 }).items).toHaveLength(1);
    expect(listDueNotificationDeliveries('pending', 10)).toMatchObject([{
      event: { id: first.notification.id }, deviceId: 'device-1', locale: 'en',
    }]);
    expect(acknowledgeNotification(first.notification.id, 'browser-1', 'web')).toBe(true);
  });
});
