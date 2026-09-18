import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { BROWSER_CONTROL_ENDPOINT_TOOL_NAME } from '@xopcai/browser-control-contract';

const { browserExtDoctor } = vi.hoisted(() => ({
  browserExtDoctor: vi.fn(async () => ({
    installed: false,
    bundledAvailable: true,
    needsRefresh: false,
  })),
}));

vi.mock('../../../../browser/providers/browser-ext-install.js', () => ({
  browserExtDoctor,
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

function createEnabledApp(connected: boolean) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    setGatewayPrincipal(c, { kind: 'owner', principalId: 'local-owner', scopes: ['gateway.admin'] });
    await next();
  });
  registerBrowserRoutes(app, {
    service: {
      currentConfig: ConfigSchema.parse({
        browser: { enabled: true, driver: { kind: 'extension' } },
      }),
      endpointTools: {
        registry: {
          list: () => connected ? [{
            kind: 'browser',
            tools: [{ descriptor: { name: BROWSER_CONTROL_ENDPOINT_TOOL_NAME } }],
            endpointId: 'chrome-endpoint',
            principalId: 'chrome-device',
            displayName: 'Chrome',
            platform: 'chrome',
            appVersion: '1.0.0',
            lastHeartbeatAt: Date.now(),
          }] : [],
        },
      },
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

  it('distinguishes missing artifacts from a connected control endpoint', async () => {
    browserExtDoctor.mockResolvedValue({
      installed: false,
      bundledAvailable: true,
      needsRefresh: false,
    });
    const disconnectedResponse = await createEnabledApp(false).request('/api/browser/status');
    const disconnected = await disconnectedResponse.json() as {
      payload: { driverStatus: { setupState: string } };
    };
    expect(disconnected.payload.driverStatus.setupState).toBe('not_installed');

    browserExtDoctor.mockResolvedValue({
      installed: true,
      bundledAvailable: true,
      needsRefresh: false,
    });
    const installedResponse = await createEnabledApp(false).request('/api/browser/status');
    const installed = await installedResponse.json() as {
      payload: { driverStatus: { setupState: string } };
    };
    expect(installed.payload.driverStatus.setupState).toBe('installed_not_connected');

    const connectedResponse = await createEnabledApp(true).request('/api/browser/status');
    const connected = await connectedResponse.json() as {
      payload: { state: string; driverStatus: { setupState: string } };
    };
    expect(connected.payload.state).toBe('ready');
    expect(connected.payload.driverStatus.setupState).toBe('connected');
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
