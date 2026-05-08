import { describe, expect, it } from 'vitest';

import { formatCapabilityModelRef, parseCapabilityModelRef } from '../model-ref.js';

describe('parseCapabilityModelRef', () => {
  it('parses standard provider/model', () => {
    expect(parseCapabilityModelRef('openai/gpt-image-1')).toEqual({ provider: 'openai', model: 'gpt-image-1' });
  });

  it('lower-cases provider but preserves model casing', () => {
    expect(parseCapabilityModelRef('OpenAI/GPT-Image-1')).toEqual({ provider: 'openai', model: 'GPT-Image-1' });
  });

  it('trims surrounding whitespace', () => {
    expect(parseCapabilityModelRef('  dashscope/wan2.6-t2i  ')).toEqual({
      provider: 'dashscope',
      model: 'wan2.6-t2i',
    });
  });

  it('preserves slashes after the first one (e.g. nested model names)', () => {
    expect(parseCapabilityModelRef('vendor/family/model')).toEqual({ provider: 'vendor', model: 'family/model' });
  });

  it('returns null for empty / malformed input', () => {
    expect(parseCapabilityModelRef(undefined)).toBeNull();
    expect(parseCapabilityModelRef(null)).toBeNull();
    expect(parseCapabilityModelRef('')).toBeNull();
    expect(parseCapabilityModelRef('   ')).toBeNull();
    expect(parseCapabilityModelRef('no-slash')).toBeNull();
    expect(parseCapabilityModelRef('/missing-provider')).toBeNull();
    expect(parseCapabilityModelRef('missing-model/')).toBeNull();
  });
});

describe('formatCapabilityModelRef', () => {
  it('joins provider and model with a slash', () => {
    expect(formatCapabilityModelRef('openai', 'gpt-image-1')).toBe('openai/gpt-image-1');
  });

  it('lower-cases provider', () => {
    expect(formatCapabilityModelRef('OpenAI', 'X')).toBe('openai/X');
  });

  it('returns null for empty halves', () => {
    expect(formatCapabilityModelRef('', 'x')).toBeNull();
    expect(formatCapabilityModelRef('p', '')).toBeNull();
  });
});
