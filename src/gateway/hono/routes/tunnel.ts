import type { Hono, MiddlewareHandler } from 'hono';

import type { Config } from '../../../config/schema.js';
import { extractToken } from '../../auth.js';
import {
  assertTunnelMayStart,
  getTunnelConsentState,
  TUNNEL_CONSENT_REQUIRED_CODE,
  TunnelConsentError,
} from '../../../tunnel/consent.js';
import { hashGatewayToken } from '../../../tunnel/tunnel-service.js';
import { configureTunnelFromGatewayConfig } from '../../../tunnel/gateway-lifecycle.js';
import {
  getTunnelRegistrationSecretMeta,
  readTunnelRegistrationSecretFromConfigOnly,
  resolveTunnelBrokerUrl,
  TUNNEL_REGISTRATION_SECRET_REQUIRED_CODE,
  TunnelRegistrationSecretError,
} from '../../../tunnel/env.js';
import { getTunnelService } from '../../../tunnel/index.js';
import { logTunnelAudit } from '../../../tunnel/tunnel-audit.js';
import { validatePublicUrl } from '../../../config/public-url.js';
import {
  applyTunnelConsentToConfig,
  mergeTunnelConfigPatch,
  setTunnelEnabledInConfig,
} from '../../../tunnel/tunnel-config.js';
import { provisionTunnelRegistrationKey } from '../../../tunnel/xopc-cloud-registration.js';
import { consumeTunnelMutationLimit } from '../../../tunnel/tunnel-rate-limit.js';
import type { AuthenticatedRouteDeps } from './deps.js';

async function configureTunnelFromService(
  deps: AuthenticatedRouteDeps,
  opts?: { force?: boolean; deferWellKnownFetch?: boolean },
): Promise<void> {
  await configureTunnelFromGatewayConfig(deps.service.currentConfig, opts);
}

function enrichTunnelStatus(config: Config, status: ReturnType<ReturnType<typeof getTunnelService>['getStatus']>) {
  const consent = getTunnelConsentState(config);
  const brokerUrl = resolveTunnelBrokerUrl(config.tunnel?.brokerUrl);
  const registrationSecret = getTunnelRegistrationSecretMeta(config, process.env, brokerUrl);
  return {
    ...status,
    config: {
      ...status.config,
      autoStart: config.tunnel?.autoStart ?? false,
      brokerUrl,
    },
    consentRequired: consent.consentRequired,
    consent: {
      currentVersion: consent.currentVersion,
      acceptedVersion: consent.acceptedVersion,
      acceptedAt: consent.acceptedAt,
      valid: consent.valid,
    },
    canAutoStart: consent.canAutoStart,
    registrationSecret,
  };
}

function requireGatewayToken(c: { req: { header: (name: string) => string | undefined } }): string | null {
  return (
    extractToken({
      authorization: c.req.header('authorization') ?? undefined,
    }) ?? null
  );
}

function createTunnelMutationRateLimitMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const token = requireGatewayToken(c);
    if (!token) {
      return c.json({ error: 'Gateway token required' }, 401);
    }
    const result = consumeTunnelMutationLimit(token);
    if (!result.allowed) {
      c.header('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
      return c.json(
        {
          error: 'Too many tunnel operations. Try again later.',
          code: 'TUNNEL_RATE_LIMITED',
          retryAfterMs: result.retryAfterMs,
        },
        429,
      );
    }
    await next();
  };
}

