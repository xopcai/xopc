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
import { getTunnelService } from '../../../tunnel/index.js';
import { logTunnelAudit } from '../../../tunnel/tunnel-audit.js';
import {
  applyTunnelConsentToConfig,
  setTunnelEnabledInConfig,
} from '../../../tunnel/tunnel-config.js';
import { consumeTunnelMutationLimit } from '../../../tunnel/tunnel-rate-limit.js';
import type { AuthenticatedRouteDeps } from './deps.js';

async function configureTunnelFromService(deps: AuthenticatedRouteDeps): Promise<void> {
  await configureTunnelFromGatewayConfig(deps.service.currentConfig);
}

function enrichTunnelStatus(config: Config, status: ReturnType<ReturnType<typeof getTunnelService>['getStatus']>) {
  const consent = getTunnelConsentState(config);
  return {
    ...status,
    consentRequired: consent.consentRequired,
    consent: {
      currentVersion: consent.currentVersion,
      acceptedVersion: consent.acceptedVersion,
      acceptedAt: consent.acceptedAt,
      valid: consent.valid,
    },
    canAutoStart: consent.canAutoStart,
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
  const tunnel = getTunnelService();
  const tunnelMutationLimit = createTunnelMutationRateLimitMiddleware();

  authenticated.get('/api/tunnel/status', async (c) => {
    await configureTunnelFromService(deps);
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

  authenticated.post('/api/tunnel/start', tunnelMutationLimit, async (c) => {
    await configureTunnelFromService(deps);
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
      const qr = await tunnel.start(port, token);
      setTunnelEnabledInConfig(config, true);
      await deps.service.saveConfig(config);
      const status = tunnel.getStatus();
      return c.json({
        publicUrl: qr.publicUrl,
        subdomain: status.subdomain,
        qrPayload: qr.qrPayload,
        lanUrl: qr.lanUrl,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  authenticated.post('/api/tunnel/stop', tunnelMutationLimit, async (c) => {
    await configureTunnelFromService(deps);
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
    await deps.service.saveConfig(config);
    return c.json({ ok: true, released });
  });

  authenticated.get('/api/tunnel/qr', async (c) => {
    await configureTunnelFromService(deps);
    const gateway = deps.service.currentConfig.gateway;
    const port = gateway.port ?? 18790;
    const host = gateway.host ?? '127.0.0.1';
    const token = requireGatewayToken(c);
    if (!token) return c.json({ error: 'Gateway token required' }, 401);
    const qr = tunnel.buildQr(port, host, token);
    return c.json(qr);
  });
}
