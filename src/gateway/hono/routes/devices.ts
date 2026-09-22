import os from 'node:os';

import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

import {
  browserPairingInvitationPayloadSchema,
  devicePairingTargetKindSchema,
  formatBrowserPairingInvitation,
  formatMobilePairingInvitation,
  MOBILE_PAIRING_INVITATION_VERSION,
} from '@xopcai/gateway-contract';

import {
  listDevices,
  revokeDevice,
  rotateDeviceRefreshToken,
} from '../../../storage/sqlite/device-access-repository.js';
import {
  createDevicePairingSetup,
  isDevicePairingSetupActive,
} from '../../../storage/sqlite/device-pairing-repository.js';
import {
  getOrCreateGatewayIdentity,
  getGatewayIdentityPublicKeyRaw,
  signGatewayPayload,
} from '../../../storage/sqlite/gateway-identity-repository.js';
import { resolveSecureDeviceRoutes } from '../../device-routes.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import { buckets } from '../../rate-limit/index.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import {
  pairingClientKey,
  registerPairingApprovalAdminRoutes,
  registerPairingApprovalPublicRoutes,
  type PairingPublicRouteOptions,
} from './device-pairing-approval.js';

const refreshRequestSchema = z.strictObject({
  refreshToken: z.string().min(1).max(256),
  timestamp: z.number().int().positive(),
  nonce: z.string().min(16).max(128),
  requestId: z.string().uuid(),
  nextRefreshToken: z.string().min(80).max(256),
  signature: z.string().min(1).max(256),
});

const pairingProbeSchema = z.strictObject({
  pairingId: z.string().uuid(),
});

const pairingSetupSchema = z.strictObject({
  targetKind: devicePairingTargetKindSchema,
});

export function registerDeviceAuthPublicRoutes(app: Hono, options?: PairingPublicRouteOptions): void {
  app.post('/api/gateway-identity/challenge', bodyLimit({ maxSize: 512 }), async (c) => {
    const budget = buckets.identityChallenge().consume('gateway');
    if (!budget.allowed) {
      c.header('Retry-After', String(Math.ceil(budget.retryAfterMs / 1000)));
      return c.json({ error: 'Too many identity challenges' }, 429);
    }
    const parsed = z.strictObject({ nonce: z.string().regex(/^[A-Za-z0-9_-]{32,64}$/) }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid identity challenge' }, 400);
    const identity = getOrCreateGatewayIdentity();
    const signedPayload = Buffer.from(JSON.stringify({ purpose: 'gateway-route-v1', gatewayId: identity.id,
      nonce: parsed.data.nonce, expiresAt: Date.now() + 30_000 })).toString('base64url');
    c.header('Cache-Control', 'no-store');
    return c.json({ signedPayload, signature: signGatewayPayload(signedPayload) });
  });
  registerPairingApprovalPublicRoutes(app, options);
  app.post('/api/device-auth/refresh', async (c) => {
    const parsed = refreshRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid refresh request' } }, 400);
    }
    try {
      const tokens = rotateDeviceRefreshToken(parsed.data);
      const signedPayload = Buffer.from(JSON.stringify({ purpose: 'device-refresh-v3',
        gatewayId: getOrCreateGatewayIdentity().id, requestId: parsed.data.requestId, nonce: parsed.data.nonce,
        expiresAt: Date.now() + 30_000, tokens })).toString('base64url');
      return c.json({ ok: true, signedPayload, signature: signGatewayPayload(signedPayload) });
    } catch (error) {
      return c.json({
        ok: false,
        error: {
          code: 'REFRESH_DENIED',
          message: error instanceof Error ? error.message : 'Refresh denied',
        },
      }, 401);
    }
  });

  app.post('/api/device-pairing/probe', bodyLimit({ maxSize: 512 }), async (c) => {
    const clientKey = pairingClientKey(c, options);
    const blocked = buckets.pairingExchange().check(clientKey);
    if (blocked.blocked) {
      c.header('Retry-After', String(blocked.retryAfterSec));
      return c.json({ ok: false, error: { code: 'PAIRING_RATE_LIMITED', message: 'Too many failed pairing attempts' } }, 429);
    }
    const parsed = pairingProbeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success || !isDevicePairingSetupActive(parsed.data.pairingId)) {
      buckets.pairingExchange().fail(clientKey);
      return c.json({ ok: false, error: { code: 'PAIRING_NOT_FOUND', message: 'Pairing setup not found' } }, 404);
    }
    const identity = getOrCreateGatewayIdentity();
    const payload = Buffer.from(JSON.stringify({
      gatewayId: identity.id,
      pairingId: parsed.data.pairingId,
      issuedAt: Date.now(),
    })).toString('base64url');
    buckets.pairingExchange().succeed(clientKey);
    return c.json({ ok: true, signedPayload: payload, signature: signGatewayPayload(payload) });
  });

}

