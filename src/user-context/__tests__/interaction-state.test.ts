import { describe, expect, it } from 'vitest';

import { buildInteractionStatePrompt, inferInteractionState } from '../interaction-state.js';

describe('interaction state inference', () => {
  it('honors explicit requests to listen over inferred action', () => {
    expect(inferInteractionState('我不想听建议，只想聊一会儿')).toMatchObject({
      supportNeed: 'listen',
      source: 'explicit',
      confidence: 0.95,
    });
  });

  it('frames emotion as a low-confidence hypothesis', () => {
    const signal = inferInteractionState('我最近很焦虑');
    expect(signal).toMatchObject({ supportNeed: 'listen', source: 'inferred', confidence: 0.55 });
    expect(buildInteractionStatePrompt(signal)).toContain('Treat this only as a hypothesis');
  });
});
