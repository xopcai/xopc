import { describe, expect, it } from 'vitest';

import { createHonoApp } from '../../gateway/hono/app.js';

function mockService() {
  return {
    currentConfig: {
      gateway: {
        port: 18790,
        bind: 'loopback',
        auth: { mode: 'token' as const, token: 'a'.repeat(32) },
      },
      tunnel: {
        enabled: true,
        brokerUrl: 'https://frp.xopc.ai/api',
        autoStart: false,
      },
    },
    getAuthToken: () => 'gateway-secret-token',
    getResolvedAuth: () => ({ mode: 'token', token: 'gateway-secret-token' }),
    getHealth: () => ({ status: 'ok', version: '0', uptime: 0 }),
  } as unknown as import('../../gateway/service.js').GatewayService;
}

describe('GET /api/tunnel/status', () => {
  it('stays readable when an enabled public broker has no registration key', async () => {
    const app = createHonoApp({ service: mockService(), token: 'admin-token' });

    const res = await app.request('/api/tunnel/status', {
      headers: { Authorization: 'Bearer gateway-secret-token' },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      registrationSecret?: { configured?: boolean; source?: string };
      config?: { brokerUrl?: string };
    };
    expect(body.registrationSecret).toEqual({ configured: false, source: 'missing' });
    expect(body.config?.brokerUrl).toBe('https://frp.xopc.ai/api');
  });
});
