import { describe, expect, it } from 'vitest';
import { resolveAgentModelFallbackValues, resolveAgentModelPrimaryValue } from '../model-input.js';

describe('model-input', () => {
  it('resolves primary from string', () => {
    expect(resolveAgentModelPrimaryValue('openai/gpt-4o-mini')).toBe('openai/gpt-4o-mini');
  });

  it('resolves primary from object', () => {
    expect(
      resolveAgentModelPrimaryValue({ primary: 'anthropic/claude-sonnet-4-5', fallbacks: ['openai/gpt-4o-mini'] }),
    ).toBe('anthropic/claude-sonnet-4-5');
  });

  it('returns fallbacks', () => {
    expect(resolveAgentModelFallbackValues({ primary: 'a/b', fallbacks: ['c/d', 'e/f'] })).toEqual(['c/d', 'e/f']);
  });
});
