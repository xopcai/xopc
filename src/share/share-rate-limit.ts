import { createFixedWindowRateLimiter, type RateLimitResult } from '../infra/rate-limit.js';

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
  if (!shortResult.allowed) return shortResult;

  let longLimiter = longLimiters.get(clientIp);
  if (!longLimiter) {
    longLimiter = createFixedWindowRateLimiter({ maxRequests: LONG_WINDOW_MAX, windowMs: LONG_WINDOW_MS });
    longLimiters.set(clientIp, longLimiter);
  }
  return longLimiter.consume();
}

/** @internal */
export function resetSharePublicLimitsForTests(): void {
  shortLimiters.clear();
  longLimiters.clear();
}
