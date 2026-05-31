import { createFixedWindowRateLimiter, type RateLimitResult } from '../infra/rate-limit.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ShareRateLimit');

/** Per-IP rate limiter for public share download routes. */
const SHORT_WINDOW_MAX = 60;
const SHORT_WINDOW_MS = 60_000;

const LONG_WINDOW_MAX = 300;
const LONG_WINDOW_MS = 15 * 60_000;

const shortLimiters = new Map<string, ReturnType<typeof createFixedWindowRateLimiter>>();
const longLimiters = new Map<string, ReturnType<typeof createFixedWindowRateLimiter>>();

export function consumeSharePublicLimit(clientIp: string): RateLimitResult {
  let shortLimiter = shortLimiters.get(clientIp);
  if (!shortLimiter) {
    shortLimiter = createFixedWindowRateLimiter({ maxRequests: SHORT_WINDOW_MAX, windowMs: SHORT_WINDOW_MS });
    shortLimiters.set(clientIp, shortLimiter);
  }
  const shortResult = shortLimiter.consume();
  if (!shortResult.allowed) {
    log.warn(
      {
        clientIp,
        limit: SHORT_WINDOW_MAX,
        windowSec: Math.round(SHORT_WINDOW_MS / 1000),
        retryAfterSec: Math.ceil(shortResult.retryAfterMs / 1000),
        reason: 'short_window_exceeded',
      },
      `Share public rate limit exceeded: ${SHORT_WINDOW_MAX} req/${SHORT_WINDOW_MS / 1000}s per IP`,
    );
    return shortResult;
  }

  let longLimiter = longLimiters.get(clientIp);
  if (!longLimiter) {
    longLimiter = createFixedWindowRateLimiter({ maxRequests: LONG_WINDOW_MAX, windowMs: LONG_WINDOW_MS });
    longLimiters.set(clientIp, longLimiter);
  }
  const longResult = longLimiter.consume();
  if (!longResult.allowed) {
    log.warn(
      {
        clientIp,
        limit: LONG_WINDOW_MAX,
        windowSec: Math.round(LONG_WINDOW_MS / 1000),
        retryAfterSec: Math.ceil(longResult.retryAfterMs / 1000),
        reason: 'long_window_exceeded',
      },
      `Share public rate limit exceeded: ${LONG_WINDOW_MAX} req/${LONG_WINDOW_MS / 60000}min per IP`,
    );
  }
  return longResult;
}

/** @internal */
export function resetSharePublicLimitsForTests(): void {
  shortLimiters.clear();
  longLimiters.clear();
}
