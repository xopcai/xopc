import { describe, expect, it } from 'vitest';

import { focusLifecycle } from '../focus-lifecycle.js';

describe('focus lifecycle', () => {
  it('gives shorter-lived work a tighter review and validity window', () => {
    const now = Date.parse('2026-08-30T00:00:00.000Z');
    const current = focusLifecycle('current', now);
    const ongoing = focusLifecycle('ongoing', now);
    const longTerm = focusLifecycle('long_term', now);

    expect(current.validFrom).toBe(now);
    expect(current.reviewAt).toBeLessThan(ongoing.reviewAt!);
    expect(ongoing.reviewAt).toBeLessThan(longTerm.reviewAt!);
    expect(current.validTo).toBeLessThan(ongoing.validTo!);
    expect(ongoing.validTo).toBeLessThan(longTerm.validTo!);
  });
});
