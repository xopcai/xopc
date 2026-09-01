import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activeGatewayId: 'home' as string | null,
  profiles: [
    {
      id: 'home',
      name: 'Home',
      baseUrl: 'https://home.example.com',
      lanUrl: null,
      token: 'home-token',
      updatedAt: 1,
    },
    {
      id: 'office',
      name: 'Office',
      baseUrl: 'https://office.example.com',
      lanUrl: 'http://192.168.1.20:18790',
      token: 'office-token',
      updatedAt: 2,
    },
    {
      id: 'lab',
      name: 'Lab',
      baseUrl: 'https://lab.example.com',
      lanUrl: null,
      token: 'lab-token',
      updatedAt: 3,
    },
  ],
  preflight: vi.fn(),
  activateProfile: vi.fn((id: string) => {
    mocks.activeGatewayId = id;
  }),
  setState: vi.fn(),
  sync: vi.fn(),
  writeLastGoodRoute: vi.fn(),
  acceptVerifiedGatewayRoute: vi.fn(),
}));

vi.mock('../../../stores/gateway-store', () => ({
  useGatewayStore: {
    getState: () => ({
      activeGatewayId: mocks.activeGatewayId,
      profiles: mocks.profiles,
      activateProfile: mocks.activateProfile,
    }),
    setState: mocks.setState,
  },
}));

vi.mock('../preflight-credentials', () => ({
  preflightGatewayCredentials: mocks.preflight,
}));

vi.mock('../gateway-connection-sync', () => ({
  syncGatewayAfterConnectivityChange: mocks.sync,
}));

vi.mock('../last-good-route', () => ({
  writeLastGoodRoute: mocks.writeLastGoodRoute,
}));

vi.mock('../network-info', () => ({
  getNetworkSnapshot: () => ({ key: 'wifi:test' }),
}));

vi.mock('../probe-coordinator', () => ({
  acceptVerifiedGatewayRoute: mocks.acceptVerifiedGatewayRoute,
}));

import { GatewayConnectivityError } from '../../../api/gateway-error';
import {
  cancelGatewaySwitch,
  resetGatewaySwitchServiceForTests,
  switchGatewayProfile,
} from '../gateway-switch-service';

beforeEach(() => {
  mocks.activeGatewayId = 'home';
  mocks.preflight.mockReset();
  mocks.activateProfile.mockClear();
  mocks.setState.mockClear();
  mocks.sync.mockClear();
  mocks.writeLastGoodRoute.mockClear();
  mocks.acceptVerifiedGatewayRoute.mockClear();
  resetGatewaySwitchServiceForTests();
});

describe('switchGatewayProfile', () => {
  it('commits only after the candidate passes preflight', async () => {
    mocks.preflight.mockResolvedValue({
      ok: true,
      winner: 'lan',
      url: 'http://192.168.1.20:18790',
      latencyMs: 28,
    });

    await expect(switchGatewayProfile('office')).resolves.toEqual({
      status: 'switched',
      profileId: 'office',
    });
    expect(mocks.preflight).toHaveBeenCalledWith({
      baseUrl: 'https://office.example.com',
      lanUrl: 'http://192.168.1.20:18790',
      token: 'office-token',
    });
    expect(mocks.activateProfile).toHaveBeenCalledWith('office');
    expect(mocks.setState).toHaveBeenCalledWith({
      activeBaseUrl: 'http://192.168.1.20:18790',
    });
    expect(mocks.sync).toHaveBeenCalledWith({ immediate: true, resetQueries: true });
    expect(mocks.acceptVerifiedGatewayRoute).toHaveBeenCalledWith({
      profileId: 'office',
      baseUrl: 'https://office.example.com',
      lanUrl: 'http://192.168.1.20:18790',
      token: 'office-token',
      winner: 'lan',
      url: 'http://192.168.1.20:18790',
      latencyMs: 28,
    });
  });

  it('keeps the current gateway untouched when verification fails', async () => {
    const error = new GatewayConnectivityError('no-route', 'unreachable');
    mocks.preflight.mockResolvedValue({ ok: false, error });

    await expect(switchGatewayProfile('lab')).resolves.toEqual({
      status: 'failed',
      profileId: 'lab',
      error,
    });
    expect(mocks.activeGatewayId).toBe('home');
    expect(mocks.activateProfile).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it('allows only the latest concurrent selection to commit', async () => {
    let resolveOffice!: (value: {
      ok: true;
      winner: 'tunnel';
      url: string;
    }) => void;
    mocks.preflight
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveOffice = resolve;
      }))
      .mockResolvedValueOnce({
        ok: true,
        winner: 'tunnel',
        url: 'https://lab.example.com',
      });

    const office = switchGatewayProfile('office');
    const lab = switchGatewayProfile('lab');
    await expect(lab).resolves.toMatchObject({ status: 'switched', profileId: 'lab' });
    resolveOffice({ ok: true, winner: 'tunnel', url: 'https://office.example.com' });
    await expect(office).resolves.toEqual({ status: 'superseded', profileId: 'office' });
    expect(mocks.activateProfile).toHaveBeenCalledTimes(1);
    expect(mocks.activateProfile).toHaveBeenCalledWith('lab');
  });

  it('does not commit after the switch UI is dismissed', async () => {
    let resolvePreflight!: (value: {
      ok: true;
      winner: 'tunnel';
      url: string;
    }) => void;
    mocks.preflight.mockReturnValue(new Promise((resolve) => {
      resolvePreflight = resolve;
    }));

    const pending = switchGatewayProfile('office');
    cancelGatewaySwitch();
    resolvePreflight({ ok: true, winner: 'tunnel', url: 'https://office.example.com' });

    await expect(pending).resolves.toEqual({ status: 'superseded', profileId: 'office' });
    expect(mocks.activateProfile).not.toHaveBeenCalled();
  });
});
