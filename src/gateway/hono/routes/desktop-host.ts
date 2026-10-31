import { DESKTOP_HOST_MANIFEST, desktopPairingInvitationSchema, desktopSshOriginSchema, DESKTOP_HOST_CAPABILITIES } from '@xopcai/gateway-contract';
import type { Hono } from 'hono';
import { z } from 'zod';

import { createDevicePairingSetup } from '../../../storage/sqlite/device-pairing-repository.js';
import { getDesktopStateObservation, setDesktopStateObservation, getDesktopScreenObservation, setDesktopScreenObservation } from '../../../storage/sqlite/device-access-repository.js';
import { getGatewayIdentityPublicKeyRaw, getOrCreateGatewayIdentity } from '../../../storage/sqlite/gateway-identity-repository.js';
import { resolveSecureDeviceRoutes } from '../../device-routes.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerDesktopHostRoutes(app: Hono, { service }: AuthenticatedRouteDeps): void {
  app.get('/api/desktop-host/status', c => {
    c.header('Cache-Control', 'no-store');
    const actor = getGatewayPrincipal(c);
    if (actor.kind !== 'device' || !actor.deviceId) return c.json({ ok: false, error: { code: 'DEVICE_REQUIRED' } }, 403);
    return c.json({ ok: true, payload: { deviceId: actor.deviceId, endpoints: service.endpointTools.registry.list()
      .filter(endpoint => endpoint.principalId === actor.deviceId).map(endpoint => ({ endpointId: endpoint.endpointId, availability: endpoint.availability })) } });
  });
  const observation = (deviceId: string, enabled: boolean, expectedRevision?: number) => {
    const grant = setDesktopStateObservation(deviceId, enabled, expectedRevision);
    if (!grant) return undefined;
    service.realtime.disconnectPrincipal(deviceId);
    return grant;
  };
  app.get('/api/desktop-host/compatibility', c => {
    c.header('Cache-Control', 'no-store');
    if (service.getResolvedAuth().mode !== 'token') return c.json({ ok: false, error: { code: 'OWNER_TOKEN_REQUIRED' } }, 403);
    const identity = getOrCreateGatewayIdentity();
    return c.json({ ok: true, payload: { gatewayId: identity.id, publicKey: identity.publicKey, manifest: DESKTOP_HOST_MANIFEST, capabilities: DESKTOP_HOST_CAPABILITIES } });
  });
  app.post('/api/desktop-host/pairing-setups', async c => {
    c.header('Cache-Control', 'no-store');
    if (getGatewayPrincipal(c).kind !== 'owner' || service.getResolvedAuth().mode !== 'token') return c.json({ ok: false, error: { code: 'OWNER_REQUIRED' } }, 403);
    const input = z.strictObject({ sshOrigin: desktopSshOriginSchema.optional() }).safeParse(await c.req.json().catch(() => null));
    if (!input.success) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    }
    const routes = input.data.sshOrigin ? [{ id: 'desktop-ssh', kind: 'ssh-loopback' as const, url: input.data.sshOrigin }] : resolveSecureDeviceRoutes(service.currentConfig);
    if (!routes.length) return c.json({ ok: false, error: { code: 'NO_SECURE_ROUTE' } }, 409);
    const setup = createDevicePairingSetup(routes, Date.now(), { targetKind: 'desktop' });
    const identity = getOrCreateGatewayIdentity();
    const invitation = desktopPairingInvitationSchema.parse({ version: 1, targetKind: 'desktop', pairingToken: setup.token,
      gatewayId: identity.id, gatewayPublicKey: getGatewayIdentityPublicKeyRaw(identity), routes, expiresAt: setup.expiresAt });
    return c.json({ ok: true, payload: { setupId: setup.id, invitation } }, 201);
  });
  app.get('/api/desktop-host/devices/:id/observation', c => {
    c.header('Cache-Control', 'no-store');
    if (getGatewayPrincipal(c).kind !== 'owner' || service.getResolvedAuth().mode !== 'token') return c.json({ ok: false, error: { code: 'OWNER_REQUIRED' } }, 403);
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    const payload = getDesktopStateObservation(id.data);
    return payload ? c.json({ ok: true, payload }) : c.json({ ok: false, error: { code: 'DESKTOP_NOT_FOUND' } }, 404);
  });
  app.post('/api/desktop-host/devices/:id/observation', async c => {
    c.header('Cache-Control', 'no-store');
    if (getGatewayPrincipal(c).kind !== 'owner' || service.getResolvedAuth().mode !== 'token') return c.json({ ok: false, error: { code: 'OWNER_REQUIRED' } }, 403);
    const id = z.uuid().safeParse(c.req.param('id'));
    const input = z.strictObject({ state: z.boolean(), expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).safeParse(await c.req.json().catch(() => null));
    if (!id.success || !input.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    try {
      const payload = observation(id.data, input.data.state, input.data.expectedRevision);
      return payload ? c.json({ ok: true, payload }) : c.json({ ok: false, error: { code: 'DESKTOP_NOT_FOUND' } }, 404);
    } catch (error) {
      if (error instanceof Error && error.message === 'DESKTOP_OBSERVATION_REVISION_CHANGED') return c.json({ ok: false, error: { code: error.message } }, 409);
      throw error;
    }
  });
  app.delete('/api/desktop-host/observation', c => {
    c.header('Cache-Control', 'no-store');
    const actor = getGatewayPrincipal(c);
    if (actor.kind !== 'device' || !actor.deviceId) return c.json({ ok: false, error: { code: 'DEVICE_REQUIRED' } }, 403);
    const payload = observation(actor.deviceId, false);
    return payload ? c.json({ ok: true, payload }) : c.json({ ok: false, error: { code: 'DESKTOP_NOT_FOUND' } }, 404);
  });
  app.get('/api/desktop-host/devices/:id/screen', c => {
    c.header('Cache-Control', 'no-store');
    if (getGatewayPrincipal(c).kind !== 'owner' || service.getResolvedAuth().mode !== 'token') return c.json({ ok: false, error: { code: 'OWNER_REQUIRED' } }, 403);
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    const payload = getDesktopScreenObservation(id.data);
    return payload ? c.json({ ok: true, payload }) : c.json({ ok: false, error: { code: 'DESKTOP_NOT_FOUND' } }, 404);
  });
  app.post('/api/desktop-host/devices/:id/screen', async c => {
    c.header('Cache-Control', 'no-store');
    if (getGatewayPrincipal(c).kind !== 'owner' || service.getResolvedAuth().mode !== 'token') return c.json({ ok: false, error: { code: 'OWNER_REQUIRED' } }, 403);
    const id = z.uuid().safeParse(c.req.param('id'));
    const input = z.strictObject({ screen: z.boolean(), expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).safeParse(await c.req.json().catch(() => null));
    if (!id.success || !input.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    try {
      const payload = setDesktopScreenObservation(id.data, input.data.screen, input.data.expectedRevision);
      if (payload) service.realtime.disconnectPrincipal(id.data);
      return payload ? c.json({ ok: true, payload }) : c.json({ ok: false, error: { code: 'DESKTOP_NOT_FOUND' } }, 404);
    } catch (error) {
      if (error instanceof Error && error.message === 'DESKTOP_OBSERVATION_REVISION_CHANGED') return c.json({ ok: false, error: { code: error.message } }, 409);
      throw error;
    }
  });
  app.delete('/api/desktop-host/screen', c => {
    c.header('Cache-Control', 'no-store');
    const actor = getGatewayPrincipal(c);
    if (actor.kind !== 'device' || !actor.deviceId) return c.json({ ok: false, error: { code: 'DEVICE_REQUIRED' } }, 403);
    const payload = setDesktopScreenObservation(actor.deviceId, false);
    if (payload) service.realtime.disconnectPrincipal(actor.deviceId);
    return payload ? c.json({ ok: true, payload }) : c.json({ ok: false, error: { code: 'DESKTOP_NOT_FOUND' } }, 404);
  });
}
