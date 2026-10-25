import type { Hono } from 'hono';
import { z } from 'zod';

import { resolveAdbPath } from '../../../phone/adb-driver.js';
import type { PhoneRuntime } from '../../../phone/runtime.js';
import { validateWirelessHost } from '../../../phone/wireless.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const hostSchema = z.string().max(100).refine(value => { validateWirelessHost(value); return true; });
const endpoint = z.object({ host: hostSchema, port: z.number().int().min(1).max(65535) }).strict();

export function registerPhoneWirelessRoutes(app: Hono, deps: AuthenticatedRouteDeps, runtime: PhoneRuntime): void {
  const { service, strictRateLimitMiddleware } = deps;
  const path = () => resolveAdbPath(service.currentConfig.phone.adbPath);
  app.use('/api/phone/wireless/*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
  app.get('/api/phone/wireless/discovery', async c => c.json({ ok: true, payload: await runtime.wireless.discovery(path(), c.req.raw.signal) }));
  app.post('/api/phone/wireless/pairings', strictRateLimitMiddleware, async c => {
    const input = z.discriminatedUnion('method', [z.object({ method: z.literal('qr') }).strict(),
      z.object({ method: z.literal('code'), host: hostSchema, pairingPort: z.number().int().min(1).max(65535),
        code: z.string().regex(/^\d{6}$/), connectPort: z.number().int().min(1).max(65535).optional() }).strict()]).parse(await c.req.json());
    return c.json({ ok: true, payload: runtime.wireless.create(getGatewayPrincipal(c).principalId, path(), input.method === 'code' ? input : undefined) }, 201);
  });
  app.get('/api/phone/wireless/pairings/:id', c => c.json({ ok: true, payload: runtime.wireless.get(getGatewayPrincipal(c).principalId, z.string().uuid().parse(c.req.param('id'))) }));
  app.delete('/api/phone/wireless/pairings/:id', c => {
    runtime.wireless.cancel(getGatewayPrincipal(c).principalId, z.string().uuid().parse(c.req.param('id'))); return c.json({ ok: true });
  });
  app.post('/api/phone/wireless/connect', strictRateLimitMiddleware, async c => {
    const input = endpoint.parse(await c.req.json());
    return c.json({ ok: true, payload: (await runtime.wireless.connect(path(), input, c.req.raw.signal)).device });
  });
  app.post('/api/phone/devices/:id/reconnect', strictRateLimitMiddleware, async c => {
    const input = z.union([endpoint, z.object({}).strict().transform(() => undefined)]).parse(await c.req.json());
    c.header('Cache-Control', 'no-store');
    return c.json({ ok: true, payload: await runtime.reconnectWireless(c.req.param('id'), service.currentConfig, c.req.raw.signal, input) });
  });
}
