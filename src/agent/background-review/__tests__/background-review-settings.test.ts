import { describe, expect, it } from 'vitest';

import { resolveBackgroundReviewSettings } from '../settings.js';

describe('resolveBackgroundReviewSettings', () => {
  it('defaults to disabled with Hermes-like intervals', () => {
    expect(resolveBackgroundReviewSettings(undefined).enabled).toBe(false);
    const on = resolveBackgroundReviewSettings({} as any);
    expect(on.enabled).toBe(false);
    expect(on.memoryNudgeInterval).toBe(10);
    expect(on.skillNudgeInterval).toBe(10);
    expect(on.maxToolRounds).toBe(8);
  });
});
