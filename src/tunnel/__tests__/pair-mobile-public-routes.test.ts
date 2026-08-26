import { describe, expect, it, afterEach } from 'vitest';

import { createHonoApp } from '../../gateway/hono/app.js';
import { resetPairingSessionsForTests } from '../pairing.js';
import { resetPairingExchangeLimitsForTests } from '../pairing-rate-limit.js';

function mockService(overrides: { gateway?: Record<string, unknown>; tunnelState?: string } = {}) {
  return {
    currentConfig: {
      gateway: {
        port: 28790,
        bind: 'lan',
        auth: { mode: 'token' as const, token: 'a'.repeat(32) },
        ...overrides.gateway,
      },
      tunnel: { enabled: false, brokerUrl: 'https://frp.xopc.ai/api', autoStart: false },
    },
    saveConfig: async () => ({ saved: true }),
    getAuthToken: () => 'gateway-secret-token',
    getResolvedAuth: () => ({ mode: 'token', token: 'gateway-secret-token' }),
    getHealth: () => ({ status: 'ok', version: '0', uptime: 0 }),
    emit: () => {},
  } as unknown as import('../../gateway/service.js').GatewayService;
}

describe('GET /api/tunnel/pair/ping', () => {
  it('returns mobile pairing probe payload without auth', async () => {
    const app = createHonoApp({ service: mockService(), token: 'admin-token' });

    const res = await app.request('/api/tunnel/pair/ping');

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok?: boolean;
      mobilePairing?: boolean;
      port?: number;
      pairingReady?: boolean;
      connectUrls?: string[];
    };
    expect(body.ok).toBe(true);
    expect(body.mobilePairing).toBe(true);
    expect(body.port).toBe(28790);
    expect(body.pairingReady).toBe(true);
    expect(body.connectUrls?.length).toBeGreaterThan(0);
  });
});

describe('POST /api/tunnel/pair/validate-url', () => {
  it('rejects loopback manual URLs', async () => {
    const app = createHonoApp({ service: mockService(), token: 'admin-token' });

    const res = await app.request('/api/tunnel/pair/validate-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: 'http://127.0.0.1:28790' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; code?: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe('LOOPBACK_NOT_REACHABLE');
  });

  it('accepts LAN URLs and suggests ping path', async () => {
    const app = createHonoApp({ service: mockService(), token: 'admin-token' });

    const res = await app.request('/api/tunnel/pair/validate-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: 'http://192.168.50.10:28790' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; url?: string; probePath?: string };
    expect(body.ok).toBe(true);
    expect(body.url).toBe('http://192.168.50.10:28790');
    expect(body.probePath).toBe('/api/tunnel/pair/ping');
  });
});

describe('POST /api/tunnel/exchange-token connectUrls', () => {
  afterEach(() => {
    resetPairingSessionsForTests();
    resetPairingExchangeLimitsForTests();
  });

  it('returns ordered connectUrls with LAN before tunnel', async () => {
    const { createPairingSecret } = await import('../pairing.js');
    const { secret } = createPairingSecret();
    const app = createHonoApp({ service: mockService(), token: 'admin-token' });

    const res = await app.request('/api/tunnel/exchange-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingSecret: secret }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { lanUrl?: string | null; connectUrls?: string[] };
    expect(body.lanUrl).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:28790$/);
    expect(body.connectUrls?.[0]).toBe(body.lanUrl);
  });
});
