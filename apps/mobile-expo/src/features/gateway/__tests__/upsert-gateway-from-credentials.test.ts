import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyGatewayUpsert } from '../upsert-gateway-core';

const store = {
  findProfileByBaseUrl: vi.fn(),
  updateProfile: vi.fn(),
  switchGateway: vi.fn(),
  addProfile: vi.fn(),
};

describe('applyGatewayUpsert', () => {
  beforeEach(() => {
    store.findProfileByBaseUrl.mockReset();
    store.updateProfile.mockReset();
    store.switchGateway.mockReset();
    store.addProfile.mockReset();
  });

  it('updates an existing profile and switches to it', () => {
    store.findProfileByBaseUrl.mockReturnValue({ id: 'existing-id', baseUrl: 'https://gw.example.com' });

    const result = applyGatewayUpsert(store, {
      baseUrl: 'https://gw.example.com',
      lanUrl: 'http://10.0.0.2:18790',
      token: 'new-token',
    });

    expect(result).toEqual({ profileId: 'existing-id', created: false });
    expect(store.updateProfile).toHaveBeenCalledWith('existing-id', {
      baseUrl: 'https://gw.example.com',
      lanUrl: 'http://10.0.0.2:18790',
      token: 'new-token',
      name: undefined,
    });
    expect(store.switchGateway).toHaveBeenCalledWith('existing-id');
    expect(store.addProfile).not.toHaveBeenCalled();
  });

  it('creates a new profile when baseUrl is unknown', () => {
    store.findProfileByBaseUrl.mockReturnValue(null);
    store.addProfile.mockReturnValue('new-id');

    const result = applyGatewayUpsert(store, {
      baseUrl: 'https://new.example.com',
      token: 'token',
    });

    expect(result).toEqual({ profileId: 'new-id', created: true });
    expect(store.addProfile).toHaveBeenCalledWith(
      {
        baseUrl: 'https://new.example.com',
        lanUrl: undefined,
        token: 'token',
        name: undefined,
      },
      { setActive: true },
    );
    expect(store.updateProfile).not.toHaveBeenCalled();
  });
});
