import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHonoApp } from '../../gateway/hono/app.js';
import { CURRENT_TUNNEL_CONSENT_VERSION } from '../consent.js';
import { getTunnelService } from '../tunnel-service.js';

function mockService() {
  return {
    currentConfig: {
      gateway: {
        port: 28790,
        bind: 'loopback',
        auth: { mode: 'token' as const, token: 'a'.repeat(32) },
      },
      tunnel: {
        enabled: false,
        brokerUrl: 'https://frp.xopc.ai/api',
        registrationSecret: 'test-registration-secret',
        autoStart: false,
        consent: {
          version: CURRENT_TUNNEL_CONSENT_VERSION,
          acceptedAt: new Date().toISOString(),
        },
      },
    },
    saveConfig: vi.fn(async () => ({ saved: true })),
    getAuthToken: () => 'gateway-secret-token',
    getResolvedAuth: () => ({ mode: 'token', token: 'gateway-secret-token' }),
    getHealth: () => ({ status: 'ok', version: '0', uptime: 0 }),
    emit: vi.fn(),
  } as unknown as import('../../gateway/service.js').GatewayService;
}

describe('POST /api/tunnel/start', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the pairing session ID created with the initial QR payload', async () => {
    vi.spyOn(getTunnelService(), 'start').mockResolvedValue({
      pairingSessionId: 'pair-session-1',
      qrPayload: 'xopc://gateway/mobile-connect?v=2&sid=pair-session-1&ps=secret',
      publicUrl: 'https://pair-session-1.frp.xopc.ai',
      lanUrl: null,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    const app = createHonoApp({ service: mockService(), token: 'admin-token' });

    const res = await app.request('/api/tunnel/start', {
      method: 'POST',
      headers: { Authorization: 'Bearer gateway-secret-token' },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(expect.objectContaining({
      pairingSessionId: 'pair-session-1',
      qrPayload: expect.stringContaining('sid=pair-session-1'),
    }));
  });
});
