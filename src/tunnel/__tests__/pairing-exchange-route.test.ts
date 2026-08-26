import { describe, expect, it, afterEach, vi } from 'vitest';

import { createHonoApp } from '../../gateway/hono/app.js';
import { consumePairingSecret, createPairingSecret, resetPairingSessionsForTests } from '../pairing.js';
import { resetPairingExchangeLimitsForTests } from '../pairing-rate-limit.js';

function mockService(emit = vi.fn()) {
  return {
    currentConfig: {
      gateway: { port: 18790, bind: 'loopback', auth: { mode: 'token' as const } },
      tunnel: { enabled: false, brokerUrl: 'https://frp.xopc.ai/api', autoStart: false },
    },
    getAuthToken: () => 'gateway-secret-token',
    getResolvedAuth: () => ({ mode: 'token', token: 'gateway-secret-token' }),
    getHealth: () => ({ status: 'ok', version: '0', uptime: 0 }),
    emit,
  } as unknown as import('../../gateway/service.js').GatewayService;
}

describe('POST /api/tunnel/exchange-token', () => {
  afterEach(() => {
    resetPairingSessionsForTests();
    resetPairingExchangeLimitsForTests();
  });

  it('exchanges a valid pairing secret for gateway token', async () => {
    const { pairingSessionId, secret } = createPairingSecret();
    const emit = vi.fn();
    const app = createHonoApp({ service: mockService(emit), token: 'admin-token' });

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
    expect(emit).toHaveBeenCalledWith('mobile.pairing.completed', expect.objectContaining({ pairingSessionId }));
  });

  it('deduplicates concurrent exchange for the same secret', async () => {
    const { secret } = createPairingSecret();
    const app = createHonoApp({ service: mockService(), token: 'admin-token' });

    const body = JSON.stringify({ pairingSecret: secret });
    const [a, b] = await Promise.all([
      app.request('/api/tunnel/exchange-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
      app.request('/api/tunnel/exchange-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const ja = (await a.json()) as { token?: string };
    const jb = (await b.json()) as { token?: string };
    expect(ja.token).toBe('gateway-secret-token');
    expect(jb.token).toBe('gateway-secret-token');
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
