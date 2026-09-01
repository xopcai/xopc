import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GatewayConnectivityError } from '../../../api/gateway-error';
import type { GatewayProfile, GatewayProfileInput } from '../../../stores/gateway-types';

const mocks = vi.hoisted(() => ({
  preflightGatewayCredentials: vi.fn(),
  commitVerifiedGatewayProfile: vi.fn(),
}));

const profiles: GatewayProfile[] = [];
const store = {
  profiles,
  findProfileByBaseUrl: vi.fn((url: string) => profiles.find((profile) => profile.baseUrl === url) ?? null),
  addProfile: vi.fn((input: GatewayProfileInput) => {
    profiles.push({
      id: 'created',
      name: input.name ?? 'New',
      baseUrl: input.baseUrl,
      lanUrl: input.lanUrl ?? null,
      token: input.token ?? '',
      updatedAt: 1,
    });
    return 'created';
  }),
  updateProfile: vi.fn((id: string, patch: Partial<GatewayProfile>) => {
    const profile = profiles.find((item) => item.id === id);
    if (profile) Object.assign(profile, patch, { updatedAt: profile.updatedAt + 1 });
  }),
};

vi.mock('../../../stores/gateway-store', () => ({
  useGatewayStore: { getState: () => store },
}));

vi.mock('../preflight-credentials', () => ({
  preflightGatewayCredentials: mocks.preflightGatewayCredentials,
}));

vi.mock('../gateway-switch-service', () => ({
  commitVerifiedGatewayProfile: mocks.commitVerifiedGatewayProfile,
}));

import { saveGatewayProfile } from '../save-gateway-profile';

describe('saveGatewayProfile', () => {
  beforeEach(() => {
    profiles.splice(0);
    store.findProfileByBaseUrl.mockClear();
    store.addProfile.mockClear();
    store.updateProfile.mockClear();
    mocks.preflightGatewayCredentials.mockReset();
    mocks.commitVerifiedGatewayProfile.mockReset();
  });

  it('does not persist or activate credentials that fail verification', async () => {
    const error = new GatewayConnectivityError('no-route', 'unreachable');
    mocks.preflightGatewayCredentials.mockResolvedValue({ ok: false, error });

    await expect(saveGatewayProfile({
      baseUrl: 'https://offline.example.com',
      token: 'token',
    })).rejects.toBe(error);

    expect(store.addProfile).not.toHaveBeenCalled();
    expect(store.updateProfile).not.toHaveBeenCalled();
    expect(mocks.commitVerifiedGatewayProfile).not.toHaveBeenCalled();
  });

  it('normalizes unexpected verification failures into a connectivity error', async () => {
    mocks.preflightGatewayCredentials.mockRejectedValue(new Error('socket failed'));

    await expect(saveGatewayProfile({
      baseUrl: 'https://offline.example.com',
    })).rejects.toMatchObject({ kind: 'unknown', message: 'Gateway verification failed' });

    expect(store.addProfile).not.toHaveBeenCalled();
    expect(mocks.commitVerifiedGatewayProfile).not.toHaveBeenCalled();
  });

  it('creates an inactive profile, then commits its verified route', async () => {
    const route = {
      ok: true as const,
      winner: 'tunnel' as const,
      url: 'https://new.example.com',
      latencyMs: 18,
    };
    mocks.preflightGatewayCredentials.mockResolvedValue(route);

    await expect(saveGatewayProfile({
      name: 'New',
      baseUrl: 'https://new.example.com',
      token: 'token',
    })).resolves.toEqual({ profileId: 'created', created: true });

    expect(store.addProfile).toHaveBeenCalledOnce();
    expect(mocks.commitVerifiedGatewayProfile).toHaveBeenCalledWith(profiles[0], route);
  });

  it('updates the requested profile only after verification and commits it', async () => {
    profiles.push({
      id: 'office',
      name: 'Office',
      baseUrl: 'https://old.example.com',
      lanUrl: null,
      token: 'old',
      updatedAt: 1,
    });
    const route = {
      ok: true as const,
      winner: 'lan' as const,
      url: 'http://192.168.1.8:18790',
    };
    mocks.preflightGatewayCredentials.mockResolvedValue(route);

    await expect(saveGatewayProfile({
      profileId: 'office',
      name: 'Office',
      baseUrl: 'https://new.example.com',
      lanUrl: 'http://192.168.1.8:18790',
      token: 'new',
    })).resolves.toEqual({ profileId: 'office', created: false });

    expect(store.updateProfile).toHaveBeenCalledWith('office', expect.objectContaining({
      baseUrl: 'https://new.example.com',
      token: 'new',
    }));
    expect(mocks.commitVerifiedGatewayProfile).toHaveBeenCalledWith(profiles[0], route);
  });
});
