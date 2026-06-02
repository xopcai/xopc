import { describe, expect, it } from 'vitest';

import { RateLimiter } from '../rate-limiter.js';

describe('RateLimiter', () => {
  function withClock(start = 1_000_000) {
    let now = start;
    const tick = (ms: number) => {
      now += ms;
    };
    const clock = () => now;
    return { tick, clock };
  }

  it('allows up to maxRequests then blocks until window rolls over', () => {
    const { tick, clock } = withClock();
    const rl = new RateLimiter({ maxRequests: 3, windowMs: 1000, clock });

    expect(rl.consume('a').allowed).toBe(true);
    expect(rl.consume('a').allowed).toBe(true);
    expect(rl.consume('a').allowed).toBe(true);

    const blocked = rl.consume('a');
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.retryAfterMs).toBeGreaterThan(0);
    }

    tick(1001);
    expect(rl.consume('a').allowed).toBe(true);
  });

  it('isolates counts by key', () => {
    const { clock } = withClock();
    const rl = new RateLimiter({ maxRequests: 1, windowMs: 1000, clock });

    expect(rl.consume('a').allowed).toBe(true);
    expect(rl.consume('a').allowed).toBe(false);
    expect(rl.consume('b').allowed).toBe(true);
  });

  it('reports remaining slots', () => {
    const { clock } = withClock();
    const rl = new RateLimiter({ maxRequests: 5, windowMs: 1000, clock });
    const r1 = rl.consume('a');
    expect(r1.allowed && r1.remaining).toBe(4);
    const r2 = rl.consume('a');
    expect(r2.allowed && r2.remaining).toBe(3);
  });
});
