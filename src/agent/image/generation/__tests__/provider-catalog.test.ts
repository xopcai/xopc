import { describe, expect, it } from 'vitest';

import {
  getImageGenerationProvider,
  listImageGenerationProviders,
  listImageGenerationProvidersSummary,
} from '../provider-registry.js';

describe('built-in image generation provider catalog', () => {
  it('contains the built-in providers in a stable order', () => {
    expect(listImageGenerationProviders().map((provider) => provider.id)).toEqual([
      'openai',
      'dashscope',
      'minimax',
      'google',
      'fal',
    ]);
  });

  it('resolves exact provider ids only', () => {
    expect(getImageGenerationProvider('google')?.id).toBe('google');
    expect(getImageGenerationProvider('gemini')).toBeUndefined();
    expect(getImageGenerationProvider('GOOGLE')).toBeUndefined();
  });

  it('returns detached model arrays in summaries', () => {
    const first = listImageGenerationProvidersSummary();
    first[0]!.models.push('mutated');
    expect(listImageGenerationProvidersSummary()[0]!.models).not.toContain('mutated');
  });
});
