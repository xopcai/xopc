import { describe, expect, it } from 'vitest';

import { FailureLimiter } from '../failure-limiter.js';

describe('FailureLimiter', () => {
  function withClock(start = 1_000_000) {
    let now = start;
    return {
      clock: () => now,
      tick: (ms: number) => {
        now += ms;
      },
    };
  }

  it('blocks after maxFailures and reports retryAfterSec', () => {
    const { clock, tick } = withClock();
    const fl = new FailureLimiter({
      maxFailures: 3,
      windowMs: 60_000,
      blockDurationMs: 5_000,
      clock,
    });

    fl.fail('1.2.3.4');
    tick(2000);
    fl.fail('1.2.3.4');
    tick(2000);
    fl.fail('1.2.3.4');

    const c = fl.check('1.2.3.4');
    expect(c.blocked).toBe(true);
    if (c.blocked) expect(c.retryAfterSec).toBeGreaterThan(0);
  });

  it('coalesces sub-second bursts to a single attempt', () => {
    const { clock, tick } = withClock();
    const fl = new FailureLimiter({
      maxFailures: 3,
      windowMs: 60_000,
      blockDurationMs: 5_000,
      burstCoalesceMs: 1000,
      clock,
    });

    // 10 failures in 500ms — must NOT lock.
    for (let i = 0; i < 10; i += 1) {
      fl.fail('evil');
      tick(50);
    }
    expect(fl.check('evil').blocked).toBe(false);
  });

  it('locks when failures spaced past the coalesce window accumulate', () => {
    const { clock, tick } = withClock();
    const fl = new FailureLimiter({
      maxFailures: 3,
      windowMs: 60_000,
      blockDurationMs: 5_000,
      burstCoalesceMs: 1000,
      clock,
    });
    fl.fail('a');
    tick(2000);
    fl.fail('a');
    tick(2000);
    fl.fail('a');
    expect(fl.check('a').blocked).toBe(true);
  });

  it('clears state on succeed', () => {
    const { clock, tick } = withClock();
    const fl = new FailureLimiter({
      maxFailures: 3,
      windowMs: 60_000,
      blockDurationMs: 5_000,
      clock,
    });
    fl.fail('a');
    tick(2000);
    fl.fail('a');
    fl.succeed('a');
    tick(2000);
    fl.fail('a');
    tick(2000);
    fl.fail('a');
    // After succeed wiped state, two more failures shouldn't be enough.
    expect(fl.check('a').blocked).toBe(false);
  });

  it('auto-unlocks when block duration elapses', () => {
    const { clock, tick } = withClock();
    const fl = new FailureLimiter({
      maxFailures: 2,
      windowMs: 60_000,
      blockDurationMs: 5_000,
      clock,
    });
    fl.fail('a');
    tick(2000);
    fl.fail('a');
    expect(fl.check('a').blocked).toBe(true);
    tick(5_001);
    expect(fl.check('a').blocked).toBe(false);
  });
});