export function registerDeviceRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  registerPairingApprovalAdminRoutes(authenticated);
  authenticated.get('/api/device-pairing/readiness', (c) => {
    const routes = resolveSecureDeviceRoutes(deps.service.currentConfig);
    return c.json({ ok: true, ready: routes.length > 0, routes, protocolVersion: 3,
      routeState: routes.length > 0 ? 'configured' : 'missing',
      nextAction: routes.length > 0 ? 'scan' : 'configure-route', serverTime: Date.now() });
  });

  authenticated.post('/api/device-pairing/setups', async (c) => {
    const parsed = pairingSetupSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Choose a device type' } }, 400);
    }
    const routes = resolveSecureDeviceRoutes(deps.service.currentConfig);
    if (routes.length === 0) {
      return c.json({
        ok: false,
        error: {
          code: 'NO_SECURE_ROUTE',
          message: 'Configure XOPC Secure Link, Tailscale Serve, or an HTTPS public URL first',
        },
      }, 409);
    }
    const setup = createDevicePairingSetup(routes, Date.now(), { targetKind: parsed.data.targetKind });
    const identity = getOrCreateGatewayIdentity();
    const invitation = setup.targetKind === 'mobile'
      ? { universalLink: formatMobilePairingInvitation({
          version: MOBILE_PAIRING_INVITATION_VERSION,
          pairingToken: setup.token,
          gatewayId: identity.id,
          gatewayPublicKey: getGatewayIdentityPublicKeyRaw(identity),
          origins: routes.map(route => route.url),
          expiresAt: setup.expiresAt,
        }) }
      : { browserInvitation: formatBrowserPairingInvitation(Buffer.from(JSON.stringify(
          browserPairingInvitationPayloadSchema.parse({
            version: 3,
            pairingToken: setup.token,
            gatewayId: identity.id,
            gatewayName: os.hostname(),
            gatewayPublicKey: getGatewayIdentityPublicKeyRaw(identity),
            routes,
            targetKind: setup.targetKind,
            expiresAt: setup.expiresAt,
          }),
        )).toString('base64url')) };
    return c.json({
      ok: true,
      setup: {
        id: setup.id,
        ...invitation,
        expiresAt: setup.expiresAt,
        routes,
        protocolVersion: 3,
        targetKind: setup.targetKind,
      },
    }, 201);
  });

  authenticated.get('/api/devices/me', (c) => {
    const principal = getGatewayPrincipal(c);
    if (principal.kind !== 'device' || !principal.deviceId) {
      return c.json({ ok: false, error: { code: 'DEVICE_REQUIRED', message: 'Device access required' } }, 403);
    }
    const device = listDevices().find((candidate) => candidate.id === principal.deviceId);
    return device
      ? c.json({ ok: true, device })
      : c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Device not found' } }, 404);
  });

  authenticated.delete('/api/devices/me', (c) => {
    const principal = getGatewayPrincipal(c);
    if (principal.kind !== 'device' || !principal.deviceId) {
      return c.json({ ok: false, error: { code: 'DEVICE_REQUIRED', message: 'Device access required' } }, 403);
    }
    const revoked = revokeDevice(principal.deviceId);
    if (revoked) {
      deps.service.realtime.disconnectPrincipal(principal.deviceId);
      deps.service.voiceRealtime.disconnectPrincipal(principal.deviceId);
    }
    return c.json({ ok: true, revoked });
  });
}
