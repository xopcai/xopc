import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';

import { buckets } from '../../rate-limit/index.js';
import { resolveClientIpFromRequest } from '../../client-ip.js';

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


/** Shared local-hop budgets allow normal mobile polling while bounding pre-auth work. */
export function publicDeviceRateLimit(family: string, options?: PairingPublicRouteOptions) {
  return createMiddleware(async (c, next) => {
    const source = buckets.publicDeviceSource().consume(`${family}:${pairingClientKey(c, options)}`);
    const total = buckets.publicDeviceGlobal().consume(family);
    if (!source.allowed || !total.allowed) {
      const retry = Math.max(source.retryAfterMs, total.retryAfterMs);
      c.header('Retry-After', String(Math.max(1, Math.ceil(retry / 1000))));
      return c.json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, 429);
    }
    return next();
  });
}
