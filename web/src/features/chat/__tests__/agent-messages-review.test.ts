import { describe, expect, it } from 'vitest';

import { normalizeAgentMessages } from '@/features/chat/messages/agent-messages';

const review = {
  type: 'review',
  target: 'working tree changes',
  summary: 'No findings.',
  findings: [],
  overallCorrectness: 'patch is correct',
  overallExplanation: 'No correctness issues found.',
};

describe('normalizeAgentMessages review blocks', () => {
  it('preserves review content blocks', () => {
    const ui = normalizeAgentMessages([
      { role: 'assistant', content: [review], timestamp: 1 },
    ]);
    expect(ui[0]?.content[0]).toMatchObject({ type: 'review', overallCorrectness: 'patch is correct' });
  });

  it('restores review from assistant metadata', () => {
    const ui = normalizeAgentMessages([
      { role: 'assistant', content: [], metadata: { review }, timestamp: 1 },
    ]);
    expect(ui[0]?.content[0]).toMatchObject({ type: 'review', summary: 'No findings.' });
  });

  it('restores review from persisted rawContent history rows', () => {
    const ui = normalizeAgentMessages([
      { role: 'assistant', content: '', rawContent: [review], timestamp: 1 },
    ]);
    expect(ui[0]?.content[0]).toMatchObject({ type: 'review', summary: 'No findings.' });
  });
});
