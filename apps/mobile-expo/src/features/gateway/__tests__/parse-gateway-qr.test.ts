import { describe, expect, it } from 'vitest';

import { formatMobilePairingInvitation, MOBILE_PAIRING_INVITATION_VERSION } from '@xopcai/gateway-contract';

import { parseGatewayQrPayload } from '../parse-gateway-qr';

function link(overrides: Record<string, unknown> = {}): string {
  const payload = {
    version: MOBILE_PAIRING_INVITATION_VERSION,
    pairingToken: `xopc_pair_00000000-0000-4000-8000-000000000000_${'A'.repeat(43)}`,
    gatewayId: '00000000-0000-4000-8000-000000000000',
    gatewayPublicKey: 'A'.repeat(43),
    origins: ['https://gateway.example.com'],
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
  return formatMobilePairingInvitation(payload as Parameters<typeof formatMobilePairingInvitation>[0]);
}

describe('parseGatewayQrPayload', () => {
  it('parses the compact Universal Link payload', () => {
    expect(parseGatewayQrPayload(link())).toMatchObject({
      version: 4,
      gatewayId: '00000000-0000-4000-8000-000000000000',
      origins: ['https://gateway.example.com'],
    });
  });

  it('rejects expired and removed invitation formats', () => {
    expect(parseGatewayQrPayload(link({ expiresAt: Date.now() - 1 }))).toBeNull();
    expect(parseGatewayQrPayload('https://link.xopc.ai/connect#p=e30')).toBeNull();
    expect(parseGatewayQrPayload('xopc://gateway/mobile-connect?baseUrl=https://example.com&ps=old')).toBeNull();
  });

  it('rejects malformed compact payloads', () => {
    expect(parseGatewayQrPayload('https://link.xopc.ai/c#BA')).toBeNull();
    expect(parseGatewayQrPayload(`${link()}A`)).toBeNull();
  });
});
