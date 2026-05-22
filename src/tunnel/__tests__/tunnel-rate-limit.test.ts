import { afterEach, describe, expect, it } from 'vitest';

import {
  consumeTunnelMutationLimit,
  resetTunnelMutationLimitsForTests,
} from '../tunnel-rate-limit.js';

describe('tunnel mutation rate limit', () => {
  afterEach(() => {
    resetTunnelMutationLimitsForTests();
  });

  it('limits per gateway token independently', () => {
    const a = consumeTunnelMutationLimit('token-a');
    const b = consumeTunnelMutationLimit('token-b');
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
  });

  it('blocks after max requests in window', () => {
    const token = 'same-token';
    for (let i = 0; i < 12; i++) {
      expect(consumeTunnelMutationLimit(token).allowed).toBe(true);
    }
    const blocked = consumeTunnelMutationLimit(token);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });
});
