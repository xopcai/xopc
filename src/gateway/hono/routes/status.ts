import type { Hono } from 'hono';

import type { AuthenticatedRouteDeps } from './deps.js';

export function registerStatusRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;
  authenticated.get('/status', (c) => {
    const health = service.getHealth();
    return c.json({
      status: health.status,
      version: health.version,
      channels: health.channels,
      uptime: health.uptime,
    });
  });
}
