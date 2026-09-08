import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../../../config/schema.js';
import type { AuthenticatedRouteDeps } from '../deps.js';
import { registerBrowserRoutes } from '../browser.js';

function createApp() {
  const app = new Hono();
  registerBrowserRoutes(app, {
    service: {
      currentConfig: ConfigSchema.parse({
        browser: { enabled: false, driver: { kind: 'extension' } },
      }),
    },
    strictRateLimitMiddleware: async (_c, next) => next(),
  } as AuthenticatedRouteDeps);
  return app;
}

describe('browser routes', () => {
  it('reports an explicitly disabled Browser Control state', async () => {
    const response = await createApp().request('/api/browser/status');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      payload: { enabled: false, driverKind: 'extension', state: 'disabled' },
    });
  });

  it('does not attempt a connection test while Browser Control is disabled', async () => {
    const response = await createApp().request('/api/browser/test', { method: 'POST' });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: 'Browser Control is disabled.' });
  });
});
