import { describe, expect, it } from 'vitest';

import { enumerateLanGatewayCandidates } from '../../gateway/host.js';
import { buildMobileConnectQrPayload, resolveLanGatewayUrl } from '../tunnel-qr.js';

describe('tunnel-qr', () => {
  it('returns null lanUrl for loopback gateway host', () => {
    expect(resolveLanGatewayUrl('127.0.0.1', 18790)).toBeNull();
    expect(resolveLanGatewayUrl('localhost', 18790)).toBeNull();
  });

  it('enumerateLanGatewayCandidates lists non-internal IPv4 urls', () => {
    const entries = enumerateLanGatewayCandidates(28790);
    for (const entry of entries) {
      expect(entry.url).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:28790$/);
      expect(entry.interfaceName.length).toBeGreaterThan(0);
    }
  });

  it('builds mobile-connect payload with tunnel, lan, and pairing secret', () => {
    const qr = buildMobileConnectQrPayload({
      pairingSessionId: 'pair-session-1',
      publicUrl: 'https://abc123.frp.xopc.ai',
      lanUrl: 'http://192.168.1.10:18790',
      pairingSecret: 'pair-secret-abc',
    });
    expect(qr.qrPayload).toContain('xopc://gateway/mobile-connect');
    expect(qr.qrPayload).toContain('v=2');
    expect(qr.qrPayload).toContain('sid=pair-session-1');
    expect(qr.pairingSessionId).toBe('pair-session-1');
    expect(qr.qrPayload).toContain('baseUrl=');
    expect(qr.qrPayload).toContain('lanUrl=');
    expect(qr.qrPayload).toContain('ps=pair-secret-abc');
    expect(qr.qrPayload).not.toContain('token=');
  });

  it('omits lanUrl param when not on LAN', () => {
    const qr = buildMobileConnectQrPayload({
      publicUrl: 'https://abc123.frp.xopc.ai',
      lanUrl: null,
      pairingSecret: 'ps1',
    });
    expect(qr.qrPayload).not.toContain('lanUrl=');
    expect(qr.qrPayload).toContain('ps=ps1');
  });
});
