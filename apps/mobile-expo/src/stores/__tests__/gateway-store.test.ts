import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../storage/device-credentials', () => ({ deleteDeviceRefreshToken: vi.fn() }));
vi.mock('expo-constants', () => ({
  default: { executionEnvironment: 'storeClient' },
  ExecutionEnvironment: { StoreClient: 'storeClient' },
}));

import { KEYS, storage } from '../../storage/mmkv';
import { useGatewayStore } from '../gateway-store';
import type { GatewayProfile } from '../gateway-types';

const profile: GatewayProfile = {
  gatewayId: 'gateway-1',
  name: 'Studio',
  gatewayPublicKey: 'public-key',
  deviceId: 'device-1',
  scopes: ['gateway.status'],
  routes: [
    { id: 'primary', kind: 'custom-https', url: 'https://gateway.example.com' },
    { id: 'backup', kind: 'tailscale', url: 'https://gateway.tailnet.ts.net' },
  ],
  activeRouteId: 'primary',
  updatedAt: 1,
};

describe('gateway store', () => {
  beforeEach(() => {
    storage.delete(KEYS.profiles);
    storage.delete(KEYS.activeId);
    useGatewayStore.setState({
      profiles: [], activeGatewayId: null, accessToken: null,
      accessTokenExpiresAt: 0, unauthorized: false,
    });
  });

  it('persists profile metadata but keeps access credentials in memory', () => {
    useGatewayStore.getState().savePairedProfile(profile, 'access-secret', 10_000);
    expect(storage.getString(KEYS.profiles)).not.toContain('access-secret');
    useGatewayStore.getState().hydrateFromStorage();
    expect(useGatewayStore.getState().getActiveProfile()).toEqual(profile);
    expect(useGatewayStore.getState().accessToken).toBeNull();
  });

  it('selects an explicit secure route', () => {
    useGatewayStore.getState().savePairedProfile(profile, 'access-secret', 10_000);
    useGatewayStore.getState().selectRoute(profile.gatewayId, 'backup');
    expect(useGatewayStore.getState().apiUrl('/api/status')).toBe('https://gateway.tailnet.ts.net/api/status');
  });

  it('deletes obsolete flat profiles instead of migrating them', () => {
    storage.set(KEYS.profiles, JSON.stringify([{ id: 'old', baseUrl: 'http://192.168.1.2', token: 'old' }]));
    useGatewayStore.getState().hydrateFromStorage();
    expect(useGatewayStore.getState().profiles).toEqual([]);
    expect(storage.getString(KEYS.profiles)).toBeUndefined();
  });
});
