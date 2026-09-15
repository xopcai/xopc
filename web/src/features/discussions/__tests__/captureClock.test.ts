import { describe, expect, it } from 'vitest';

import { CaptureClock } from '../captureClock';

describe('CaptureClock', () => {
  it('preserves active time over pauses and resumes, including a zero clock origin', () => {
    let now = 0;
    const clock = new CaptureClock(() => now);
    clock.resume();
    now = 2_000;
    expect(clock.elapsedMs).toBe(2_000);
    clock.pause();
    now = 20_000;
    clock.pause();
    expect(clock.elapsedMs).toBe(2_000);
    clock.resume();
    now = 21_000;
    clock.resume();
    expect(clock.elapsedMs).toBe(3_000);
    clock.reset(10_000);
    expect(clock.elapsedMs).toBe(10_000);
  });
});
