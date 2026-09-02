import os from 'node:os';

import type { Hono } from 'hono';
import { z } from 'zod';

import {
  listDevices,
  createDevice,
  issueDeviceTokenPair,
  revokeDevice,
  rotateDeviceRefreshToken,
} from '../../../storage/sqlite/device-access-repository.js';
import {
  consumeDevicePairingToken,
  createDevicePairingSetup,
  isDevicePairingSetupActive,
  type DeviceRoute,
} from '../../../storage/sqlite/device-pairing-repository.js';
import {
  getOrCreateGatewayIdentity,
  getGatewayIdentityPublicKeyRaw,
  signGatewayPayload,
} from '../../../storage/sqlite/gateway-identity-repository.js';
import { runSqliteWriteTransaction } from '../../../storage/sqlite/transaction.js';
import { DEFAULT_MOBILE_SCOPES } from '../../security/gateway-scopes.js';
import { resolveSecureDeviceRoutes } from '../../device-routes.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const refreshRequestSchema = z.strictObject({
  refreshToken: z.string().min(1).max(256),
  timestamp: z.number().int().positive(),
  nonce: z.string().min(16).max(128),
  requestId: z.string().uuid(),
  nextRefreshToken: z.string().min(80).max(256),
  signature: z.string().min(1).max(256),
});

const pairingExchangeSchema = z.strictObject({
  pairingToken: z.string().min(1).max(256),
  device: z.strictObject({
    displayName: z.string().trim().min(1).max(80),
    platform: z.enum(['ios', 'android']),
    publicKeyJwk: z.strictObject({
      kty: z.literal('EC'),
      crv: z.literal('P-256'),
      x: z.string().min(40).max(64),
      y: z.string().min(40).max(64),
    }),
  }),
});

const pairingProbeSchema = z.strictObject({
  pairingId: z.string().uuid(),
});

function pairingLinkPayload(input: {
  pairingToken: string;
  gatewayId: string;
  gatewayName: string;
  gatewayPublicKey: string;
  routes: ReturnType<typeof resolveSecureDeviceRoutes>;
  expiresAt: number;
}): string {
  return Buffer.from(JSON.stringify({ version: 2, ...input })).toString('base64url');
}

export function registerDeviceAuthPublicRoutes(app: Hono): void {
  app.post('/api/device-auth/refresh', async (c) => {
    const parsed = refreshRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid refresh request' } }, 400);
    }
    try {
      return c.json({ ok: true, payload: rotateDeviceRefreshToken(parsed.data) });
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

  app.post('/api/device-pairing/probe', async (c) => {
    const parsed = pairingProbeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success || !isDevicePairingSetupActive(parsed.data.pairingId)) {
      return c.json({ ok: false, error: { code: 'PAIRING_NOT_FOUND', message: 'Pairing setup not found' } }, 404);
    }
    const identity = getOrCreateGatewayIdentity();
    const payload = Buffer.from(JSON.stringify({
      gatewayId: identity.id,
      pairingId: parsed.data.pairingId,
      issuedAt: Date.now(),
    })).toString('base64url');
    return c.json({ ok: true, signedPayload: payload, signature: signGatewayPayload(payload) });
  });

  app.post('/api/device-pairing/exchange', async (c) => {
    const parsed = pairingExchangeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid pairing request' } }, 400);
    }
    const completed = runSqliteWriteTransaction(():
      | { success: false; reason: 'invalid' | 'expired' | 'consumed' }
      | {
          success: true;
          device: ReturnType<typeof createDevice>;
          routes: DeviceRoute[];
          tokens: ReturnType<typeof issueDeviceTokenPair>;
        } => {
      const pairing = consumeDevicePairingToken(parsed.data.pairingToken);
      if (!pairing.ok && 'reason' in pairing) return { success: false, reason: pairing.reason };
      const device = createDevice({
        displayName: parsed.data.device.displayName,
        platform: parsed.data.device.platform,
        publicKeyJwk: parsed.data.device.publicKeyJwk,
        scopes: DEFAULT_MOBILE_SCOPES,
      });
      return {
        success: true as const,
        device,
        routes: pairing.routes,
        tokens: issueDeviceTokenPair(device.id),
      };
    });
    if ('reason' in completed) {
      return c.json({
        ok: false,
        error: { code: 'PAIRING_DENIED', message: `Pairing ${completed.reason}` },
      }, 401);
    }
    const identity = getOrCreateGatewayIdentity();
    const payload = Buffer.from(JSON.stringify({
      gateway: { id: identity.id, name: os.hostname() },
      device: { id: completed.device.id, scopes: completed.device.scopes },
      routes: completed.routes,
      tokens: completed.tokens,
    })).toString('base64url');
    return c.json({
      ok: true,
      signedPayload: payload,
      signature: signGatewayPayload(payload),
    }, 201);
  });
}

export function registerDeviceRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  authenticated.get('/api/device-pairing/readiness', (c) => {
    const routes = resolveSecureDeviceRoutes(deps.service.currentConfig);
    return c.json({ ok: true, ready: routes.length > 0, routes });
  });

  authenticated.post('/api/device-pairing/setups', (c) => {
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
    const setup = createDevicePairingSetup(routes);
    const identity = getOrCreateGatewayIdentity();
    const encoded = pairingLinkPayload({
      pairingToken: setup.token,
      gatewayId: identity.id,
      gatewayName: os.hostname(),
      gatewayPublicKey: getGatewayIdentityPublicKeyRaw(identity),
      routes,
      expiresAt: setup.expiresAt,
    });
    return c.json({
      ok: true,
      setup: {
        id: setup.id,
        universalLink: `https://link.xopc.ai/connect#p=${encoded}`,
        expiresAt: setup.expiresAt,
        routes,
      },
    }, 201);
  });

  authenticated.get('/api/devices', (c) => c.json({ ok: true, devices: listDevices() }));

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

  authenticated.delete('/api/devices/:deviceId', (c) => {
    const deviceId = c.req.param('deviceId');
    const revoked = revokeDevice(deviceId);
    if (revoked) deps.service.realtime.disconnectPrincipal(deviceId);
    return c.json({ ok: true, revoked });
  });
}
