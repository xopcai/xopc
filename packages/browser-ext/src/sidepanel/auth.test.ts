import { describe, expect, it } from 'vitest';

import { parseBrowserPairingLink } from './auth';

function invitation(overrides: Record<string, unknown> = {}, origin = 'https://link.xopc.ai'): string {
  const payload = {
    version: 3,
    targetKind: 'browser',
    pairingToken: 'xopc_pair_test_secret',
    gatewayId: 'gateway-1',
    gatewayName: 'Workstation',
    gatewayPublicKey: 'public-key',
    routes: [{ id: 'secure-link', url: 'https://gateway.example.com' }],
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
  const encoded = btoa(JSON.stringify(payload))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  return `${origin}/connect#p=${encoded}`;
}

describe('parseBrowserPairingLink', () => {
  it('accepts a current browser invitation from the xopc handoff page', () => {
    expect(parseBrowserPairingLink(invitation())).toMatchObject({
      version: 3,
      targetKind: 'browser',
      gatewayId: 'gateway-1',
    });
  });

  it('rejects invitations copied to another origin', () => {
    expect(() => parseBrowserPairingLink(invitation({}, 'https://example.com')))
      .toThrow('Pairing link is not from xopc');
  });

  it('rejects invitations created for phones', () => {
    expect(() => parseBrowserPairingLink(invitation({ targetKind: 'mobile' })))
      .toThrow('Pairing link version is not supported');
  });
});
