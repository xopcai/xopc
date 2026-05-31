import type { Hono, MiddlewareHandler } from 'hono';

import type { Config } from '../../../config/schema.js';
import { extractToken } from '../../auth.js';
import { getExposureManager } from '../../../remote-access/exposure-manager.js';
import type { GatewayTailscaleMode } from '../../server-tailscale.js';
import { consumeTunnelMutationLimit } from '../../../tunnel/tunnel-rate-limit.js';
import type { AuthenticatedRouteDeps } from './deps.js';

function requireGatewayToken(c: { req: { header: (name: string) => string | undefined } }): string | null {
  return (
    extractToken({
      authorization: c.req.header('authorization') ?? undefined,
    }) ?? null
  );
}

function createExposureMutationRateLimitMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const token = requireGatewayToken(c);
    if (!token) {
      return c.json({ error: 'Gateway token required' }, 401);
    }
    const result = consumeTunnelMutationLimit(token);
    if (!result.allowed) {
      const retryAfterSec = Math.ceil(result.retryAfterMs / 1000);
      c.header('Retry-After', String(retryAfterSec));
      return c.json(
        { error: 'Rate limit exceeded', retryAfterMs: result.retryAfterMs },
        429,
      );
    }
    return next();
  };
}

function resolveGatewayPort(config: Config): number {
  return config.gateway?.port ?? 18790;
}

export function registerExposureRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const manager = getExposureManager();

  authenticated.get('/api/exposure/status', async (c) => {
    const status = await manager.getStatus(deps.service.currentConfig);
    return c.json(status);
  });

  const mutationLimit = createExposureMutationRateLimitMiddleware();

  authenticated.post('/api/exposure/tailscale/start', mutationLimit, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { mode?: GatewayTailscaleMode };
    const mode = body.mode === 'funnel' ? 'funnel' : 'serve';
    const config = deps.service.currentConfig;
    const port = resolveGatewayPort(config);
    try {
      await manager.startTailscale(config, port, mode);
    } catch (err) {
      const em = err instanceof Error ? err.message : String(err);
      return c.json({ error: em }, 400);
    }
    return c.json(await manager.getStatus(config));
  });

  authenticated.post('/api/exposure/tailscale/stop', mutationLimit, async (c) => {
    await manager.stopTailscale();
    return c.json(await manager.getStatus(deps.service.currentConfig));
  });
}
