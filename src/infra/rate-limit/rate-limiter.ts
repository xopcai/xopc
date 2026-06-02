/**
 * Per-key fixed-window request-rate limiter. Every `consume()` counts toward
 * the limit; once the window's count hits `maxRequests`, subsequent consumes
 * return `allowed: false` until the window rolls over.
 *
 * Use this for *throughput* limiting (e.g. "15 req/min on /admin"). For
 * *failure-rate* limiting with lockout (e.g. brute-force protection), use
 * {@link FailureLimiter} instead.
 */

import { KeyedStore, type Clock } from './keyed-store.js';

export type RateLimiterConfig = {
  maxRequests: number;
  windowMs: number;
  /** How long to retain idle keys before sweep. Defaults to 4× windowMs. */
  staleAfterMs?: number;
  clock?: Clock;
};

/**
 * Flat rather than tagged-union: project's tsconfig has `strict: false`, which
 * disables boolean discriminator narrowing through `if (!x.allowed)`. Both
 * fields are always populated — `retryAfterMs` is 0 on success, `remaining`
 * is 0 on block.
 */
export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
};

type State = {
  windowStart: number;
  count: number;
  lastTouchedMs: number;
};

export class RateLimiter {
  private readonly store: KeyedStore<State>;
  private readonly clock: Clock;
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(cfg: RateLimiterConfig) {
    this.maxRequests = Math.max(1, Math.floor(cfg.maxRequests));
    this.windowMs = Math.max(1, Math.floor(cfg.windowMs));
    this.clock = cfg.clock ?? Date.now;
    this.store = new KeyedStore<State>({
      staleAfterMs: cfg.staleAfterMs ?? this.windowMs * 4,
      clock: this.clock,
    });
  }

  consume(key: string): RateLimitDecision {
    const now = this.clock();
    let state = this.store.get(key);
    if (!state) {
      state = { windowStart: now, count: 0, lastTouchedMs: now };
      this.store.set(key, state);
    }

    if (now - state.windowStart >= this.windowMs) {
      state.windowStart = now;
      state.count = 0;
    }

    state.lastTouchedMs = now;

    if (state.count >= this.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(0, state.windowStart + this.windowMs - now),
      };
    }

    state.count += 1;
    return { allowed: true, remaining: this.maxRequests - state.count, retryAfterMs: 0 };
  }

  /** @internal Test hook. */
  resetForTests(): void {
    this.store.clear();
  }

  destroy(): void {
    this.store.destroy();
  }
}
