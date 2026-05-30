import type { Hono, MiddlewareHandler } from 'hono';

import type { Config } from '../../../config/schema.js';
import { resolveGatewayEffectiveHost } from '../../../config/gateway-bind.js';
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
} from '../../../tunnel/env.js';
import { getTunnelService } from '../../../tunnel/index.js';
import { createPairingSecret, exchangePairingSecretOnce, getCachedPairingExchange } from '../../../tunnel/pairing.js';
import { buildMobilePairContext } from '../../../tunnel/pair-context.js';
import { applyLanPairingGatewayPatch } from '../../../tunnel/enable-lan-pairing.js';
import {
  buildMobileConnectUrlOrder,
  resolveMobilePairLanUrl,
  validateMobilePairBaseUrl,
} from '../../../tunnel/pair-url.js';
import { consumePairingExchangeFailLimit } from '../../../tunnel/pairing-rate-limit.js';
import { loadTunnelState } from '../../../tunnel/tunnel-state.js';
import { logTunnelAudit } from '../../../tunnel/tunnel-audit.js';
import {
  applyTunnelConsentToConfig,
  setTunnelEnabledInConfig,
} from '../../../tunnel/tunnel-config.js';
import { consumeTunnelMutationLimit } from '../../../tunnel/tunnel-rate-limit.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import type { GatewayService } from '../../service.js';
import { getClientIpFromHeaders } from '../../auth-rate-limit.js';

async function configureTunnelFromService(
  deps: AuthenticatedRouteDeps,
  opts?: { force?: boolean },
): Promise<void> {
  await configureTunnelFromGatewayConfig(deps.service.currentConfig, opts);
}

