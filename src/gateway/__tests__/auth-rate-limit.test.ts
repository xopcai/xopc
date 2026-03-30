import { describe, it, expect, beforeEach } from 'vitest';
import {
  AuthFailureRateLimiter,
  resolveAuthRateLimitConfig,
  getClientIpFromHeaders,
} from '../auth-rate-limit.js';

describe('AuthFailureRateLimiter', () => {
  const cfg = resolveAuthRateLimitConfig({
    enabled: true,
    maxAttempts: 3,
    windowMs: 60_000,
    blockDurationMs: 5_000,
  });

  let limiter: AuthFailureRateLimiter;

  beforeEach(() => {
    limiter = new AuthFailureRateLimiter();
    limiter.resetForTests();
  });

  it('allows attempts until max failures then blocks', () => {
    expect(limiter.checkBlocked('1.2.3.4', cfg).blocked).toBe(false);
    limiter.recordFailure('1.2.3.4', cfg);
    expect(limiter.checkBlocked('1.2.3.4', cfg).blocked).toBe(false);
    limiter.recordFailure('1.2.3.4', cfg);
    expect(limiter.checkBlocked('1.2.3.4', cfg).blocked).toBe(false);
    limiter.recordFailure('1.2.3.4', cfg);
    const blocked = limiter.checkBlocked('1.2.3.4', cfg);
    expect(blocked.blocked).toBe(true);
    if (blocked.blocked) {
      expect(blocked.retryAfterSec).toBeGreaterThan(0);
    }
  });

  it('clears state on success', () => {
    limiter.recordFailure('1.2.3.4', cfg);
    limiter.recordFailure('1.2.3.4', cfg);
    limiter.recordSuccess('1.2.3.4');
    expect(limiter.checkBlocked('1.2.3.4', cfg).blocked).toBe(false);
    limiter.recordFailure('1.2.3.4', cfg);
    expect(limiter.checkBlocked('1.2.3.4', cfg).blocked).toBe(false);
  });
});

describe('getClientIpFromHeaders', () => {
  it('uses first x-forwarded-for hop', () => {
    const ip = getClientIpFromHeaders({
      get: (n) => (n === 'x-forwarded-for' ? '203.0.113.1, 10.0.0.1' : undefined),
    });
    expect(ip).toBe('203.0.113.1');
  });
});
