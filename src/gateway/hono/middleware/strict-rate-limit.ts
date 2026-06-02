/**
 * Per-client request-rate gate for sensitive admin/mutation endpoints.
 * Backed by `buckets.strictApi()` — see {@link ../../rate-limit/buckets.ts}.
 */

import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';

import { buckets } from '../../rate-limit/index.js';
import { getClientIpFromHeaders } from '../../security/loopback.js';
import { resolveClientIpFromRequest } from '../../client-ip.js';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('Hono:StrictRateLimit');

export type StrictRateLimitDeps = {
  getTrustedProxyContext: () => {
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
  };
};

function resolveClientIp(c: Context, deps: StrictRateLimitDeps): string {
  const { trustedProxies, allowRealIpFallback } = deps.getTrustedProxyContext();
  if (trustedProxies?.length) {
    let remoteAddress: string | undefined;
    try {
      remoteAddress = getConnInfo(c).remote.address;
    } catch {
      remoteAddress = undefined;
    }
    return resolveClientIpFromRequest({
      remoteAddress,
      getHeader: (name) => c.req.header(name),
      trustedProxies,
      allowRealIpFallback,
    });
  }
  return getClientIpFromHeaders({ get: (name) => c.req.header(name) ?? undefined });
}

export function createStrictRateLimitMiddleware(deps: StrictRateLimitDeps) {
  return createMiddleware(async (c, next) => {
    const limiter = buckets.strictApi();
    const clientIp = resolveClientIp(c, deps);
    const result = limiter.consume(clientIp);

    if (!result.allowed) {
      const retryAfterSec = Math.ceil(result.retryAfterMs / 1000);
      log.warn(
        {
          clientIp,
          path: c.req.path,
          method: c.req.method,
          retryAfterSec,
          reason: 'strict_rate_limit_exceeded',
        },
        'Strict API rate limit exceeded',
      );
      c.header('Retry-After', String(retryAfterSec));
      c.header('X-RateLimit-Remaining', '0');
      return c.json({ error: 'Too many requests', code: 'rate_limited' }, 429);
    }

    c.header('X-RateLimit-Remaining', String(result.remaining));
    await next();
  });
}
