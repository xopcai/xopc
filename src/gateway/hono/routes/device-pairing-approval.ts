import os from 'node:os';

import { getConnInfo } from '@hono/node-server/conninfo';
import {
  devicePairingCompleteSchema, devicePairingProofSchema, devicePairingRequestSchema,
} from '@xopcai/gateway-contract';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

import {
  cancelDevicePairingSetup, decideDevicePairingRequest, DevicePairingError,
  operateDevicePairingRequest, readDevicePairingSetup, submitDevicePairingRequest,
} from '../../../storage/sqlite/device-pairing-approval.js';
import { getOrCreateGatewayIdentity, signGatewayPayload } from '../../../storage/sqlite/gateway-identity-repository.js';
import { resolveClientIpFromRequest } from '../../client-ip.js';
import { buckets } from '../../rate-limit/index.js';

export type PairingPublicRouteOptions = {
  getTrustedProxyContext?: () => { trustedProxies?: string[]; allowRealIpFallback?: boolean };
};

export function pairingClientKey(c: Context, options?: PairingPublicRouteOptions): string {
  let remoteAddress: string | undefined;
  try { remoteAddress = getConnInfo(c).remote.address; }
  catch { remoteAddress = undefined; }
  const proxy = options?.getTrustedProxyContext?.();
  return resolveClientIpFromRequest({
    remoteAddress,
    getHeader: name => c.req.header(name),
    trustedProxies: proxy?.trustedProxies,
    allowRealIpFallback: proxy?.allowRealIpFallback,
  });
}

function pairingBlocked(c: Context, key: string) {
  const blocked = buckets.pairingExchange().check(key);
  if (!blocked.blocked) return undefined;
  c.header('Retry-After', String(blocked.retryAfterSec));
  return c.json({ ok: false, error: { code: 'PAIRING_RATE_LIMITED', message: 'Too many failed pairing attempts' } }, 429);
}

function pairingError(c: Context, error: unknown) {
  if (error instanceof DevicePairingError) return c.json({ ok: false, error: { code: error.code, message: error.code } }, error.status);
  return c.json({ ok: false, error: { code: 'PAIRING_FAILED', message: 'Pairing could not be completed' } }, 500);
}

export function registerPairingApprovalPublicRoutes(app: Hono, options?: PairingPublicRouteOptions): void {
  for (const action of ['request', 'status', 'complete', 'cancel'] as const) {
    const path = action === 'request' ? '/api/device-pairing/requests' : `/api/device-pairing/requests/:id/${action}`;
    app.post(path, bodyLimit({ maxSize: 4 * 1024 }), async (c) => {
      const clientKey = pairingClientKey(c, options);
      const blocked = pairingBlocked(c, clientKey);
      if (blocked) return blocked;
      const schema = action === 'request' ? devicePairingRequestSchema : action === 'complete' ? devicePairingCompleteSchema : devicePairingProofSchema;
      const parsed = schema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success || (action !== 'request' && parsed.data.requestId !== c.req.param('id'))) {
        buckets.pairingExchange().fail(clientKey);
        return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid pairing request' } }, 400);
      }
      try {
        const result = action === 'request'
          ? { request: submitDevicePairingRequest(parsed.data) }
          : operateDevicePairingRequest(action, parsed.data);
        const signedPayload = Buffer.from(JSON.stringify({
          ...result, gateway: { id: getOrCreateGatewayIdentity().id, name: os.hostname() },
          nonce: parsed.data.nonce, issuedAt: Date.now(),
        })).toString('base64url');
        buckets.pairingExchange().succeed(clientKey);
        return c.json({ ok: true, signedPayload, signature: signGatewayPayload(signedPayload) });
      } catch (error) {
        buckets.pairingExchange().fail(clientKey);
        return pairingError(c, error);
      }
    });
  }
}

export function registerPairingApprovalAdminRoutes(app: Hono): void {
  app.get('/api/device-pairing/setups/:id', (c) => {
    try { return c.json({ ok: true, ...readDevicePairingSetup(c.req.param('id')) }); }
    catch (error) { return pairingError(c, error); }
  });
  app.delete('/api/device-pairing/setups/:id', (c) => {
    cancelDevicePairingSetup(c.req.param('id'));
    return c.json({ ok: true });
  });
  app.post('/api/device-pairing/requests/:id/decision', async (c) => {
    const parsed = z.strictObject({ decision: z.enum(['approve', 'reject']), expectedRevision: z.number().int().positive() })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid decision' } }, 400);
    try {
      return c.json({ ok: true, request: decideDevicePairingRequest(c.req.param('id'), parsed.data.decision, parsed.data.expectedRevision) });
    } catch (error) { return pairingError(c, error); }
  });
}
