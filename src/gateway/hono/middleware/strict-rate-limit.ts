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

function createClientRateLimitMiddleware(
  deps: StrictRateLimitDeps,
  options: {
    limiter: () => ReturnType<typeof buckets.strictApi>;
    exceededMessage: string;
    reason: string;
  },
) {
  return createMiddleware(async (c, next) => {
    const limiter = options.limiter();
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
          reason: options.reason,
        },
        options.exceededMessage,
      );
      c.header('Retry-After', String(retryAfterSec));
      c.header('X-RateLimit-Remaining', '0');
      return c.json({ error: 'Too many requests', code: 'rate_limited' }, 429);
    }

    c.header('X-RateLimit-Remaining', String(result.remaining));
    await next();
  });
}

export function createStrictRateLimitMiddleware(deps: StrictRateLimitDeps) {
  return createClientRateLimitMiddleware(deps, {
    limiter: () => buckets.strictApi(),
    exceededMessage: 'Strict API rate limit exceeded',
    reason: 'strict_rate_limit_exceeded',
  });
}

export function createChannelRateLimitMiddleware(deps: StrictRateLimitDeps) {
  return createClientRateLimitMiddleware(deps, {
    limiter: () => buckets.channelApi(),
    exceededMessage: 'Channel API rate limit exceeded',
    reason: 'channel_rate_limit_exceeded',
  });
}
