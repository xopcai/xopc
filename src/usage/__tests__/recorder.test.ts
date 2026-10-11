import { describe, expect, it } from 'vitest';

import { continuesAfterTool } from '../recorder.js';
import { classifyCostSource } from '../cost.js';

describe('AI usage recorder', () => {
  it('does not reinterpret Cloud Credit prices as provider dollar estimates', () => {
    expect(classifyCostSource({ provider: 'xopc-cloud', id: 'cloud', baseUrl: 'https://router.xopc.ai/v1', cost: { input: 1, output: 4, cacheRead: 0, cacheWrite: 0 } })).toBe('unknown');
    expect(classifyCostSource({ provider: 'openai', id: 'byok', baseUrl: 'https://api.openai.com/v1', cost: { input: 1, output: 4, cacheRead: 0, cacheWrite: 0 } })).toBe('model_catalog');
  });
  it('classifies only the immediately preceding request context as a tool continuation', () => {
    expect(continuesAfterTool([{ role: 'user' }, { role: 'assistant' }, { role: 'toolResult' }])).toBe(true);
    expect(continuesAfterTool([
      { role: 'user' }, { role: 'assistant' }, { role: 'toolResult' }, { role: 'assistant' }, { role: 'user' },
    ])).toBe(false);
  });
});
