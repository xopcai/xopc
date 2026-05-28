import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import {
  AuthFailureRateLimiter,
  buildBrowserOriginRateLimitKey,
  isLoopbackClientIp,
  getClientIpFromHeaders,
  resolveAuthRateLimitConfig,
  resetAuthRateLimitersForTests,
} from '../auth-rate-limit.js';

describe('AuthFailureRateLimiter', () => {
  const cfg = resolveAuthRateLimitConfig({
    enabled: true,
    maxAttempts: 3,
    windowMs: 60_000,
    blockDurationMs: 5_000,
    exemptLoopback: true,
  });

  let limiter: AuthFailureRateLimiter;

  beforeEach(() => {
    resetAuthRateLimitersForTests();
    limiter = new AuthFailureRateLimiter();
    limiter.resetForTests();
  });

  afterEach(() => {
    limiter.resetForTests();
  });

  it('allows attempts until max failures then blocks', () => {
    expect(limiter.checkBlocked('1.2.3.4', cfg).blocked).toBe(false);
    limiter.recordFailure('1.2.3.4', cfg);
    limiter.recordFailure('1.2.3.4', cfg);
    limiter.recordFailure('1.2.3.4', cfg);
    expect(limiter.checkBlocked('1.2.3.4', cfg).blocked).toBe(true);
  });

  it('exempts loopback clients when configured', () => {
    expect(isLoopbackClientIp('127.0.0.1')).toBe(true);
    limiter.recordFailure('127.0.0.1', cfg);
    limiter.recordFailure('127.0.0.1', cfg);
    limiter.recordFailure('127.0.0.1', cfg);
    expect(limiter.checkBlocked('127.0.0.1', cfg).blocked).toBe(false);
  });

  it('exempts loopback browser-origin keys when configured', () => {
    const key = buildBrowserOriginRateLimitKey('http://localhost:18790', '127.0.0.1');
    limiter.recordFailure(key, cfg);
    limiter.recordFailure(key, cfg);
    limiter.recordFailure(key, cfg);
    expect(limiter.checkBlocked(key, cfg).blocked).toBe(false);
  });

  it('still rate limits non-loopback browser-origin keys', () => {
    const key = buildBrowserOriginRateLimitKey('http://evil.example.com', '127.0.0.1');
    limiter.recordFailure(key, cfg);
    limiter.recordFailure(key, cfg);
    limiter.recordFailure(key, cfg);
    expect(limiter.checkBlocked(key, cfg).blocked).toBe(true);
  });

  it('supports lockoutMs alias', () => {
    const fromAlias = resolveAuthRateLimitConfig({ lockoutMs: 42_000 });
    expect(fromAlias.blockDurationMs).toBe(42_000);
  });

  it('clears state on success', () => {
    limiter.recordFailure('1.2.3.4', cfg);
    limiter.recordFailure('1.2.3.4', cfg);
    limiter.recordSuccess('1.2.3.4');
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
