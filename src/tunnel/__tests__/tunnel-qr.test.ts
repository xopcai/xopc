import { describe, expect, it } from 'vitest';

import { buildMobileConnectQrPayload, resolveLanGatewayUrl } from '../tunnel-qr.js';

describe('tunnel-qr', () => {
  it('returns null lanUrl for loopback gateway host', () => {
    expect(resolveLanGatewayUrl('127.0.0.1', 18790)).toBeNull();
    expect(resolveLanGatewayUrl('localhost', 18790)).toBeNull();
  });

  it('builds mobile-connect payload with tunnel and lan', () => {
    const qr = buildMobileConnectQrPayload({
      publicUrl: 'https://abc123.frp.xopc.ai',
      lanUrl: 'http://192.168.1.10:18790',
      gatewayToken: 'secret',
    });
    expect(qr.qrPayload).toContain('xopc://gateway/mobile-connect');
    expect(qr.qrPayload).toContain('baseUrl=');
    expect(qr.qrPayload).toContain('lanUrl=');
    expect(qr.qrPayload).toContain('token=secret');
  });

  it('omits lanUrl param when not on LAN', () => {
    const qr = buildMobileConnectQrPayload({
      publicUrl: 'https://abc123.frp.xopc.ai',
      lanUrl: null,
      gatewayToken: 't',
    });
    expect(qr.qrPayload).not.toContain('lanUrl=');
  });
});
