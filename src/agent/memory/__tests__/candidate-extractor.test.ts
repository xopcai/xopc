import { describe, expect, it } from 'vitest';

import { proposeMemoryCandidatesFromTurn } from '../candidate-extractor.js';

describe('memory candidate extractor', () => {
  it('extracts explicit remember requests as candidate writes', () => {
    const candidates = proposeMemoryCandidatesFromTurn({
      userContent: 'Please remember that I prefer pnpm over npm for this repo.',
      sessionKey: 'session-1',
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      kind: 'user_profile',
      target: 'user',
      status: 'candidate',
      sensitivity: 'personal',
    });
    expect(candidates[0]?.content).toBe('I prefer pnpm over npm for this repo.');
    expect(candidates[0]?.evidence?.[0]?.sessionKey).toBe('session-1');
  });

  it('ignores ordinary turns without explicit memory intent', () => {
    const candidates = proposeMemoryCandidatesFromTurn({
      userContent: 'Can you explain the current gateway routes?',
      assistantContent: 'The gateway routes are registered in Hono.',
    });

    expect(candidates).toHaveLength(0);
  });
});
