import type { Api, Model } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import { chooseModelThinking } from '@xopcai/gateway-contract';

import { getModelThinking } from '../model-thinking.js';

const model = (overrides: Partial<Model<Api>> = {}) => ({
  provider: 'test', id: 'reasoner', api: 'openai-responses', reasoning: true, ...overrides,
}) as Model<Api>;

describe('model thinking capabilities', () => {
  it('uses model metadata to exclude unavailable levels and include max', () => {
    const result = getModelThinking(model({ thinkingLevelMap: { off: null, minimal: null, xhigh: null, max: 'max' } }));
    expect(result.options).toEqual(['low', 'medium', 'high', 'max']);
    expect(result.supportsAdaptive).toBe(false);
    expect(chooseModelThinking(result, 'xhigh')).toBe('medium');
    expect(chooseModelThinking(result, 'high', 'low')).toBe('low');
  });

  it('offers an explicit binary control for binary provider adapters', () => {
    expect(getModelThinking(model({ compat: { thinkingFormat: 'zai', supportsReasoningEffort: false } })))
      .toMatchObject({ mode: 'toggle', options: ['off', 'high'] });
  });

  it('does not expose invented effort levels on unsupported models', () => {
    expect(getModelThinking(model({ reasoning: false }))).toMatchObject({ mode: 'none', options: ['off'] });
    expect(getModelThinking(model({ compat: { supportsReasoningEffort: false } }))).toMatchObject({ mode: 'unknown' });
  });
});
