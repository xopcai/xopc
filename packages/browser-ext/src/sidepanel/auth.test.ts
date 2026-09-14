import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatBrowserPairingInvitation } from '@xopcai/gateway-contract';

import { parseBrowserPairingInvitation, readProfile } from './auth';

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
        'xopc.browser.pairing': { requestId: 'request-1' },
      }),
      remove,
    } } });

    expect((await readProfile())?.deviceId).toBe('device-1');
    expect(remove).toHaveBeenCalledWith('xopc.browser.pairing');
  });
});
