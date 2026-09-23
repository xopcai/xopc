import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatBrowserPairingInvitation } from '@xopcai/gateway-contract';

import { gatewayFetch, parseBrowserPairingInvitation, readProfile } from './auth';

afterEach(() => vi.unstubAllGlobals());

function invitation(overrides: Record<string, unknown> = {}): string {
  const payload = {
    version: 3,
    targetKind: 'browser',
    pairingToken: `xopc_pair_00000000-0000-4000-8000-000000000000_${'a'.repeat(43)}`,
    gatewayId: '00000000-0000-4000-8000-000000000000',
    gatewayName: 'Workstation',
    gatewayPublicKey: 'b'.repeat(43),
    routes: [{ id: 'secure-link', kind: 'custom-https', url: 'https://gateway.example.com' }],
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
  const encoded = btoa(JSON.stringify(payload))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  return formatBrowserPairingInvitation(encoded);
}

describe('parseBrowserPairingInvitation', () => {
  it('accepts a current browser invitation copied from xopc', () => {
    expect(parseBrowserPairingInvitation(invitation())).toMatchObject({
      version: 3,
      targetKind: 'browser',
      gatewayId: '00000000-0000-4000-8000-000000000000',
    });
  });

  it('rejects navigable links', () => {
    expect(() => parseBrowserPairingInvitation('https://link.xopc.ai/connect#p=payload'))
      .toThrow('Browser pairing invitation is invalid');
  });

  it('rejects invitations created for phones', () => {
    expect(() => parseBrowserPairingInvitation(invitation({ targetKind: 'mobile' })))
      .toThrow('Pairing invitation version is not supported');
  });
});

describe('browser pairing recovery', () => {
  it('clears a completed pairing journal when the durable profile exists', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', { storage: { local: {
      get: vi.fn().mockResolvedValue({
        'xopc.browser.profile': {
          gatewayId: 'gateway-1', gatewayName: 'Workstation', gatewayUrl: 'https://gateway.example.com',
          gatewayPublicKey: 'key', deviceId: 'device-1', refreshToken: 'refresh', accessToken: 'access',
          accessTokenExpiresAt: Date.now() + 60_000,
        },
        'xopc.browser.pairing': {
          requestId: 'request-1',
          payload: { gatewayId: 'gateway-1' },
          completed: { deviceId: 'device-1', gatewayName: 'Workstation' },
        },
      }),
      remove,
    } } });

    expect((await readProfile())?.deviceId).toBe('device-1');
    expect(remove).toHaveBeenCalledWith('xopc.browser.pairing');
  });

  it('keeps an in-progress pairing journal when an older profile still exists', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', { storage: { local: {
      get: vi.fn().mockResolvedValue({
        'xopc.browser.profile': {
          gatewayId: 'gateway-1', gatewayName: 'Workstation', gatewayUrl: 'https://gateway.example.com',
          gatewayPublicKey: 'key', deviceId: 'device-1', refreshToken: 'refresh', accessToken: 'access',
          accessTokenExpiresAt: Date.now() + 60_000,
        },
        'xopc.browser.pairing': {
          requestId: 'request-2',
          payload: { gatewayId: 'gateway-1' },
        },
      }),
      remove,
    } } });

    expect((await readProfile())?.deviceId).toBe('device-1');
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('browser access recovery', () => {
  it('uses a concurrently refreshed profile after a 401 without restoring the stale refresh token', async () => {
    const oldProfile = {
      gatewayId: 'gateway-1', gatewayName: 'Workstation', gatewayUrl: 'https://gateway.example.com',
      gatewayPublicKey: 'key', deviceId: 'device-1', refreshToken: 'refresh-old', accessToken: 'access-old',
      accessTokenExpiresAt: Date.now() + 60_000,
    };
    const newProfile = {
      ...oldProfile,
      refreshToken: 'refresh-new',
      accessToken: 'access-new',
      accessTokenExpiresAt: Date.now() + 120_000,
    };
    const values: Record<string, unknown> = { 'xopc.browser.profile': oldProfile };
    const set = vi.fn(async (update: Record<string, unknown>) => Object.assign(values, update));
    const remove = vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
    });
    vi.stubGlobal('chrome', { storage: { local: {
      get: vi.fn(async (keys: string | string[]) => {
        const requested = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(requested.map(key => [key, values[key]]));
      }),
      set,
      remove,
    } } });
    const authorizations: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get('Authorization') ?? '';
      authorizations.push(authorization);
      if (authorization === 'Bearer access-old') {
        values['xopc.browser.profile'] = newProfile;
        return new Response('', { status: 401 });
      }
      return new Response('{}', { status: 200 });
    }));

    await expect(gatewayFetch('/api/status')).resolves.toMatchObject({ status: 200 });
    expect(authorizations).toEqual(['Bearer access-old', 'Bearer access-new']);
    expect(values['xopc.browser.profile']).toEqual(newProfile);
    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
