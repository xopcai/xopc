/**
 * Rate Limiter Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createFixedWindowRateLimiter,
  SessionRateLimiter,
  type FixedWindowRateLimiter,
} from "../rate-limit.js";

describe("createFixedWindowRateLimiter", () => {
  it("should allow requests within limit", () => {
    const limiter = createFixedWindowRateLimiter({
      maxRequests: 3,
      windowMs: 1000,
    });

    expect(limiter.consume().allowed).toBe(true);
    expect(limiter.consume().allowed).toBe(true);
    expect(limiter.consume().allowed).toBe(true);
  });

  it("should block requests over limit", () => {
    const limiter = createFixedWindowRateLimiter({
      maxRequests: 2,
      windowMs: 1000,
    });

    limiter.consume();
    limiter.consume();
    const result = limiter.consume();

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("should reset window after expiry", () => {
    const now = vi.fn(() => 0);
    const limiter = createFixedWindowRateLimiter({
      maxRequests: 1,
      windowMs: 1000,
      now,
    });

    limiter.consume();
    now.mockReturnValue(1001); // After window expires

    const result = limiter.consume();
    expect(result.allowed).toBe(true);
  });

  it("should track remaining requests", () => {
    const limiter = createFixedWindowRateLimiter({
      maxRequests: 5,
      windowMs: 1000,
    });

    expect(limiter.consume().remaining).toBe(4);
    expect(limiter.consume().remaining).toBe(3);
    expect(limiter.consume().remaining).toBe(2);
  });

  it("should reset to initial state", () => {
    const limiter = createFixedWindowRateLimiter({
      maxRequests: 1,
      windowMs: 1000,
    });

    limiter.consume();
    limiter.reset();

    const result = limiter.consume();
    expect(result.allowed).toBe(true);
  });

  it("should handle edge case of zero maxRequests", () => {
    const limiter = createFixedWindowRateLimiter({
      maxRequests: 0,
      windowMs: 1000,
    });

    // Should normalize to at least 1
    expect(limiter.consume().allowed).toBe(true);
  });
});

describe("SessionRateLimiter", () => {
  let limiter: SessionRateLimiter;

  beforeEach(() => {
    limiter = new SessionRateLimiter({
      maxRequests: 3,
      windowMs: 1000,
    });
  });

  it("should create separate limiters per session", () => {
    // Session A uses all requests
    expect(limiter.consume("session-a").allowed).toBe(true);
    expect(limiter.consume("session-a").allowed).toBe(true);
    expect(limiter.consume("session-a").allowed).toBe(true);
    expect(limiter.consume("session-a").allowed).toBe(false);

    // Session B should still have full quota
    expect(limiter.consume("session-b").allowed).toBe(true);
    expect(limiter.consume("session-b").allowed).toBe(true);
    expect(limiter.consume("session-b").allowed).toBe(true);
  });

  it("should reset specific session", () => {
    limiter.consume("session-a");
    limiter.consume("session-a");
    limiter.reset("session-a");

    // Should have full quota again
    expect(limiter.consume("session-a").allowed).toBe(true);
    expect(limiter.consume("session-a").allowed).toBe(true);
    expect(limiter.consume("session-a").allowed).toBe(true);
  });

  it("should clear all sessions", () => {
    limiter.consume("session-a");
    limiter.consume("session-a");
    limiter.consume("session-b");
    limiter.consume("session-b");

    limiter.clear();

    // Both should have full quota
    expect(limiter.consume("session-a").allowed).toBe(true);
    expect(limiter.consume("session-a").allowed).toBe(true);
    expect(limiter.consume("session-b").allowed).toBe(true);
    expect(limiter.consume("session-b").allowed).toBe(true);
  });

  it("should share state for same session key", () => {
    // First call creates limiter
    const result1 = limiter.consume("session-a");
    expect(result1.remaining).toBe(2);

    // Second call uses same limiter
    const result2 = limiter.consume("session-a");
    expect(result2.remaining).toBe(1);

    // Third call
    const result3 = limiter.consume("session-a");
    expect(result3.remaining).toBe(0);

    // Fourth call blocked
    const result4 = limiter.consume("session-a");
    expect(result4.allowed).toBe(false);
  });
});
