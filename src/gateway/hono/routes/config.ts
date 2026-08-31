import type { Context, Hono } from 'hono';

import type { Config } from '../../../config/schema.js';
import { getTunnelService } from '../../../tunnel/tunnel-service.js';
import { prepareLocalVoiceModelAfterProviderSwitch } from '../../../voice/local/provider-switch.js';
import { enumerateLanGatewayCandidates } from '../../host.js';
import { buildSafeWebConfigPayload } from '../lib/config-payload.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import {
  applyAgentsPatch,
  applyChannelsPatch,
  applyGatewayPatch,
  applyMiscPatch,
  validateGatewayAfterPatch,
} from './config-patch/index.js';

function localeFromRequest(c: { req: { query(name: string): string | undefined; header(name: string): string | undefined } }): string | undefined {
  return c.req.query('locale') ?? c.req.header('X-XOPC-Locale') ?? c.req.header('Accept-Language')?.split(',')[0];
}

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
    const safeConfig = await buildSafeWebConfigPayload(service, { locale: localeFromRequest(c) });
    return c.json({ ok: true, payload: { config: safeConfig } });
  });

  authenticated.get('/api/gateway/cors-origin-candidates', (c) => {
    const requestedPort = Number(c.req.query('port'));
    const port = Number.isInteger(requestedPort) && requestedPort >= 1 && requestedPort <= 65535
      ? requestedPort
      : service.currentConfig.gateway?.port ?? 18790;
    return c.json({
      ok: true,
      payload: { candidates: enumerateLanGatewayCandidates(port) },
    });
  });

  // PATCH /api/config — section patchers run sequentially against the live
  // config object (mutate-in-place is intentional: the route handler reads
  // `service.currentConfig` and rewrites it through `saveConfig`). Each
  // patcher only touches the keys it owns and returns `{ ok: false }` with a
  // 400 body when validation fails; we surface the first failure verbatim.
  authenticated.patch('/api/config', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json();
    const config: Config = service.currentConfig as Config;
    const previousSttProvider = config.tools?.media?.audio?.provider;

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

    const clearsTunnelRegistrationSecret =
      body?.tunnel &&
      typeof body.tunnel === 'object' &&
      !Array.isArray(body.tunnel) &&
      body.tunnel.registrationSecret === null;
    if (clearsTunnelRegistrationSecret) {
      try {
        await getTunnelService().stop();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return c.json({ ok: false, error: `Failed to stop tunnel before clearing key: ${message}` }, 500);
      }
    }

    const result = await service.saveConfig(config);
    if (!result.saved) {
      return c.json({ ok: false, error: result.error }, 500);
    }
    prepareLocalVoiceModelAfterProviderSwitch(
      previousSttProvider,
      service.currentConfig as Config,
    );

    if (body.gateway?.heartbeat !== undefined && typeof body.gateway.heartbeat === 'object') {
      service.reloadHeartbeatFromCurrentConfig();
    }

    const safeConfig = await buildSafeWebConfigPayload(service, { locale: localeFromRequest(c) });
    return c.json({ ok: true, payload: { config: safeConfig } });
  });

  const revealGatewayAuthSecretHandler = async (c: Context) => {
    const field = await resolveRevealGatewayAuthField(c);
    if (!field) {
      return c.json({ ok: false, error: { message: 'field must be token or password' } }, 400);
    }
    const config = service.currentConfig as Config;
    const secret =
      field === 'token'
        ? config.gateway?.auth?.token?.trim() || null
        : config.gateway?.auth?.password?.trim() || null;
    return c.json({
      ok: true,
      payload: { field, secret, source: secret ? ('config' as const) : ('none' as const) },
    });
  };

  /**
   * POST /api/gateway/reveal-auth-secret/:field — preferred; no JSON body required.
   * POST /api/gateway/reveal-auth-secret — legacy JSON body `{ field: "token" | "password" }`.
   */
  authenticated.post(
    '/api/gateway/reveal-auth-secret/:field',
    strictRateLimitMiddleware,
    revealGatewayAuthSecretHandler,
  );
  authenticated.post('/api/gateway/reveal-auth-secret', strictRateLimitMiddleware, revealGatewayAuthSecretHandler);

  /** POST /api/agents/browser/reveal-cloud-api-key — plaintext browser cloud apiKey from config only. */
  authenticated.post('/api/agents/browser/reveal-cloud-api-key', strictRateLimitMiddleware, async (c) => {
    const config = service.currentConfig as Config;
    const apiKey = config.browser?.cloud?.apiKey?.trim() || null;
    return c.json({
      ok: true,
      payload: { apiKey, source: apiKey ? ('config' as const) : ('none' as const) },
    });
  });

  /** POST /api/tools/web/reveal-search-api-key — plaintext search provider apiKey by index. */
  authenticated.post('/api/tools/web/reveal-search-api-key', strictRateLimitMiddleware, async (c) => {
    let index = -1;
    try {
      const body = await c.req.json();
      if (body && typeof body === 'object' && typeof (body as { index?: unknown }).index === 'number') {
        index = Math.floor((body as { index: number }).index);
      }
    } catch {
      index = -1;
    }
    const providers = service.currentConfig.tools?.web?.search?.providers ?? [];
    if (index < 0 || index >= providers.length) {
      return c.json({ ok: false, error: { message: 'Invalid provider index' } }, 400);
    }
    const apiKey = providers[index]?.apiKey?.trim() || null;
    return c.json({
      ok: true,
      payload: { index, apiKey, source: apiKey ? ('config' as const) : ('none' as const) },
    });
  });
}

function normalizeRevealGatewayAuthField(raw: unknown): 'token' | 'password' | null {
  return raw === 'token' || raw === 'password' ? raw : null;
}

async function resolveRevealGatewayAuthField(c: Context): Promise<'token' | 'password' | null> {
  const fromPath = normalizeRevealGatewayAuthField(c.req.param('field'));
  if (fromPath) return fromPath;

  const fromQuery = normalizeRevealGatewayAuthField(c.req.query('field'));
  if (fromQuery) return fromQuery;

  try {
    const body = await c.req.json();
    return normalizeRevealGatewayAuthField(
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as { field?: unknown }).field
        : undefined,
    );
  } catch {
    return null;
  }
}
