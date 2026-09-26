import { describe, expect, it } from 'vitest';

import { continuesAfterTool } from '../recorder.js';

describe('AI usage recorder', () => {
  it('classifies only the immediately preceding request context as a tool continuation', () => {
    expect(continuesAfterTool([{ role: 'user' }, { role: 'assistant' }, { role: 'toolResult' }])).toBe(true);
    expect(continuesAfterTool([
      { role: 'user' }, { role: 'assistant' }, { role: 'toolResult' }, { role: 'assistant' }, { role: 'user' },
    ])).toBe(false);
  });
});
