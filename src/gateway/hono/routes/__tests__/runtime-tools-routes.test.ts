import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../../../config/schema.js';
import { registerRuntimeToolsRoutes } from '../runtime-tools.js';

function createApp() {
  const app = new Hono();
  const currentConfig = ConfigSchema.parse({});
  const saveConfig = vi.fn(async () => ({ saved: true }));
  const emit = vi.fn();
  registerRuntimeToolsRoutes(app, {
    service: { currentConfig, saveConfig, emit },
    strictRateLimitMiddleware: async (_c, next) => next(),
  } as never);
  return { app, saveConfig, emit };
}

describe('runtime tools routes', () => {
  it('validates and saves a complete runtime policy', async () => {
    const { app, saveConfig, emit } = createApp();
    const response = await app.request('/api/runtime-tools/config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        node: { enabled: true, preference: 'system-first', provision: 'on-demand' },
        python: { enabled: false, preference: 'managed-first', provision: 'disabled' },
        uv: { enabled: true },
        download: { timeoutMs: 120_000 },
        retention: { keepVersions: 2 },
      }),
    });

    expect(response.status).toBe(200);
    expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      runtimeTools: expect.objectContaining({
        node: expect.objectContaining({ preference: 'system-first' }),
        python: expect.objectContaining({ enabled: false }),
      }),
    }));
    expect(emit).toHaveBeenCalledWith('runtime-tools.updated', expect.any(Object));
  });

  it('rejects malformed policies and unknown runtime names', async () => {
    const { app, saveConfig } = createApp();
    const configResponse = await app.request('/api/runtime-tools/config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ node: { preference: 'whatever' } }),
    });
    const runtimeResponse = await app.request('/api/runtime-tools/ruby/install/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(configResponse.status).toBe(400);
    expect(runtimeResponse.status).toBe(400);
    expect(saveConfig).not.toHaveBeenCalled();
  });
});
