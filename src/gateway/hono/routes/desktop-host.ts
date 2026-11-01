import { DESKTOP_HOST_MANIFEST, desktopPairingInvitationSchema, desktopSshOriginSchema, DESKTOP_HOST_CAPABILITIES, desktopExecutionGrantSchema } from '@xopcai/gateway-contract';
import type { Context, Hono } from 'hono';
import { z } from 'zod';

import { createDevicePairingSetup } from '../../../storage/sqlite/device-pairing-repository.js';
import { getDesktopStateObservation, setDesktopStateObservation, getDesktopScreenObservation, setDesktopScreenObservation } from '../../../storage/sqlite/device-access-repository.js';
import { getGatewayIdentityPublicKeyRaw, getOrCreateGatewayIdentity, signGatewayPayload } from '../../../storage/sqlite/gateway-identity-repository.js';
import { signDesktopAuthorityResponse } from '../../../endpoint-tools/desktop-authority-response.js';
import { parseRequestProof, PROOF_HEADER } from '../../security/device-request-proof.js';
import { resolveSecureDeviceRoutes } from '../../device-routes.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import { getDevice } from '../../../storage/sqlite/device-access-repository.js';
import { getDesktopExecutionGrant, setDesktopExecutionGrant, revokeDesktopExecutionGrant } from '../../../storage/sqlite/desktop-execution-repository.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerDesktopHostRoutes(app: Hono, { service }: AuthenticatedRouteDeps): void {
  const ownExecutionDevice = (actor: ReturnType<typeof getGatewayPrincipal>) => {
    const device = actor.kind === 'device' && actor.deviceId ? getDevice(actor.deviceId) : undefined;
    return device?.platform === 'desktop' && device.revokedAt === undefined ? device.id : undefined;
  };
  const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
  const executionReply = (c: Context, deviceId: string, payload: unknown) => {
    const proof = parseRequestProof(c.req.header(PROOF_HEADER));
    if (!proof) throw new Error('DESKTOP_AUTHORITY_REQUEST_PROOF_REQUIRED');
    const url = new URL(c.req.url);
    return c.json(signDesktopAuthorityResponse({ ok: true, payload }, { gatewayId: getOrCreateGatewayIdentity().id, deviceId,
      nonce: proof.nonce, method: c.req.method, target: url.pathname + url.search }, 200, signGatewayPayload));
  };
  const executionError = (error: unknown) => {
    const code = error instanceof Error ? error.message : '';
    if (['DESKTOP_EXECUTION_REVISION_CHANGED', 'DESKTOP_EXECUTION_APPROVAL_ALREADY_USED', 'DESKTOP_EXECUTION_GRANT_LIMIT'].includes(code)) return { code, status: 409 as const };
    if (code === 'DESKTOP_EXECUTION_GRANT_EXPIRED') return { code, status: 400 as const };
    if (code === 'DESKTOP_EXECUTION_DEVICE_INVALID') return { code, status: 404 as const };
    throw error;
  };
  app.get('/api/desktop-host/execution', c => {
    c.header('Cache-Control', 'no-store');
    const id = ownExecutionDevice(getGatewayPrincipal(c));
    if (!id) return c.json({ ok: false, error: { code: 'DESKTOP_DEVICE_REQUIRED' } }, 403);
    return executionReply(c, id, getDesktopExecutionGrant(id));
  });
  app.post('/api/desktop-host/execution', async c => {
    c.header('Cache-Control', 'no-store');
    const id = ownExecutionDevice(getGatewayPrincipal(c));
    if (!id) return c.json({ ok: false, error: { code: 'DESKTOP_DEVICE_REQUIRED' } }, 403);
    const input = z.strictObject({ expectedRevision: revision, grant: desktopExecutionGrantSchema }).safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    try {
      const previousRevision = getDesktopExecutionGrant(id)?.revision;
      const payload = setDesktopExecutionGrant(id, input.data.expectedRevision, input.data.grant);
      if (payload.revision !== previousRevision) service.realtime.disconnectPrincipal(id);
      return executionReply(c, id, payload);
    } catch (error) { const failure = executionError(error); return c.json({ ok: false, error: { code: failure.code } }, failure.status); }
  });
  const revokeInput = z.strictObject({ grantId: z.uuid(), expectedRevision: revision });
  app.delete('/api/desktop-host/execution', async c => {
    c.header('Cache-Control', 'no-store');
    const id = ownExecutionDevice(getGatewayPrincipal(c));
    if (!id) return c.json({ ok: false, error: { code: 'DESKTOP_DEVICE_REQUIRED' } }, 403);
    const input = revokeInput.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    try {
      const previousRevision = getDesktopExecutionGrant(id)?.revision;
      const payload = revokeDesktopExecutionGrant(id, input.data.grantId, input.data.expectedRevision);
      if (payload.revision !== previousRevision) service.realtime.disconnectPrincipal(id); return executionReply(c, id, payload);
    } catch (error) { const failure = executionError(error); return c.json({ ok: false, error: { code: failure.code } }, failure.status); }
  });
  app.get('/api/desktop-host/devices/:deviceId/execution', c => {
    c.header('Cache-Control', 'no-store');
    if (getGatewayPrincipal(c).kind !== 'owner' || service.getResolvedAuth().mode !== 'token') return c.json({ ok: false, error: { code: 'OWNER_REQUIRED' } }, 403);
    const id = z.uuid().safeParse(c.req.param('deviceId'));
    if (!id.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    const payload = getDesktopExecutionGrant(id.data);
    return payload ? c.json({ ok: true, payload }) : c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);
  });
  app.delete('/api/desktop-host/devices/:deviceId/execution', async c => {
    c.header('Cache-Control', 'no-store');
    if (getGatewayPrincipal(c).kind !== 'owner' || service.getResolvedAuth().mode !== 'token') return c.json({ ok: false, error: { code: 'OWNER_REQUIRED' } }, 403);
    const id = z.uuid().safeParse(c.req.param('deviceId')), input = revokeInput.safeParse(await c.req.json().catch(() => null));
    if (!id.success || !input.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    try {
      const previousRevision = getDesktopExecutionGrant(id.data)?.revision;
      const payload = revokeDesktopExecutionGrant(id.data, input.data.grantId, input.data.expectedRevision);
      if (payload.revision !== previousRevision) service.realtime.disconnectPrincipal(id.data); return c.json({ ok: true, payload });
    } catch (error) { const failure = executionError(error); return c.json({ ok: false, error: { code: failure.code } }, failure.status); }
  });
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
  const cleanupInput = async (request: { text(): Promise<string> }) => {
    const schema = z.strictObject({ expectedRevision: revision.optional() });
    try { const text = await request.text(); return schema.safeParse(text ? JSON.parse(text) : {}); }
    catch { return schema.safeParse(null); }
  };
  app.delete('/api/desktop-host/observation', async c => {
    c.header('Cache-Control', 'no-store');
    const actor = getGatewayPrincipal(c);
    if (actor.kind !== 'device' || !actor.deviceId) return c.json({ ok: false, error: { code: 'DEVICE_REQUIRED' } }, 403);
    const input = await cleanupInput(c.req);
    if (!input.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    const previous = getDesktopStateObservation(actor.deviceId);
    if (previous?.stateEnabled === false && getDesktopExecutionGrant(actor.deviceId)?.enabled) return c.json({ ok: true, payload: previous });
    try {
      const payload = observation(actor.deviceId, false, input.data.expectedRevision);
      return payload ? c.json({ ok: true, payload }) : c.json({ ok: false, error: { code: 'DESKTOP_NOT_FOUND' } }, 404);
    } catch (error) { if (error instanceof Error && error.message === 'DESKTOP_OBSERVATION_REVISION_CHANGED') return c.json({ ok: false, error: { code: error.message } }, 409); throw error; }
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
  app.delete('/api/desktop-host/screen', async c => {
    c.header('Cache-Control', 'no-store');
    const actor = getGatewayPrincipal(c);
    if (actor.kind !== 'device' || !actor.deviceId) return c.json({ ok: false, error: { code: 'DEVICE_REQUIRED' } }, 403);
    const input = await cleanupInput(c.req);
    if (!input.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    const previous = getDesktopScreenObservation(actor.deviceId);
    if (previous?.screenEnabled === false && getDesktopExecutionGrant(actor.deviceId)?.enabled) return c.json({ ok: true, payload: previous });
    try {
      const payload = setDesktopScreenObservation(actor.deviceId, false, input.data.expectedRevision);
      if (payload) service.realtime.disconnectPrincipal(actor.deviceId);
      return payload ? c.json({ ok: true, payload }) : c.json({ ok: false, error: { code: 'DESKTOP_NOT_FOUND' } }, 404);
    } catch (error) { if (error instanceof Error && error.message === 'DESKTOP_OBSERVATION_REVISION_CHANGED') return c.json({ ok: false, error: { code: error.message } }, 409); throw error; }
  });
}
