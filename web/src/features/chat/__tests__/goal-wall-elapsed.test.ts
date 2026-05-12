import { describe, expect, it } from 'vitest';

import { computeGoalWallElapsedMs } from '../format-execution-elapsed';

describe('computeGoalWallElapsedMs', () => {
  it('uses now for active goals', () => {
    const ms = computeGoalWallElapsedMs(
      { createdAt: 1000, lastTurnAt: 0, status: 'active' },
      11_000,
    );
    expect(ms).toBe(10_000);
  });

  it('uses lastTurnAt when done and lastTurnAt >= createdAt', () => {
    const ms = computeGoalWallElapsedMs(
      { createdAt: 1000, lastTurnAt: 5000, status: 'done' },
      99_000,
    );
    expect(ms).toBe(4000);
  });

  it('returns 0 for invalid createdAt', () => {
    expect(computeGoalWallElapsedMs({ createdAt: 0, lastTurnAt: 0, status: 'active' }, 5000)).toBe(0);
  });
});