export function registerTunnelRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { strictRateLimitMiddleware } = deps;
  const tunnel = getTunnelService();
  const tunnelMutationLimit = createTunnelMutationRateLimitMiddleware();

  /**
   * Probe a candidate reverse-proxy URL before persisting it. The check round-trips
   * a `GET /api/health` and validates the response identifies as
   * `service: 'xopc-gateway'`. Surface-area errors are mapped to stable codes so
   * the UI can render targeted hints (TLS / DNS / wrong service / blocked path).
   */
  authenticated.post('/api/tunnel/probe-public', tunnelMutationLimit, async (c) => {
    const token = requireGatewayToken(c);
    if (!token) return c.json({ error: 'Gateway token required' }, 401);

    let body: { url?: unknown };
    try {
      body = (await c.req.json()) as { url?: unknown };
    } catch {
      return c.json({ ok: false, code: 'INVALID_JSON', message: 'Invalid JSON body' }, 400);
    }
    const raw = typeof body.url === 'string' ? body.url : '';
    const validation = validatePublicUrl(raw);
    if (validation.ok === false) {
      return c.json({ ok: false, code: validation.code, message: validation.message });
    }

    const pingUrl = `${validation.url}/api/health`;
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(pingUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Node's fetch surfaces TLS errors as TypeError with cause; map heuristically.
      const lower = message.toLowerCase();
      let code: 'TIMEOUT' | 'TLS_INVALID' | 'DNS_OR_CONN_REFUSED' | 'NETWORK_ERROR' = 'NETWORK_ERROR';
      if (lower.includes('timeout') || lower.includes('aborted')) code = 'TIMEOUT';
      else if (lower.includes('certificate') || lower.includes('cert') || lower.includes('tls') || lower.includes('ssl')) {
        code = 'TLS_INVALID';
      } else if (lower.includes('enotfound') || lower.includes('econnrefused') || lower.includes('eai_again')) {
        code = 'DNS_OR_CONN_REFUSED';
      }
      return c.json({ ok: false, code, message });
    }

    if (response.status === 401 || response.status === 403) {
      return c.json({ ok: false, code: 'AUTH_BLOCKED', message: `Reverse proxy returned ${response.status}` });
    }
    if (!response.ok) {
      return c.json({ ok: false, code: 'HTTP_ERROR', message: `HTTP ${response.status}` });
    }
    let parsed: { status?: unknown } | null = null;
    try {
      parsed = (await response.json()) as { status?: unknown };
    } catch {
      return c.json({ ok: false, code: 'NOT_XOPC_GATEWAY', message: 'Response was not JSON' });
    }
    if (!parsed || (parsed.status !== 'ok' && parsed.status !== 'starting')) {
      return c.json({
        ok: false,
        code: 'NOT_XOPC_GATEWAY',
        message: 'Endpoint did not identify as an xopc gateway',
      });
    }
    return c.json({
      ok: true,
      url: validation.url,
      latencyMs: Date.now() - startedAt,
      gatewayReady: true,
    });
  });

  authenticated.get('/api/tunnel/status', async (c) => {
    const config = deps.service.currentConfig as Config;
    return c.json(enrichTunnelStatus(config, tunnel.getStatus()));
  });

  authenticated.post('/api/tunnel/consent', tunnelMutationLimit, async (c) => {
    const token = requireGatewayToken(c);
    if (!token) return c.json({ error: 'Gateway token required' }, 401);

    const config = deps.service.currentConfig as Config;
    applyTunnelConsentToConfig(config);
    const result = await deps.service.saveConfig(config);
    if (!result.saved) {
      return c.json({ ok: false, error: result.error ?? 'Failed to save config' }, 500);
    }
    const consent = getTunnelConsentState(config);
    logTunnelAudit(
      'tunnel.consent',
      {
        consentVersion: consent.currentVersion,
        gatewayTokenHash: hashGatewayToken(token).slice(0, 12),
      },
      'Remote access security consent recorded',
    );
    return c.json({
      ok: true,
      consent: {
        currentVersion: consent.currentVersion,
        acceptedVersion: consent.acceptedVersion,
        acceptedAt: consent.acceptedAt,
        valid: consent.valid,
      },
    });
  });

  authenticated.post('/api/tunnel/registration-key', tunnelMutationLimit, async (c) => {
    const config = deps.service.currentConfig as Config;
    try {
      const registrationSecret = await provisionTunnelRegistrationKey();
      const merged = mergeTunnelConfigPatch(config, { registrationSecret });
      if (merged.ok === false) {
        return c.json({ ok: false, error: merged.message }, 400);
      }
      const saved = await deps.service.saveConfig(config);
      if (!saved.saved) {
        return c.json({ ok: false, error: saved.error ?? 'Failed to save tunnel registration key' }, 500);
      }
      logTunnelAudit(
        'tunnel.registration_authorized',
        { phase: 'oauth_exchange' },
        'Tunnel registration key created through XOPC OAuth',
      );
      return c.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ ok: false, error: message }, 502);
    }
  });

  authenticated.post('/api/tunnel/start', tunnelMutationLimit, async (c) => {
    await configureTunnelFromService(deps, { force: true });
    const config = deps.service.currentConfig as Config;
    const token = requireGatewayToken(c);
    if (!token) return c.json({ error: 'Gateway token required' }, 401);

    try {
      assertTunnelMayStart(config);
    } catch (err) {
      if (err instanceof TunnelConsentError) {
        logTunnelAudit(
          'tunnel.start_denied',
          { reason: TUNNEL_CONSENT_REQUIRED_CODE, gatewayTokenHash: hashGatewayToken(token).slice(0, 12) },
          'Tunnel start denied: consent required',
        );
        return c.json({ error: err.message, code: TUNNEL_CONSENT_REQUIRED_CODE }, 403);
      }
      throw err;
    }

    const gateway = config.gateway;
    const port = gateway.port ?? 18790;
    try {
      await tunnel.start(port, token);
      setTunnelEnabledInConfig(config, true);
      const saved = await deps.service.saveConfig(config);
      if (!saved.saved) {
        await tunnel.stop();
        setTunnelEnabledInConfig(config, false);
        return c.json({ error: saved.error ?? 'Failed to save tunnel state' }, 500);
      }
      const status = tunnel.getStatus();
      return c.json({
        publicUrl: status.publicUrl,
        subdomain: status.subdomain,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof TunnelRegistrationSecretError) {
        return c.json(
          { error: message, code: TUNNEL_REGISTRATION_SECRET_REQUIRED_CODE },
          400,
        );
      }
      return c.json({ error: message }, 500);
    }
  });

  authenticated.post('/api/tunnel/stop', tunnelMutationLimit, async (c) => {
    await configureTunnelFromService(deps, { force: true, deferWellKnownFetch: true });
    const config = deps.service.currentConfig as Config;
    let release = false;
    try {
      const body = (await c.req.json().catch(() => ({}))) as { release?: unknown };
      release = body.release === true;
    } catch {
      release = false;
    }
    const { released } = await tunnel.stop({ release });
    setTunnelEnabledInConfig(config, false);
    const saved = await deps.service.saveConfig(config);
    if (!saved.saved) {
      return c.json({ error: saved.error ?? 'Failed to save tunnel state' }, 500);
    }
    return c.json({ ok: true, released });
  });

  authenticated.get('/api/tunnel/transport-status', async (c) => {
    return c.json({
      transport: { tls: 'broker_terminated' as const },
    });
  });

  /**
   * POST /api/tunnel/reveal-registration-secret — plaintext only when stored in config file.
   */
  authenticated.post('/api/tunnel/reveal-registration-secret', strictRateLimitMiddleware, async (c) => {
    const config = deps.service.currentConfig as Config;
    const registrationSecret = readTunnelRegistrationSecretFromConfigOnly(config);
    return c.json({
      ok: true,
      payload: {
        registrationSecret,
        source: registrationSecret ? ('config' as const) : ('none' as const),
      },
    });
  });
}
