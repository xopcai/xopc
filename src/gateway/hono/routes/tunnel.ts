import type { Hono } from 'hono';

import type { Config } from '../../../config/schema.js';
import { extractToken } from '../../auth.js';
import {
  assertTunnelMayStart,
  getTunnelConsentState,
  TUNNEL_CONSENT_REQUIRED_CODE,
  TunnelConsentError,
} from '../../../tunnel/consent.js';
import { configureTunnelFromGatewayConfig } from '../../../tunnel/gateway-lifecycle.js';
import { getTunnelService } from '../../../tunnel/index.js';
import {
  applyTunnelConsentToConfig,
  setTunnelEnabledInConfig,
} from '../../../tunnel/tunnel-config.js';
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

export function registerTunnelRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const tunnel = getTunnelService();

  authenticated.get('/api/tunnel/status', async (c) => {
    await configureTunnelFromService(deps);
    const config = deps.service.currentConfig as Config;
    return c.json(enrichTunnelStatus(config, tunnel.getStatus()));
  });

  authenticated.post('/api/tunnel/consent', async (c) => {
    const config = deps.service.currentConfig as Config;
    applyTunnelConsentToConfig(config);
    const result = await deps.service.saveConfig(config);
    if (!result.saved) {
      return c.json({ ok: false, error: result.error ?? 'Failed to save config' }, 500);
    }
    const consent = getTunnelConsentState(config);
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

  authenticated.post('/api/tunnel/start', async (c) => {
    await configureTunnelFromService(deps);
    const config = deps.service.currentConfig as Config;
    try {
      assertTunnelMayStart(config);
    } catch (err) {
      if (err instanceof TunnelConsentError) {
        return c.json({ error: err.message, code: TUNNEL_CONSENT_REQUIRED_CODE }, 403);
      }
      throw err;
    }

    const gateway = config.gateway;
    const port = gateway.port ?? 18790;
    const token =
      extractToken({
        authorization: c.req.header('authorization') ?? undefined,
      }) ?? '';
    if (!token) {
      return c.json({ error: 'Gateway token required' }, 401);
    }
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

  authenticated.post('/api/tunnel/stop', async (c) => {
    await configureTunnelFromService(deps);
    await tunnel.stop();
    const config = deps.service.currentConfig as Config;
    setTunnelEnabledInConfig(config, false);
    await deps.service.saveConfig(config);
    return c.json({ ok: true });
  });

  authenticated.get('/api/tunnel/qr', async (c) => {
    await configureTunnelFromService(deps);
    const gateway = deps.service.currentConfig.gateway;
    const port = gateway.port ?? 18790;
    const host = gateway.host ?? '127.0.0.1';
    const token =
      extractToken({
        authorization: c.req.header('authorization') ?? undefined,
      }) ?? '';
    const qr = tunnel.buildQr(port, host, token);
    return c.json(qr);
  });
}
