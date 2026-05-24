import { describe, expect, it, afterEach } from 'vitest';

import { createHonoApp } from '../../gateway/hono/app.js';
import { consumePairingSecret, createPairingSecret, resetPairingSessionsForTests } from '../pairing.js';
import { resetPairingExchangeLimitsForTests } from '../pairing-rate-limit.js';

function mockService() {
  return {
    currentConfig: {
      gateway: { port: 18790, host: '127.0.0.1', auth: { mode: 'token' as const } },
      tunnel: { enabled: false, brokerUrl: 'https://frp.xopc.ai/api', autoStart: false },
    },
    getAuthToken: () => 'gateway-secret-token',
    getHealth: () => ({ status: 'ok', version: '0', uptime: 0 }),
  } as unknown as import('../../gateway/service.js').GatewayService;
}

describe('POST /api/tunnel/exchange-token', () => {
  afterEach(() => {
    resetPairingSessionsForTests();
    resetPairingExchangeLimitsForTests();
  });

  it('exchanges a valid pairing secret for gateway token', async () => {
    const { secret } = createPairingSecret();
    const app = createHonoApp({ service: mockService(), token: 'admin-token' });

    const res = await app.request('/api/tunnel/exchange-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingSecret: secret }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { token?: string; connectUrls?: string[] };
    expect(body.token).toBe('gateway-secret-token');
    expect(Array.isArray(body.connectUrls)).toBe(true);
    expect(consumePairingSecret(secret)).toBe(false);
  });

  it('rejects invalid pairing secret', async () => {
    const app = createHonoApp({ service: mockService(), token: 'admin-token' });

    const res = await app.request('/api/tunnel/exchange-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingSecret: 'not-valid' }),
    });

    expect(res.status).toBe(401);
  });
});
