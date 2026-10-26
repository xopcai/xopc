import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { initializeTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { createHonoApp } from '../../gateway/hono/app.js';
import { closeXopcDatabase } from '../../storage/sqlite/index.js';
import { TunnelBrokerUrlSchema } from '../../config/schema.js';
import { TunnelBrokerClient, TunnelRecoveryProofRejectedError, TunnelRegistrationKeyRejectedError } from '../broker-client.js';
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
    saveConfig: vi.fn(async (config: typeof currentConfig) => {
      Object.assign(currentConfig, config);
      return { saved: true };
    }),
    getAuthToken: () => 'gateway-secret-token',
    getResolvedAuth: () => ({ mode: 'token' as const, token: 'gateway-secret-token' }),
    getHealth: () => ({ status: 'ok', version: '0', uptime: 0 }),
    getExtensionLoader: () => null,
  } as unknown as import('../../gateway/service.js').GatewayService;
}

describe('PATCH /api/config tunnel key', () => {
  beforeAll(() => initializeTestAgentCatalog());
  afterAll(() => closeXopcDatabase());

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects insecure or credential-bearing broker URLs at configuration and runtime boundaries', () => {
    for (const url of ['http://frp.example/api', 'https://user:secret@frp.example/api']) {
      expect(TunnelBrokerUrlSchema.safeParse(url).success).toBe(false);
      expect(() => new TunnelBrokerClient(url)).toThrow('Tunnel broker requires HTTPS');
    }
    expect(TunnelBrokerUrlSchema.safeParse('https://frp.example/api').success).toBe(true);
  });

  it('returns a recoverable code for rejected registration keys through the authenticated route', async () => {
    vi.spyOn(getTunnelService(), 'start').mockRejectedValue(new TunnelRegistrationKeyRejectedError());
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ brokerUrl: 'https://frp.xopc.ai/api' }));
    const service = mockService();
    const app = createHonoApp({ service, token: 'gateway-secret-token' });
    const response = await app.request('/api/tunnel/start', {
      method: 'POST',
      headers: { Authorization: 'Bearer gateway-secret-token', 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Tunnel register failed: 401', code: 'TUNNEL_REGISTRATION_KEY_REJECTED' });
    expect(service.saveConfig).not.toHaveBeenCalled();
  });

  it('reports a lease ownership conflict separately from a rejected key', async () => {
    vi.spyOn(getTunnelService(), 'start').mockRejectedValue(new TunnelRecoveryProofRejectedError());
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ brokerUrl: 'https://frp.xopc.ai/api' }));
    const app = createHonoApp({ service: mockService(), token: 'gateway-secret-token' });
    const response = await app.request('/api/tunnel/start', {
      method: 'POST', headers: { Authorization: 'Bearer gateway-secret-token', 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Active lease ownership proof required', code: 'TUNNEL_RECOVERY_PROOF_REJECTED' });
  });

  it('passes explicit lease recovery through the authenticated lazy route', async () => {
    const start = vi.spyOn(getTunnelService(), 'start').mockResolvedValue();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ brokerUrl: 'https://frp.xopc.ai/api' }));
    const app = createHonoApp({ service: mockService(), token: 'gateway-secret-token' });
    const response = await app.request('/api/tunnel/start', { method: 'POST',
      headers: { Authorization: 'Bearer gateway-secret-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ recoverActiveLease: true }),
    });
    expect(response.status).toBe(200);
    expect(start).toHaveBeenCalledWith(18790, 'gateway-secret-token', { recoverActiveLease: true });
  });

  it('reports an unconfirmed cloud release instead of claiming success', async () => {
    vi.spyOn(getTunnelService(), 'stop').mockResolvedValue({ released: false });
    const service = mockService();
    const app = createHonoApp({ service, token: 'gateway-secret-token' });
    const response = await app.request('/api/tunnel/stop', { method: 'POST',
      headers: { Authorization: 'Bearer gateway-secret-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ release: true }),
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ ok: false, released: false, code: 'TUNNEL_RELEASE_FAILED' });
    expect(service.currentConfig.tunnel.enabled).toBe(false);
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
