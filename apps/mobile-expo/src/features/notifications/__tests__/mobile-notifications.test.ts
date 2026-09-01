import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  getPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  getExpoPushToken: vi.fn(),
  apiFetch: vi.fn(),
  setNotificationsEnabled: vi.fn(),
  schedule: vi.fn(),
  setChannel: vi.fn(),
  setHandler: vi.fn(),
}));

vi.mock('expo-constants', () => ({
  default: {
    appOwnership: null,
    expoConfig: {
      extra: { eas: { projectId: 'project-id' } },
      version: '1.0.0',
    },
  },
}));
vi.mock('expo-device', () => ({ isDevice: true }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  getExpoPushTokenAsync: state.getExpoPushToken,
  getPermissionsAsync: state.getPermissions,
  requestPermissionsAsync: state.requestPermissions,
  scheduleNotificationAsync: state.schedule,
  setNotificationChannelAsync: state.setChannel,
  setNotificationHandler: state.setHandler,
}));
vi.mock('../../../api/client', () => ({ apiFetch: state.apiFetch }));
vi.mock('../../../product/usage-metrics', () => ({ recordUsageEvent: vi.fn() }));
vi.mock('../../../storage/mmkv', () => ({
  KEYS: { mobileInstallationId: 'mobileInstallationId' },
  storage: { getString: vi.fn(), set: vi.fn() },
}));
vi.mock('../../../stores/gateway-store', () => ({
  useGatewayStore: { getState: vi.fn(() => ({})) },
}));
vi.mock('../../../stores/preferences-store', () => ({
  usePreferencesStore: {
    getState: vi.fn(() => ({
      language: 'en',
      setNotificationsEnabled: state.setNotificationsEnabled,
    })),
  },
}));

import {
  enableMobileNotifications,
  showLocalMobileNotification,
  syncMobileNotificationRegistration,
} from '../mobile-notifications';

describe('local mobile notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.getPermissions.mockResolvedValue({ status: 'granted' });
    state.requestPermissions.mockResolvedValue({ status: 'granted' });
    state.getExpoPushToken.mockResolvedValue({ data: 'ExponentPushToken[token]' });
    state.apiFetch.mockResolvedValue({ ok: true, status: 201 });
    state.schedule.mockResolvedValue('notification-1');
  });

  it('schedules through the existing native notification channel', async () => {
    await showLocalMobileNotification('Finished', 'Your task is ready.');
    expect(state.setChannel).toHaveBeenCalledWith('xopc-default', {
      name: 'xopc',
      importance: 3,
    });
    expect(state.schedule).toHaveBeenCalledWith({
      content: { title: 'Finished', body: 'Your task is ready.' },
      trigger: null,
    });
  });

  it('does not request permission when notifications are denied', async () => {
    state.getPermissions.mockResolvedValueOnce({ status: 'denied' });
    await expect(showLocalMobileNotification('Finished', 'Your task is ready.'))
      .rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(state.schedule).not.toHaveBeenCalled();
  });

  it('registers an enabled device with the gateway', async () => {
    await expect(enableMobileNotifications()).resolves.toEqual({ ok: true });

    expect(state.requestPermissions).not.toHaveBeenCalled();
    expect(state.getExpoPushToken).toHaveBeenCalledWith({ projectId: 'project-id' });
    expect(state.apiFetch).toHaveBeenCalledWith('/api/mobile/devices/register', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('returns a permission reason without contacting the gateway', async () => {
    state.getPermissions.mockResolvedValueOnce({ status: 'undetermined' });
    state.requestPermissions.mockResolvedValueOnce({ status: 'denied' });

    await expect(enableMobileNotifications()).resolves.toEqual({
      ok: false,
      reason: 'permission-denied',
    });
    expect(state.apiFetch).not.toHaveBeenCalled();
  });

  it('turns token failures into an actionable result', async () => {
    state.getExpoPushToken.mockRejectedValueOnce(new Error('Firebase is not configured'));

    await expect(enableMobileNotifications()).resolves.toEqual({
      ok: false,
      reason: 'token-unavailable',
    });
    expect(state.apiFetch).not.toHaveBeenCalled();
  });

  it('clears the local intent when system permission was revoked', async () => {
    state.getPermissions.mockResolvedValue({ status: 'denied' });

    await expect(syncMobileNotificationRegistration()).resolves.toBe(false);

    expect(state.setNotificationsEnabled).toHaveBeenCalledWith(false);
    expect(state.apiFetch).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/mobile\/devices\//),
      { method: 'DELETE' },
    );
  });
});
