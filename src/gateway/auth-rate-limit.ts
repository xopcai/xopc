/**
 * Rate limiting for failed gateway token authentication attempts (per client IP).
 */

export type AuthRateLimitConfig = {
  enabled: boolean;
  maxAttempts: number;
  windowMs: number;
  blockDurationMs: number;
};

const DEFAULT_CONFIG: AuthRateLimitConfig = {
  enabled: true,
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,
  blockDurationMs: 5 * 60 * 1000,
};

export type GatewayAuthRateLimitInput = {
  enabled?: boolean;
  maxAttempts?: number;
  windowMs?: number;
  blockDurationMs?: number;
} | undefined;

export function resolveAuthRateLimitConfig(
  input: GatewayAuthRateLimitInput,
): AuthRateLimitConfig {
  if (!input) {
    return { ...DEFAULT_CONFIG };
  }
  return {
    enabled: input.enabled ?? DEFAULT_CONFIG.enabled,
    maxAttempts: Math.max(1, Math.floor(input.maxAttempts ?? DEFAULT_CONFIG.maxAttempts)),
    windowMs: Math.max(1000, Math.floor(input.windowMs ?? DEFAULT_CONFIG.windowMs)),
    blockDurationMs: Math.max(1000, Math.floor(input.blockDurationMs ?? DEFAULT_CONFIG.blockDurationMs)),
  };
}

export function isAuthRateLimitGloballyDisabled(): boolean {
  return process.env.XOPCBOT_AUTH_RATE_LIMIT === 'false';
}

type IpState = {
  windowStart: number;
  count: number;
  blockedUntil?: number;
};

/**
 * Tracks failed auth attempts per IP; blocks further attempts after the threshold.
 */
export class AuthFailureRateLimiter {
  private readonly store = new Map<string, IpState>();
  private cleanupTimer?: NodeJS.Timeout;

  constructor() {
    const interval = 10 * 60 * 1000;
    this.cleanupTimer = setInterval(() => this.cleanupStale(), interval);
    this.cleanupTimer.unref?.();
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.store.clear();
  }

  private cleanupStale(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000;
    for (const [ip, state] of this.store.entries()) {
      const last = state.blockedUntil ?? state.windowStart;
      if (now - last > maxAge) {
        this.store.delete(ip);
      }
    }
  }

  /**
   * Whether this IP is currently blocked from attempting authentication.
   */
  checkBlocked(
    clientIp: string,
    cfg: AuthRateLimitConfig,
    nowMs: number = Date.now(),
  ): { blocked: false } | { blocked: true; retryAfterSec: number } {
    const state = this.store.get(clientIp);
    if (!state?.blockedUntil) {
      return { blocked: false };
    }
    if (nowMs >= state.blockedUntil) {
      state.blockedUntil = undefined;
      state.count = 0;
      state.windowStart = nowMs;
      return { blocked: false };
    }
    return {
      blocked: true,
      retryAfterSec: Math.max(1, Math.ceil((state.blockedUntil - nowMs) / 1000)),
    };
  }

  /**
   * Record a failed authentication (missing or invalid token when token auth is required).
   */
  recordFailure(clientIp: string, cfg: AuthRateLimitConfig, nowMs: number = Date.now()): void {
    let state = this.store.get(clientIp);
    if (!state) {
      state = { windowStart: nowMs, count: 0 };
      this.store.set(clientIp, state);
    }

    if (state.blockedUntil && nowMs < state.blockedUntil) {
      return;
    }
    if (state.blockedUntil && nowMs >= state.blockedUntil) {
      state.blockedUntil = undefined;
      state.count = 0;
      state.windowStart = nowMs;
    }

    if (nowMs - state.windowStart > cfg.windowMs) {
      state.count = 0;
      state.windowStart = nowMs;
    }

    state.count += 1;
    if (state.count >= cfg.maxAttempts) {
      state.blockedUntil = nowMs + cfg.blockDurationMs;
    }
  }

  /**
   * Clear state after a successful authentication.
   */
  recordSuccess(clientIp: string): void {
    this.store.delete(clientIp);
  }

  /** Test hook: clear all entries */
  resetForTests(): void {
    this.store.clear();
  }
}

let singleton: AuthFailureRateLimiter | null = null;

export function getAuthFailureRateLimiter(): AuthFailureRateLimiter {
  if (!singleton) {
    singleton = new AuthFailureRateLimiter();
  }
  return singleton;
}

export function getClientIpFromHeaders(headers: {
  get(name: string): string | undefined;
}): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  const cf = headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  return 'unknown';
}
