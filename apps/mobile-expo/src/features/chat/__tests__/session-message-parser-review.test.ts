import { describe, expect, it } from 'vitest';

import { parseSessionMessages } from '../session-message-parser';

const review = {
  type: 'review',
  target: 'working tree changes',
  summary: 'No findings.',
  findings: [],
  overallCorrectness: 'patch is correct',
  overallExplanation: 'No correctness issues found.',
};

describe('parseSessionMessages review blocks', () => {
  it('preserves review content blocks', () => {
    const ui = parseSessionMessages([
      { role: 'assistant', content: [review], timestamp: 1 },
    ]);
    expect(ui[0]?.content[0]).toMatchObject({ type: 'review', overallCorrectness: 'patch is correct' });
  });

  it('restores review from assistant metadata', () => {
    const ui = parseSessionMessages([
      { role: 'assistant', content: [], metadata: { review }, timestamp: 1 },
    ]);
    expect(ui[0]?.content[0]).toMatchObject({ type: 'review', summary: 'No findings.' });
  });
});
