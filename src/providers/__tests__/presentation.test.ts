import { describe, expect, it } from 'vitest';

import { getAllProviders, getModelsByProvider } from '../index.js';
import { getRecommendedModelsForProvider } from '../presentation.js';

describe('provider presentation catalog', () => {
  it('does not expose tunnel authorization as a model provider', () => {
    expect(getAllProviders()).not.toContain('xopc-tunnel');
  });

  it('only recommends models that exist in the provider catalog', () => {
    for (const provider of getAllProviders()) {
      const ids = new Set(getModelsByProvider(provider).map((model) => model.id));
      for (const model of getRecommendedModelsForProvider(provider, 20)) {
        expect(ids.has(model.id), `${provider}/${model.id}`).toBe(true);
      }
    }
  });
});