function enrichTunnelStatus(config: Config, status: ReturnType<ReturnType<typeof getTunnelService>['getStatus']>) {
  const consent = getTunnelConsentState(config);
  const brokerUrl = resolveTunnelBrokerUrl(config.tunnel?.brokerUrl);
  const registrationSecret = getTunnelRegistrationSecretMeta(config, process.env, brokerUrl);
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

export function registerTunnelPublicRoutes(app: Hono, service: GatewayService): void {
  app.get('/api/tunnel/pair/ping', async (c) => {
    const config = service.currentConfig as Config;
    const tunnel = getTunnelService();
    const status = tunnel.getStatus();
    const context = buildMobilePairContext({
      config,
      tunnelPublicUrl: status.publicUrl,
      tunnelConnected: status.state === 'connected',
    });
    return c.json({
      ok: true,
      service: 'xopc-gateway',
      mobilePairing: true,
      port: context.port,
      bindMode: context.bindMode,
      listenHost: context.listenHost,
      pairingReady: context.pairingReady,
      blockReason: context.blockReason ?? null,
      tunnelConnected: status.state === 'connected',
      connectUrls: context.connectUrls,
    });
  });

  app.post('/api/tunnel/pair/validate-url', async (c) => {
    let body: { baseUrl?: unknown };
    try {
      body = (await c.req.json()) as { baseUrl?: unknown };
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl : '';
    const result = validateMobilePairBaseUrl(baseUrl);
    if (result.ok === false) {
      return c.json({
        ok: false,
        code: result.code,
        message: result.message,
      });
    }
    return c.json({
      ok: true,
      url: result.url,
      loopback: false,
      probePath: '/api/tunnel/pair/ping',
    });
  });

  app.post('/api/tunnel/exchange-token', async (c) => {
    const clientIp =
      getClientIpFromHeaders({
        get: (name: string) => c.req.header(name) ?? undefined,
      }) ?? 'unknown';

    let body: { pairingSecret?: unknown };
    try {
      body = (await c.req.json()) as { pairingSecret?: unknown };
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const pairingSecret = typeof body.pairingSecret === 'string' ? body.pairingSecret.trim() : '';
    if (!pairingSecret) {
      return c.json({ error: 'pairingSecret required' }, 400);
    }

    const cached = getCachedPairingExchange(pairingSecret);
    if (cached) {
      logTunnelAudit(
        'tunnel.exchange_token',
        { ok: true, clientIp, phase: 'pairing_exchange', replay: true },
        'Pairing secret replayed (duplicate mobile exchange)',
      );
      return c.json(cached);
    }

    const token = service.getAuthToken();
    if (!token) {
      return c.json({ error: 'Gateway token not configured' }, 500);
    }

    const persisted = loadTunnelState();
    const config = service.currentConfig as Config;
    const publicUrl = persisted?.publicUrl?.trim() || null;
    const lanUrl = resolveMobilePairLanUrl(config);
    const connectUrls = buildMobileConnectUrlOrder({ baseUrl: publicUrl, lanUrl });

    const payload = await exchangePairingSecretOnce(pairingSecret, () => ({
      token,
      baseUrl: publicUrl,
      lanUrl,
      connectUrls,
    }));

    if (!payload) {
      const limited = consumePairingExchangeFailLimit(clientIp);
      if (!limited.allowed) {
        c.header('Retry-After', String(Math.ceil(limited.retryAfterMs / 1000)));
      }
      logTunnelAudit(
        'tunnel.exchange_token',
        { ok: false, clientIp, phase: 'pairing_exchange' },
        'Pairing exchange denied: invalid or expired secret',
      );
      return c.json({ error: 'Invalid or expired pairing secret', code: 'PAIRING_INVALID' }, 401);
    }

    logTunnelAudit(
      'tunnel.exchange_token',
      { ok: true, clientIp, subdomain: persisted?.subdomain ?? null, phase: 'pairing_exchange' },
      'Pairing secret exchanged for gateway token',
    );
    return c.json(payload);
  });
}

export function registerTunnelRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { strictRateLimitMiddleware } = deps;
  const tunnel = getTunnelService();
  const tunnelMutationLimit = createTunnelMutationRateLimitMiddleware();

  authenticated.get('/api/tunnel/pair/context', async (c) => {
    await configureTunnelFromService(deps);
    const config = deps.service.currentConfig as Config;
    const status = tunnel.getStatus();
    const context = buildMobilePairContext({
      config,
      tunnelPublicUrl: status.publicUrl,
      tunnelConnected: status.state === 'connected',
    });
    return c.json(context);
  });

  authenticated.post('/api/tunnel/pair/enable-lan', tunnelMutationLimit, async (c) => {
    const token = requireGatewayToken(c);
    if (!token) return c.json({ error: 'Gateway token required' }, 401);

    const config = deps.service.currentConfig as Config;
    const patchResult = applyLanPairingGatewayPatch(config);
    if (patchResult.ok === false) {
      return c.json({ ok: false, error: { message: patchResult.message, code: 'LAN_PAIRING_CONFIG' } }, 400);
    }

    if (patchResult.changed) {
      const saveResult = await deps.service.saveConfig(config);
      if (!saveResult.saved) {
        return c.json(
          { ok: false, error: { message: saveResult.error ?? 'Failed to save config', code: 'SAVE_FAILED' } },
          500,
        );
      }
      logTunnelAudit(
        'tunnel.enable_lan_pairing',
        { gatewayTokenHash: hashGatewayToken(token).slice(0, 12) },
        'Gateway bind switched to LAN for mobile pairing',
      );
    }

    const status = tunnel.getStatus();
    let context = buildMobilePairContext({
      config: deps.service.currentConfig as Config,
      tunnelPublicUrl: status.publicUrl,
      tunnelConnected: status.state === 'connected',
    });

    if (patchResult.changed) {
      context = {
        ...context,
        pairingReady: false,
        blockReason: 'GATEWAY_LOOPBACK_ONLY',
      };
    }

    return c.json({
      ok: true,
      requiresRestart: patchResult.changed,
      context,
    });
  });

  authenticated.post('/api/tunnel/pair', tunnelMutationLimit, async (c) => {
    await configureTunnelFromService(deps);
    const token = requireGatewayToken(c);
    if (!token) return c.json({ error: 'Gateway token required' }, 401);

    const { secret, expiresAt } = createPairingSecret();
    logTunnelAudit(
      'tunnel.pair',
      {
        expiresAt: expiresAt.toISOString(),
        gatewayTokenHash: hashGatewayToken(token).slice(0, 12),
      },
      'Mobile pairing session created',
    );
    return c.json({ pairingSecret: secret, expiresAt: expiresAt.toISOString() });
  });

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
    const host = resolveGatewayEffectiveHost(deps.service.currentConfig);
    const token = requireGatewayToken(c);
    if (!token) return c.json({ error: 'Gateway token required' }, 401);
    const qr = await tunnel.buildQr(port, host);
    return c.json(qr);
  });

  authenticated.get('/api/tunnel/transport-status', async (c) => {
    await configureTunnelFromService(deps);
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
