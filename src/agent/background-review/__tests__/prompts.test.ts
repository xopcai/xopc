import { describe, expect, it } from 'vitest';

import { buildUserModelInterpreterPrompt } from '../prompts.js';

describe('background user-model prompt', () => {
  it('requires grounded maintenance operations and prefers merging existing understanding', () => {
    const prompt = buildUserModelInterpreterPrompt({
      mode: 'transcript',
      evidenceTimestamp: '2026-09-07T00:00:00.000Z',
      timezone: 'Asia/Shanghai',
      availableAssertions: [{
        id: 'assertion-1',
        predicate: 'identity.personality.mbti',
        normalizedValue: 'infp',
        statement: 'Identifies as INFP in MBTI.',
        authority: 'user_explicit',
        status: 'active',
        subject: { type: 'user', id: 'self' },
        scope: { type: 'global' },
      }],
    });
    expect(prompt).toContain('The value is excluded from predicate identity');
    expect(prompt).toContain('Every assertion operation needs an exact quote');
    expect(prompt).toContain('Resolve relative time');
    expect(prompt).toContain('Use merge whenever');
    expect(prompt).toContain('identity.personality.mbti');
    expect(prompt).not.toContain('candidates=[]');
  });
});
