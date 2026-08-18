import { describe, expect, it } from 'vitest';

import { buildInteractionStatePrompt, inferInteractionState } from '../interaction-state.js';

describe('interaction state', () => {
  it('keeps execution primary while acknowledging emotional pressure', () => {
    const signal = inferInteractionState('我真的很焦虑，帮我把发布问题修好');

    expect(signal).toMatchObject({
      supportNeed: 'act',
      emotionHypothesis: '焦虑',
      source: 'explicit',
    });
    const prompt = buildInteractionStatePrompt(signal);
    expect(prompt).toContain('continue doing the work');
    expect(prompt).toContain('Care must support progress');
  });

  it('treats explicit relationship mismatch as a repair request', () => {
    const signal = inferInteractionState('你根本没理解我，别再说教了');

    expect(signal).toMatchObject({
      supportNeed: 'listen',
      repairStatus: 'needed',
      source: 'explicit',
    });
    expect(buildInteractionStatePrompt(signal)).toContain('do not defend yourself');
  });
});
