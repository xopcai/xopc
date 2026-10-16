import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../../../config/schema.js';
import { initializeTestAgentCatalog } from '../../../../agent-catalog/test-support.js';
import { registerGlobalDefaultsRoutes } from '../global-defaults.js';

describe('global defaults routes', () => {
  it('returns 409 for stale model writes and rejects invalid scope options', async () => {
    const repository = initializeTestAgentCatalog();
    const defaults = repository.getSettings().defaults;
    const app = new Hono();
    registerGlobalDefaultsRoutes(app, { service: { refreshAgentCatalog: vi.fn() }, strictRateLimitMiddleware: async (_c, next) => next() } as never);
    const patch = (options: object) => app.request('/api/global-defaults', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ defaults, ...options }) });
    expect((await patch({ scope: 'models', expectedModels: { ...defaults.models, chat: { primary: 'old/chat', fallbacks: [] } } })).status).toBe(409);
    expect((await patch({ scope: 'unknown' })).status).toBe(400);
    expect((await patch({ expectedModels: null })).status).toBe(400);
    expect(repository.getSettings().defaults).toEqual(defaults);
  });
  it('does not persist an unchanged defaults update', async () => {
    const repository = initializeTestAgentCatalog();
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
      body: JSON.stringify({ defaults: repository.getSettings().defaults }),
    });

    expect(response.status).toBe(200);
    expect(saveConfig).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });
});
