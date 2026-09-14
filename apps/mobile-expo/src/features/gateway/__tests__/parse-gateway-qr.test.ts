import { describe, expect, it } from 'vitest';

import { encodeBase64Url } from '../device-crypto';
import { parseGatewayQrPayload } from '../parse-gateway-qr';

function link(overrides: Record<string, unknown> = {}): string {
  const payload = {
    version: 3,
    targetKind: 'mobile',
    pairingToken: `xopc_pair_00000000-0000-4000-8000-000000000000_${'a'.repeat(43)}`,
    gatewayId: '00000000-0000-4000-8000-000000000000',
    gatewayName: 'Studio',
    gatewayPublicKey: 'b'.repeat(43),
    routes: [{ id: 'secure-1', kind: 'custom-https', url: 'https://gateway.example.com' }],
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
  const encoded = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  return `https://link.xopc.ai/connect#p=${encoded}`;
}

describe('parseGatewayQrPayload', () => {
  it('parses the current Universal Link payload', () => {
    expect(parseGatewayQrPayload(link())).toMatchObject({
      version: 3,
      targetKind: 'mobile',
      gatewayId: '00000000-0000-4000-8000-000000000000',
      routes: [{ url: 'https://gateway.example.com' }],
    });
  });

  it('rejects expired, non-HTTPS, and old custom-scheme links', () => {
    expect(parseGatewayQrPayload(link({ expiresAt: Date.now() - 1 }))).toBeNull();
    expect(parseGatewayQrPayload(link({ targetKind: 'browser' }))).toBeNull();
    expect(parseGatewayQrPayload(link({ version: 2 }))).toBeNull();
    expect(parseGatewayQrPayload(link({ routes: [{ id: 'lan', kind: 'custom-https', url: 'http://192.168.1.2' }] }))).toBeNull();
    expect(parseGatewayQrPayload('xopc://gateway/mobile-connect?baseUrl=https://example.com&ps=old')).toBeNull();
  });
});
