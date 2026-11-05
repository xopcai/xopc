import crypto from 'node:crypto';

import { bodyLimit } from 'hono/body-limit';
import type { Hono } from 'hono';
import { z } from 'zod';

import { parseEndpointPublicKey } from '../../../endpoint-tools/auth.js';
import { createDevice, getDevice, issueDeviceTokenPair } from '../../../storage/sqlite/device-access-repository.js';
import { createEndpointPrincipal, getEndpointPrincipal } from '../../../storage/sqlite/endpoint-principal-repository.js';
import { getOrCreateGatewayIdentity } from '../../../storage/sqlite/gateway-identity-repository.js';
import { runSqliteWriteTransaction } from '../../../storage/sqlite/transaction.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';

const enrollment = z.strictObject({ principalId: z.uuid(), publicKey: z.string().min(1).max(512),
  displayName: z.string().trim().min(1).max(80), platform: z.string().min(1).max(80) });

/** Explicit owner bootstrap issues a host-only credential, never an agent/admin credential. */
export function registerDeviceHostRoutes(app: Hono): void {
  app.post('/api/endpoint-tools/hosts/enrollment', bodyLimit({ maxSize: 4096 }), async c => {
    const actor = getGatewayPrincipal(c);
    if (actor.kind !== 'owner' || !actor.scopes.includes('gateway.admin')) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    const parsed = enrollment.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    const input = parsed.data;
    try {
      const key = parseEndpointPublicKey(input.publicKey);
      const tokens = runSqliteWriteTransaction(() => {
        const device = getDevice(input.principalId), principal = getEndpointPrincipal(input.principalId);
        if (device && (!device.scopes.every(scope => ['device.self', 'gateway.status'].includes(scope)) || device.revokedAt !== undefined || device.platform !== 'bridge'
          || !crypto.createPublicKey({ key: device.publicKeyJwk, format: 'jwk' }).export({ format: 'der', type: 'spki' }).equals(key.export({ format: 'der', type: 'spki' })))) throw new Error('Device identity cannot be rebound');
        if (principal && (principal.revokedAt !== undefined || principal.kind !== 'bridge' || principal.publicKey !== input.publicKey
          || principal.displayName !== input.displayName || principal.platform !== input.platform)) throw new Error('Principal identity cannot be rebound');
        if (!device) createDevice({ id: input.principalId, displayName: input.displayName, platform: 'bridge',
          publicKeyJwk: key.export({ format: 'jwk' }), scopes: ['device.self', 'gateway.status'] });
        if (!principal) createEndpointPrincipal({ id: input.principalId, displayName: input.displayName, kind: 'bridge', platform: input.platform, publicKey: input.publicKey });
        return issueDeviceTokenPair(input.principalId);
      });
      const gateway = getOrCreateGatewayIdentity();
      c.header('Cache-Control', 'no-store');
      return c.json({ ok: true, payload: { gatewayId: gateway.id, gatewayPublicKey: gateway.publicKey, tokens } }, 201);
    } catch { return c.json({ ok: false, error: { code: 'HOST_ENROLLMENT_DENIED' } }, 409); }
  });
}
