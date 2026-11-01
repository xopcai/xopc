import { describe, expect, it } from 'vitest';

import { getAllProviders, getModelsByProvider, PROVIDER_META } from '../index.js';
import { getOnboardingFeaturedProviders, getRecommendedModelsForProvider, modelToCatalogView, sortModelsForPicker } from '../presentation.js';
import { getDomesticProviderPreset } from '../domestic-presets.js';

describe('provider presentation catalog', () => {
  it('preserves recommendation order and limits when filtering before sorting', () => {
    for (const provider of getAllProviders()) {
      const previousOrder = sortModelsForPicker(getModelsByProvider(provider)).map(modelToCatalogView).filter(model => model.recommended);
      if (!previousOrder.length) continue;
      for (const limit of [1, 4, 20]) expect(getRecommendedModelsForProvider(provider, limit)).toEqual(previousOrder.slice(0, limit));
    }
  });
  it.each(['xiaomi', 'xiaomi-token-plan-cn', 'xiaomi-token-plan-ams', 'xiaomi-token-plan-sgp'])('keeps %s presets and recommendations in the current catalog', provider => {
    const ids = new Set(getModelsByProvider(provider).map(model => model.id));
    const preset = getDomesticProviderPreset(provider)!;
    expect(ids.has(preset.defaultModel)).toBe(true);
    for (const model of preset.models) expect(ids.has(model.id), `${provider}/${model.id}`).toBe(true);
    const recommendations = getRecommendedModelsForProvider(provider);
    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations[0]).toMatchObject({ id: 'mimo-v2.6-pro', vision: true });
  });

  it('exposes the pi China subscription provider and recommends its vision models', () => {
    const provider = 'qwen-token-plan-cn';
    expect(getAllProviders()).toContain(provider);
    expect(PROVIDER_META[provider]).toMatchObject({ category: 'domestic', supportsApiKey: true });
    expect(getOnboardingFeaturedProviders()).toContain(provider);
    const recommendations = getRecommendedModelsForProvider(provider);
    expect(recommendations[0]).toMatchObject({ id: 'qwen3.8-flash', vision: true });
    expect(recommendations.some(model => model.id === 'qwen3.8-max')).toBe(true);
  });

  it('does not recommend a GUI actor even when its public alias matches a chat recommendation', () => {
    expect(modelToCatalogView({ provider: 'openai', id: 'gpt-5', name: 'GUI alias', api: 'openai-completions',
      input: ['text', 'image'], computerUse: { profile: 'structured-tools-v1' } } as never).recommended).toBe(false);
  });
  it('does not expose tunnel authorization as a model provider', () => {
    expect(getAllProviders()).not.toContain('xopc-tunnel');
  });

  it('only recommends models from the provider catalog or its onboarding preset', () => {
    for (const provider of getAllProviders()) {
      const ids = new Set([
        ...getModelsByProvider(provider).map((model) => model.id),
        ...(getDomesticProviderPreset(provider)?.models.map((model) => model.id) ?? []),
      ]);
      for (const model of getRecommendedModelsForProvider(provider, 20)) {
        expect(ids.has(model.id), `${provider}/${model.id}`).toBe(true);
      }
    }
    expect(getRecommendedModelsForProvider('volcengine-ark').map(model => model.id)).not.toContain('ep-your-endpoint-id');
  });
});
