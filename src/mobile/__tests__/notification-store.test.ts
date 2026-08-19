import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import {
  acknowledgeMobileActivityEvent,
  createMobileActivityEvent,
  getMobileDevice,
  listEnabledMobileDevices,
  registerMobileDevice,
  updateMobileDevicePreferences,
} from '../notification-store.js';

describe('mobile notification store', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-mobile-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('registers a device, rotates a duplicate token, and persists preferences', () => {
    registerMobileDevice({
      id: 'old-device', platform: 'ios', pushToken: 'ExponentPushToken[token]', permissions: 'granted',
    });
    const current = registerMobileDevice({
      id: 'current-device', platform: 'android', pushToken: 'ExponentPushToken[token]', permissions: 'granted',
      preferences: { completed: true },
    });

    expect(getMobileDevice('old-device')).toBeNull();
    expect(current.preferences).toMatchObject({ needsInput: true, completed: true });
    expect(updateMobileDevicePreferences('current-device', { failed: false })?.preferences).toMatchObject({
      completed: true,
      failed: false,
    });
    expect(listEnabledMobileDevices()).toHaveLength(1);
  });

  it('retains existing preferences when refreshing a device registration', () => {
    registerMobileDevice({
      id: 'device-1', platform: 'ios', pushToken: 'ExponentPushToken[original]', permissions: 'granted',
      preferences: { completed: true, failed: false },
    });

    const refreshed = registerMobileDevice({
      id: 'device-1', platform: 'ios', pushToken: 'ExponentPushToken[rotated]', permissions: 'granted',
    });

    expect(refreshed.preferences).toMatchObject({ completed: true, failed: false });
  });

  it('records mobile activity and acknowledges it for a registered device', () => {
    registerMobileDevice({
      id: 'device-1', platform: 'ios', pushToken: 'ExponentPushToken[token]', permissions: 'granted',
    });
    const event = createMobileActivityEvent({
      type: 'task.blocked',
      entity: { kind: 'task', id: 'task-1' },
      priority: 'high',
      title: 'Task blocked',
      deepLink: '/chat/session-1',
      payload: { route: '/chat/session-1' },
    });

    expect(acknowledgeMobileActivityEvent(event.id, 'device-1')).toBe(true);
    expect(acknowledgeMobileActivityEvent(event.id, 'missing')).toBe(false);
  });
});
