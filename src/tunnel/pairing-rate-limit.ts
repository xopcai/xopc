import { createFixedWindowRateLimiter, type RateLimitResult } from '../infra/rate-limit.js';

/** Failed pairing exchanges per client IP (brute-force / abuse mitigation). */
const EXCHANGE_FAIL_MAX = 30;
const EXCHANGE_FAIL_WINDOW_MS = 5 * 60_000;

const limiters = new Map<string, ReturnType<typeof createFixedWindowRateLimiter>>();

export function consumePairingExchangeFailLimit(clientKey: string): RateLimitResult {
  const key = clientKey.trim() || 'unknown';
  let limiter = limiters.get(key);
  if (!limiter) {
    limiter = createFixedWindowRateLimiter({
      maxRequests: EXCHANGE_FAIL_MAX,
      windowMs: EXCHANGE_FAIL_WINDOW_MS,
    });
    limiters.set(key, limiter);
  }
  return limiter.consume();
}

/** @internal */
export function resetPairingExchangeLimitsForTests(): void {
  limiters.clear();
}
