import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { signedDesktopExecutionStopSchema } from '@xopcai/gateway-contract';
import { z } from 'zod';

import { recordDesktopExecutionStop } from '../../../storage/sqlite/desktop-execution-stop-repository.js';
import { getOrCreateGatewayIdentity, signGatewayPayload } from '../../../storage/sqlite/gateway-identity-repository.js';
import { publicDeviceRateLimit, type PairingPublicRouteOptions } from '../middleware/public-device-rate-limit.js';

/** Independently signature-authenticated, purpose-limited stop receipt. It cannot mint tokens, grant scopes or review outcomes. */
export function registerDesktopExecutionStopPublicRoutes(app: Hono, options?: PairingPublicRouteOptions & { onStopped?(deviceId: string): void }) {
  const input = z.strictObject({ signed: signedDesktopExecutionStopSchema, nonce: z.string().regex(/^[A-Za-z0-9_-]{32,64}$/) });
  app.post('/api/device-auth/execution-stops', publicDeviceRateLimit('execution-stop', options), bodyLimit({ maxSize: 2048,
    onError: c => c.json({ ok: false, error: { code: 'BODY_LIMIT' } }, 413) }), async c => {
    c.header('Cache-Control', 'no-store');
    const parsed = input.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    try {
      const { revokedCurrent, ...result } = recordDesktopExecutionStop(parsed.data.signed);
      if (revokedCurrent) options?.onStopped?.(result.deviceId);
      const signedPayload = Buffer.from(JSON.stringify({ purpose: 'desktop-execution-stop-v1', gatewayId: getOrCreateGatewayIdentity().id,
        nonce: parsed.data.nonce, issuedAt: Date.now(), ...result })).toString('base64url');
      return c.json({ signedPayload, signature: signGatewayPayload(signedPayload) });
    } catch (error) {
      return c.json({ ok: false, error: { code: error instanceof Error && error.message === 'DESKTOP_STOP_CONFLICT' ? 'DESKTOP_STOP_CONFLICT' : 'DESKTOP_STOP_INVALID' } }, 403);
    }
  });
}
