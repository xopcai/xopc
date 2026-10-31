import { DESKTOP_HOST_MANIFEST, desktopPairingInvitationSchema } from '@xopcai/gateway-contract';
import type { Hono } from 'hono';
import { z } from 'zod';

import { createDevicePairingSetup } from '../../../storage/sqlite/device-pairing-repository.js';
import { getGatewayIdentityPublicKeyRaw, getOrCreateGatewayIdentity } from '../../../storage/sqlite/gateway-identity-repository.js';
import { resolveSecureDeviceRoutes } from '../../device-routes.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerDesktopHostRoutes(app: Hono, { service }: AuthenticatedRouteDeps): void {
  app.get('/api/desktop-host/compatibility', c => {
    c.header('Cache-Control', 'no-store');
    if (service.getResolvedAuth().mode !== 'token') return c.json({ ok: false, error: { code: 'OWNER_TOKEN_REQUIRED' } }, 403);
    const identity = getOrCreateGatewayIdentity();
    return c.json({ ok: true, payload: { gatewayId: identity.id, publicKey: identity.publicKey, manifest: DESKTOP_HOST_MANIFEST } });
  });
  app.post('/api/desktop-host/pairing-setups', async c => {
    c.header('Cache-Control', 'no-store');
    if (getGatewayPrincipal(c).kind !== 'owner' || service.getResolvedAuth().mode !== 'token') return c.json({ ok: false, error: { code: 'OWNER_REQUIRED' } }, 403);
    if (!z.strictObject({}).safeParse(await c.req.json().catch(() => null)).success) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    }
    const routes = resolveSecureDeviceRoutes(service.currentConfig);
    if (!routes.length) return c.json({ ok: false, error: { code: 'NO_SECURE_ROUTE' } }, 409);
    const setup = createDevicePairingSetup(routes, Date.now(), { targetKind: 'desktop' });
    const identity = getOrCreateGatewayIdentity();
    const invitation = desktopPairingInvitationSchema.parse({ version: 1, targetKind: 'desktop', pairingToken: setup.token,
      gatewayId: identity.id, gatewayPublicKey: getGatewayIdentityPublicKeyRaw(identity), routes, expiresAt: setup.expiresAt });
    return c.json({ ok: true, payload: { setupId: setup.id, invitation } }, 201);
  });
}
