import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../../../config/schema.js';
import { registerGlobalDefaultsRoutes } from '../global-defaults.js';

describe('global defaults routes', () => {
  it('does not persist an unchanged defaults update', async () => {
    const currentConfig = ConfigSchema.parse({});
    const saveConfig = vi.fn(async () => ({ saved: true }));
    const app = new Hono();
    registerGlobalDefaultsRoutes(app, {
      service: { currentConfig, saveConfig },
      strictRateLimitMiddleware: async (_c, next) => next(),
    } as never);

    const response = await app.request('/api/global-defaults', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ defaults: currentConfig.agents.defaults }),
    });

    expect(response.status).toBe(200);
    expect(saveConfig).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });
});
