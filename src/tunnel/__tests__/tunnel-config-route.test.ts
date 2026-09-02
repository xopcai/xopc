import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHonoApp } from '../../gateway/hono/app.js';
import { CURRENT_TUNNEL_CONSENT_VERSION } from '../consent.js';
import { getTunnelService } from '../tunnel-service.js';

function mockService() {
  const currentConfig = {
    gateway: {
      port: 18790,
      bind: 'loopback' as const,
      auth: { mode: 'token' as const, token: 'gateway-secret-token' },
    },
    agents: { default: 'main', list: [] },
    channels: {},
    tunnel: {
      enabled: true,
      brokerUrl: 'https://frp.xopc.ai/api',
      registrationSecret: 'registration-secret',
      autoStart: true,
      consent: {
        version: CURRENT_TUNNEL_CONSENT_VERSION,
        acceptedAt: new Date().toISOString(),
      },
    },
  };
  return {
    currentConfig,
    saveConfig: vi.fn(async () => ({ saved: true })),
    getAuthToken: () => 'gateway-secret-token',
    getResolvedAuth: () => ({ mode: 'token' as const, token: 'gateway-secret-token' }),
    getHealth: () => ({ status: 'ok', version: '0', uptime: 0 }),
    getExtensionLoader: () => null,
  } as unknown as import('../../gateway/service.js').GatewayService;
}

describe('PATCH /api/config tunnel key', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stops the runtime and disables startup flags before clearing the key', async () => {
    const stop = vi.spyOn(getTunnelService(), 'stop').mockResolvedValue({ released: false });
    const service = mockService();
    const app = createHonoApp({ service, token: 'gateway-secret-token' });

    const res = await app.request('/api/config', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer gateway-secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tunnel: { registrationSecret: null } }),
    });

    expect(res.status).toBe(200);
    expect(stop).toHaveBeenCalledOnce();
    expect(service.currentConfig.tunnel.registrationSecret).toBeUndefined();
    expect(service.currentConfig.tunnel.enabled).toBe(false);
    expect(service.currentConfig.tunnel.autoStart).toBe(false);
  });
});
