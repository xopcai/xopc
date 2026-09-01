import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  getPermissions: vi.fn(),
  schedule: vi.fn(),
  setChannel: vi.fn(),
  setHandler: vi.fn(),
}));

vi.mock('expo-constants', () => ({ default: { appOwnership: null, expoConfig: null } }));
vi.mock('expo-device', () => ({ isDevice: true }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  getPermissionsAsync: state.getPermissions,
  scheduleNotificationAsync: state.schedule,
  setNotificationChannelAsync: state.setChannel,
  setNotificationHandler: state.setHandler,
}));
vi.mock('../../../api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../product/usage-metrics', () => ({ recordUsageEvent: vi.fn() }));
vi.mock('../../../storage/mmkv', () => ({
  KEYS: { mobileInstallationId: 'mobileInstallationId' },
  storage: { getString: vi.fn(), set: vi.fn() },
}));
vi.mock('../../../stores/gateway-store', () => ({
  useGatewayStore: { getState: vi.fn(() => ({})) },
}));
vi.mock('../../../stores/preferences-store', () => ({
  usePreferencesStore: { getState: vi.fn(() => ({ language: 'en' })) },
}));

import { showLocalMobileNotification } from '../mobile-notifications';

describe('local mobile notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.getPermissions.mockResolvedValue({ status: 'granted' });
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
});
