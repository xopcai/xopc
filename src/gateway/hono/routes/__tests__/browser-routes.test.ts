import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../browser/providers/browser-ext-install.js', () => ({
  createBrowserExtensionArchive: async () => ({
    filename: 'xopc-browser-extension-test.zip',
    data: Buffer.from('extension archive'),
  }),
}));

import { ConfigSchema } from '../../../../config/schema.js';
import type { AuthenticatedRouteDeps } from '../deps.js';
import { registerBrowserRoutes } from '../browser.js';
import { setGatewayPrincipal } from '../../../security/gateway-principal.js';

function createApp(principal: Parameters<typeof setGatewayPrincipal>[1] = {
  kind: 'owner', principalId: 'local-owner', scopes: ['gateway.admin'],
}) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    setGatewayPrincipal(c, principal);
    await next();
  });
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

  it('downloads the portable Chrome extension archive for an authenticated owner', async () => {
    const response = await createApp().request('/api/browser/extension/archive');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('content-disposition')).toContain('xopc-browser-extension-test.zip');
    expect(await response.text()).toBe('extension archive');
  });

  it('does not expose the extension archive to a paired device', async () => {
    const response = await createApp({
      kind: 'device', principalId: 'phone', deviceId: 'phone', scopes: [],
    }).request('/api/browser/extension/archive');

    expect(response.status).toBe(403);
  });
});
