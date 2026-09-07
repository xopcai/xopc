import { describe, expect, it } from 'vitest';

import { buildUserModelInterpreterPrompt } from '../prompts.js';

describe('background user-model prompt', () => {
  it('requires grounded, temporal, slot-based assertions', () => {
    const prompt = buildUserModelInterpreterPrompt({
      mode: 'transcript',
      evidenceTimestamp: '2026-09-07T00:00:00.000Z',
      timezone: 'Asia/Shanghai',
    });
    expect(prompt).toContain('The value is excluded from predicate identity');
    expect(prompt).toContain('Every candidate needs an exact quote');
    expect(prompt).toContain('Resolve relative time');
  });
});
