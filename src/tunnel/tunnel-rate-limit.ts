import { createHash } from 'node:crypto';

import { createFixedWindowRateLimiter, type RateLimitResult } from '../infra/rate-limit.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('TunnelRateLimit');

/** Mutating tunnel API calls per gateway token (consent / start / stop / release). */
const TUNNEL_MUTATION_MAX = 12;
const TUNNEL_MUTATION_WINDOW_MS = 5 * 60_000;

const limiters = new Map<string, ReturnType<typeof createFixedWindowRateLimiter>>();

function limiterKeyFromToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 16);
}

export function consumeTunnelMutationLimit(token: string): RateLimitResult {
  const key = limiterKeyFromToken(token);
  let limiter = limiters.get(key);
  if (!limiter) {
    limiter = createFixedWindowRateLimiter({
      maxRequests: TUNNEL_MUTATION_MAX,
      windowMs: TUNNEL_MUTATION_WINDOW_MS,
    });
    limiters.set(key, limiter);
  }
  const result = limiter.consume();
  if (!result.allowed) {
    log.warn(
      {
        tokenPrefix: token.slice(0, 8),
        limit: TUNNEL_MUTATION_MAX,
        windowSec: Math.round(TUNNEL_MUTATION_WINDOW_MS / 1000),
        retryAfterSec: Math.ceil(result.retryAfterMs / 1000),
        reason: 'tunnel_mutation_limit',
      },
      `Tunnel mutation rate limit exceeded: ${TUNNEL_MUTATION_MAX} mutations per ${TUNNEL_MUTATION_WINDOW_MS / 60000}min`,
    );
  }
  return result;
}

/** @internal Test helper */
export function resetTunnelMutationLimitsForTests(): void {
  limiters.clear();
}
