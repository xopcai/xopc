import { buckets } from '../gateway/rate-limit/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ShareRateLimit');

export type SharePublicLimitResult = {
  allowed: boolean;
  retryAfterMs: number;
};

/**
 * Two-level limiter for public share download routes: a short burst window
 * and a longer aggregate window. The short window kicks in first; if it
 * blocks, the long window isn't consumed (we don't want to penalize twice).
 */
export function consumeSharePublicLimit(clientIp: string): SharePublicLimitResult {
  const short = buckets.sharePublicShort().consume(clientIp);
  if (!short.allowed) {
    log.warn(
      {
        clientIp,
        retryAfterSec: Math.ceil(short.retryAfterMs / 1000),
        reason: 'share_short_window',
      },
      'Share public rate limit exceeded (short window)',
    );
    return { allowed: false, retryAfterMs: short.retryAfterMs };
  }

  const long = buckets.sharePublicLong().consume(clientIp);
  if (!long.allowed) {
    log.warn(
      {
        clientIp,
        retryAfterSec: Math.ceil(long.retryAfterMs / 1000),
        reason: 'share_long_window',
      },
      'Share public rate limit exceeded (long window)',
    );
    return { allowed: false, retryAfterMs: long.retryAfterMs };
  }

  return { allowed: true, retryAfterMs: 0 };
}

/** @internal */
export function resetSharePublicLimitsForTests(): void {
  buckets.sharePublicShort().resetForTests();
  buckets.sharePublicLong().resetForTests();
}
