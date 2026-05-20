import type { Hono } from 'hono';

import { extractToken } from '../../auth.js';
import { configureTunnelFromGatewayConfig } from '../../../tunnel/gateway-lifecycle.js';
import { getTunnelService } from '../../../tunnel/index.js';
import type { AuthenticatedRouteDeps } from './deps.js';

async function configureTunnelFromService(deps: AuthenticatedRouteDeps): Promise<void> {
  await configureTunnelFromGatewayConfig(deps.service.currentConfig);
}

export function registerTunnelRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const tunnel = getTunnelService();

  authenticated.get('/api/tunnel/status', async (c) => {
    await configureTunnelFromService(deps);
    return c.json(tunnel.getStatus());
  });

  authenticated.post('/api/tunnel/start', async (c) => {
    await configureTunnelFromService(deps);
    const gateway = deps.service.currentConfig.gateway;
    const port = gateway.port ?? 18790;
    const host = gateway.host ?? '127.0.0.1';
    const token =
      extractToken({
        authorization: c.req.header('authorization') ?? undefined,
      }) ?? '';
    if (!token) {
      return c.json({ error: 'Gateway token required' }, 401);
    }
    try {
      const qr = await tunnel.start(port, token);
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
