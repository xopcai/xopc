import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined }));

const mocks = vi.hoisted(() => ({
  getToken: vi.fn(),
  isEnabled: vi.fn(),
  requestPermission: vi.fn(),
  request: vi.fn(),
  write: vi.fn(),
}));

vi.mock('@kit.PushKit', () => ({ pushService: { getToken: mocks.getToken } }));
vi.mock('@kit.NotificationKit', () => ({
  notificationManager: { isNotificationEnabled: mocks.isEnabled, requestEnableNotification: mocks.requestPermission },
}));
vi.mock('@kit.PerformanceAnalysisKit', () => ({ hilog: { warn: vi.fn() } }));
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({
  gatewaySession: { currentProfile: () => ({ deviceId: 'test-device' }), request: mocks.request },
}));
vi.mock('../entry/src/main/ets/service/secureStore.ets', () => ({
  XopcSecureStore: class { write = mocks.write; },
}));
vi.mock('../entry/src/main/ets/service/settings.ets', () => ({ appSettings: { effectiveLanguage: () => 'zh' } }));
vi.mock('../entry/src/main/ets/common/appInfo.ets', () => ({ xopcAppVersion: () => '1.0' }));
vi.mock('../entry/src/main/ets/service/transport.ets', () => ({
  XopcHttpError: class extends Error {
    constructor(readonly status: number, readonly body: string) { super(`HTTP_${status}`); }
  },
}));

import { XopcPushNotifications } from '../entry/src/main/ets/service/pushNotifications.ets';
import { XopcHttpError } from '../entry/src/main/ets/service/transport.ets';

describe('Harmony notification enablement', () => {
  let push: XopcPushNotifications;
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getToken.mockResolvedValue('fixture-push-token');
    mocks.isEnabled.mockResolvedValue(true);
    push = new XopcPushNotifications();
    push.onWindowReady();
  });

  it('reports unopened Push Kit when Huawei rejects the app entitlement', async () => {
    mocks.getToken.mockRejectedValueOnce(Object.assign(new Error('Push rights are not activated'), { code: 1000900012 }));
    await push.enable({} as never);
    expect(push.error).toBe('PUSH_KIT_NOT_ENABLED');
    expect(push.enabled).toBe(false);
    expect(push.busy).toBe(false);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('reports denied notification permission before requesting a token', async () => {
    mocks.isEnabled.mockResolvedValue(false);
    await push.enable({} as never);
    expect(mocks.requestPermission).toHaveBeenCalledOnce();
    expect(push.error).toBe('NOTIFICATION_PERMISSION_REQUIRED');
    expect(mocks.getToken).not.toHaveBeenCalled();
  });

  it('reports that the platform push provider is unavailable and can retry registration', async () => {
    mocks.request.mockRejectedValueOnce(new XopcHttpError(503, '{"error":{"code":"PUSH_PLATFORM_UNAVAILABLE"}}'));
    await push.enable({} as never);
    expect(push.error).toBe('PUSH_PLATFORM_UNAVAILABLE');
    expect(mocks.write).not.toHaveBeenCalled();
    await push.enable({} as never);
    expect(mocks.request).toHaveBeenLastCalledWith('/api/devices/me/push', 'PUT', expect.stringContaining('"platform":"harmonyos"'));
    expect(mocks.write).toHaveBeenCalledWith('push.test-device', 'enabled');
    expect(push.error).toBe('');
    expect(push.registered).toBe(true);
  });
});
