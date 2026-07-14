import { describe, expect, it, afterEach } from 'vitest';

import { createHonoApp } from '../../gateway/hono/app.js';
import { resetPairingSessionsForTests } from '../pairing.js';
import { resetPairingExchangeLimitsForTests } from '../pairing-rate-limit.js';

function mockService() {
  return {
    currentConfig: {
      gateway: {
        port: 28790,
        bind: 'loopback',
        auth: { mode: 'token' as const, token: 'a'.repeat(32) },
      },
      tunnel: { enabled: false, brokerUrl: 'https://frp.xopc.ai/api', autoStart: false },
    },
    saveConfig: async () => ({ saved: true }),
    getAuthToken: () => 'gateway-secret-token',
    getResolvedAuth: () => ({ mode: 'token', token: 'gateway-secret-token' }),
    getHealth: () => ({ status: 'ok', version: '0', uptime: 0 }),
  } as unknown as import('../../gateway/service.js').GatewayService;
}

describe('GET /api/tunnel/pair/context', () => {
  afterEach(() => {
    resetPairingSessionsForTests();
    resetPairingExchangeLimitsForTests();
  });

  it('returns loopback block context for desktop defaults', async () => {
    const app = createHonoApp({ service: mockService(), token: 'admin-token' });

    const res = await app.request('/api/tunnel/pair/context', {
      headers: { Authorization: 'Bearer gateway-secret-token' },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      pairingReady?: boolean;
      blockReason?: string;
      port?: number;
      recommended?: { url?: string | null };
    };
    expect(body.port).toBe(28790);
    expect(body.pairingReady).toBe(false);
    expect(body.blockReason).toBe('GATEWAY_LOOPBACK_ONLY');
    expect(body.recommended?.url).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:28790$/);
  });
});

describe('POST /api/tunnel/pair/enable-lan', () => {
  afterEach(() => {
    resetPairingSessionsForTests();
    resetPairingExchangeLimitsForTests();
  });

  it('patches loopback config to lan bind and marks restart required', async () => {
    const service = mockService();
    const app = createHonoApp({ service, token: 'admin-token' });

    const res = await app.request('/api/tunnel/pair/enable-lan', {
      method: 'POST',
      headers: { Authorization: 'Bearer gateway-secret-token' },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok?: boolean;
      requiresRestart?: boolean;
      context?: { pairingReady?: boolean; bindMode?: string; blockReason?: string };
    };
    expect(body.ok).toBe(true);
    expect(body.requiresRestart).toBe(true);
    expect(body.context?.pairingReady).toBe(false);
    expect(body.context?.blockReason).toBe('GATEWAY_LOOPBACK_ONLY');
    expect(service.currentConfig.gateway?.bind).toBe('lan');
  });
});
