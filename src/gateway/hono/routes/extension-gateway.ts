import type { Hono } from 'hono';

import type { AuthenticatedRouteDeps } from './deps.js';

export function registerExtensionGatewayRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;

  // ========== Extension HTTP Routes ==========
  const extensionRegistry = service.getExtensionRegistry?.();
  if (extensionRegistry) {
    // Register extension HTTP routes
    const httpRoutes = extensionRegistry.httpRoutes;
    for (const [path, handler] of httpRoutes) {
      // POST handler
      authenticated.post(path, async (c) => {
        const req = {
          method: c.req.method,
          url: c.req.url,
          headers: c.req.header(),
          body: await c.req.json().catch(() => ({})),
        };
        const response = await handler(req as any);
        if (response) {
          if (response.status) c.status(response.status as any);
          if (response.headers) {
            for (const [key, value] of Object.entries(response.headers)) {
              c.header(key, String(value));
            }
          }
          if (response.body !== undefined) {
            return c.json(response.body);
          }
        }
        return c.text('');
      });

      // GET handler
      authenticated.get(path, async (c) => {
        const req = {
          method: c.req.method,
          url: c.req.url,
          headers: c.req.header(),
        };
        const response = await handler(req as any);
        if (response) {
          if (response.status) c.status(response.status as any);
          if (response.headers) {
            for (const [key, value] of Object.entries(response.headers)) {
              c.header(key, String(value));
            }
          }
          if (response.body !== undefined) {
            return c.json(response.body);
          }
        }
        return c.text('');
      });
    }
  }

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
