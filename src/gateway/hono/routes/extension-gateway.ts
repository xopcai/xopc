import type { Hono } from 'hono';

import type { AuthenticatedRouteDeps } from './deps.js';

export function registerExtensionGatewayRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;

  // ========== Extension Gateway Methods ==========

  // POST /api/gateway/:method - Invoke a gateway method
  authenticated.post('/api/gateway/:method', async (c) => {
    const method = c.req.param('method');
    const params = await c.req.json().catch(() => ({}));
    try {
      const result = await service.invokeGatewayMethod(method, params);
      return c.json({ ok: true, result });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }, 400);
    }
  });
}
