import type { Hono } from 'hono';

import type { Config } from '../../../config/schema.js';
import { buildSafeWebConfigPayload } from '../lib/config-payload.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import {
  applyAgentsPatch,
  applyChannelsPatch,
  applyGatewayPatch,
  applyMiscPatch,
  validateGatewayAfterPatch,
} from './config-patch/index.js';

export function registerConfigRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service, strictRateLimitMiddleware } = deps;

  authenticated.post('/api/config/reload', strictRateLimitMiddleware, async (c) => {
    const result = await service.reloadConfig();
    return c.json({ ok: true, payload: result });
  });

  authenticated.post('/api/heartbeat/trigger', strictRateLimitMiddleware, async (c) => {
    let reason = 'manual';
    try {
      const body = await c.req.json();
      if (body && typeof body === 'object' && typeof (body as { reason?: unknown }).reason === 'string') {
        const r = (body as { reason: string }).reason.trim();
        if (r) reason = r.slice(0, 120);
      }
    } catch {
      /* empty or invalid body */
    }
    service.requestHeartbeatNow({ reason });
    return c.json({ ok: true, payload: { scheduled: true } });
  });

  authenticated.get('/api/config', async (c) => {
    const safeConfig = await buildSafeWebConfigPayload(service);
    return c.json({ ok: true, payload: { config: safeConfig } });
  });

  // PATCH /api/config — section patchers run sequentially against the live
  // config object (mutate-in-place is intentional: the route handler reads
  // `service.currentConfig` and rewrites it through `saveConfig`). Each
  // patcher only touches the keys it owns and returns `{ ok: false }` with a
  // 400 body when validation fails; we surface the first failure verbatim.
  authenticated.patch('/api/config', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json();
    const config: Config = service.currentConfig as Config;

    applyAgentsPatch(config, body);
    applyChannelsPatch(config, body);

    const gatewayResult = applyGatewayPatch(config, body);
    if (gatewayResult.ok === false) {
      return c.json({ ok: false, error: gatewayResult.error }, gatewayResult.status as 400 | 500);
    }

    const miscResult = await applyMiscPatch(config, body);
    if (miscResult.ok === false) {
      return c.json({ ok: false, error: miscResult.error }, miscResult.status as 400 | 500);
    }

    const finalGwCheck = validateGatewayAfterPatch(config, body);
    if (finalGwCheck.ok === false) {
      return c.json({ ok: false, error: finalGwCheck.error }, finalGwCheck.status as 400 | 500);
    }

    const result = await service.saveConfig(config);
    if (!result.saved) {
      return c.json({ ok: false, error: result.error }, 500);
    }

    if (body.gateway?.heartbeat !== undefined && typeof body.gateway.heartbeat === 'object') {
      service.reloadHeartbeatFromCurrentConfig();
    }

    const safeConfig = await buildSafeWebConfigPayload(service);
    return c.json({ ok: true, payload: { config: safeConfig } });
  });
}
