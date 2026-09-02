import { describe, expect, it } from 'vitest';

import { encodeBase64Url } from '../device-crypto';
import { parseGatewayQrPayload } from '../parse-gateway-qr';

function link(overrides: Record<string, unknown> = {}): string {
  const payload = {
    version: 2,
    pairingToken: 'xopc_pair_123_secret',
    gatewayId: 'gateway-1',
    gatewayName: 'Studio',
    gatewayPublicKey: 'public-key',
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
      version: 2,
      gatewayId: 'gateway-1',
      routes: [{ url: 'https://gateway.example.com' }],
    });
  });

  it('rejects expired, non-HTTPS, and old custom-scheme links', () => {
    expect(parseGatewayQrPayload(link({ expiresAt: Date.now() - 1 }))).toBeNull();
    expect(parseGatewayQrPayload(link({ routes: [{ id: 'lan', kind: 'custom-https', url: 'http://192.168.1.2' }] }))).toBeNull();
    expect(parseGatewayQrPayload('xopc://gateway/mobile-connect?baseUrl=https://example.com&ps=old')).toBeNull();
  });
});
