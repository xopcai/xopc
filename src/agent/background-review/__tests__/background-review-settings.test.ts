import { describe, expect, it } from 'vitest';

import { resolveBackgroundReviewSettings } from '../settings.js';

describe('resolveBackgroundReviewSettings', () => {
  it('defaults to disabled with Hermes-like intervals when enabled', () => {
    expect(resolveBackgroundReviewSettings(undefined).enabled).toBe(false);
    const on = resolveBackgroundReviewSettings({
      agents: {
        defaults: {
          workspace: '~/.xopc/workspace',
          model: 'x/y',
          maxTokens: 1000,
          temperature: 0.7,
          maxToolIterations: 20,
          maxRequestsPerTurn: 50,
          maxToolFailuresPerTurn: 3,
          backgroundReview: { enabled: true },
        },
      },
    } as any);
    expect(on.enabled).toBe(true);
    expect(on.memoryNudgeInterval).toBe(10);
    expect(on.skillNudgeInterval).toBe(10);
    expect(on.maxToolRounds).toBe(8);
  });
});
