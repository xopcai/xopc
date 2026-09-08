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

  it('offers an explicit binary control for adapters with an on/off request shape', () => {
    expect(getModelThinking(model({ compat: { thinkingFormat: 'zai', supportsReasoningEffort: false } })))
      .toMatchObject({ mode: 'toggle', options: ['off', 'high'] });
    expect(getModelThinking(model({ compat: { thinkingFormat: 'deepseek', supportsReasoningEffort: false } })))
      .toMatchObject({ mode: 'toggle', options: ['off', 'high'] });
    expect(getModelThinking(model({ compat: { thinkingFormat: 'together', supportsReasoningEffort: false } })))
      .toMatchObject({ mode: 'toggle', options: ['off', 'high'] });
  });

  it('distinguishes unsupported models from non-configurable always-on reasoning', () => {
    expect(getModelThinking(model({ reasoning: false }))).toMatchObject({ mode: 'none', options: ['off'] });
    expect(getModelThinking(model({ compat: { supportsReasoningEffort: false } })))
      .toMatchObject({ mode: 'fixed', options: ['high'], initialValue: 'high' });
    expect(getModelThinking(model({
      thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: null, xhigh: null, max: 'max' },
    }))).toMatchObject({ mode: 'fixed', options: ['max'], initialValue: 'max' });
  });

  it('does not offer off when a toggle-shaped adapter marks it unsupported', () => {
    expect(getModelThinking(model({
      compat: { thinkingFormat: 'deepseek', supportsReasoningEffort: false },
      thinkingLevelMap: { off: null },
    }))).toMatchObject({ mode: 'fixed', options: ['high'], initialValue: 'high' });
  });
});
