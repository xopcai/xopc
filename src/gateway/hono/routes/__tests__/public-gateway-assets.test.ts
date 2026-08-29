import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { GatewayService } from '../../../service.js';
import { serveStaticFile } from '../../lib/static-ui.js';
import { registerPublicGatewayRoutes } from '../public-gateway.js';

vi.mock('../../lib/static-ui.js', () => ({
  serveStaticFile: vi.fn((path: string) => new Response(path)),
}));

describe('public gateway UI assets', () => {
  it.each([
    'apple-touch-icon.png',
    'favicon-16x16.png',
    'favicon-32x32.png',
    'favicon.png',
    'favicon.svg',
    'notification-sw.js',
    'pwa-192x192.png',
    'pwa-512x512.png',
    'site.webmanifest',
  ])('serves /%s without gateway authentication', async (assetPath) => {
    const app = new Hono();
    registerPublicGatewayRoutes(app, {
      getHealth: () => ({ ready: true }),
    } as unknown as GatewayService);

    const response = await app.request(`/${assetPath}`);

    expect(response.status).toBe(200);
    expect(serveStaticFile).toHaveBeenCalledWith(assetPath, expect.any(Request));
  });
});
