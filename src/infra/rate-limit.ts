/**
 * Fixed Window Rate Limiter
 *
 * Simple rate limiting using fixed window algorithm.
 * Prevents abuse by limiting requests within a time window.
 */

export type RateLimitResult = {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Time to wait before retry (ms) */
  retryAfterMs: number;
  /** Remaining requests in current window */
  remaining: number;
};

export type FixedWindowRateLimiter = {
  consume: () => RateLimitResult;
  reset: () => void;
};

export function createFixedWindowRateLimiter(params: {
  maxRequests: number;
  windowMs: number;
  now?: () => number;
}): FixedWindowRateLimiter {
  const maxRequests = Math.max(1, Math.floor(params.maxRequests));
  const windowMs = Math.max(1, Math.floor(params.windowMs));
  const now = params.now ?? Date.now;

  let count = 0;
  let windowStartMs = 0;

  return {
    consume(): RateLimitResult {
      const nowMs = now();
      
      // Reset window if expired
      if (nowMs - windowStartMs >= windowMs) {
        windowStartMs = nowMs;
        count = 0;
      }

      // Check limit
      if (count >= maxRequests) {
        return {
          allowed: false,
          retryAfterMs: Math.max(0, windowStartMs + windowMs - nowMs),
          remaining: 0,
        };
      }

      count += 1;
      return {
        allowed: true,
        retryAfterMs: 0,
        remaining: Math.max(0, maxRequests - count),
      };
    },

    reset(): void {
      count = 0;
      windowStartMs = 0;
    },
  };
}

/** Per-session rate limiter cache */
export class SessionRateLimiter {
  private readonly limiters = new Map<string, FixedWindowRateLimiter>();

  constructor(
    private readonly config: {
      maxRequests: number;
      windowMs: number;
    }
  ) {}

  /** Consume a request for the given session */
  consume(sessionKey: string): RateLimitResult {
    let limiter = this.limiters.get(sessionKey);
    if (!limiter) {
      limiter = createFixedWindowRateLimiter(this.config);
      this.limiters.set(sessionKey, limiter);
    }
    return limiter.consume();
  }

  /** Reset rate limiter for a session */
  reset(sessionKey: string): void {
    this.limiters.delete(sessionKey);
  }

  /** Clear all limiters */
  clear(): void {
    this.limiters.clear();
  }
}
