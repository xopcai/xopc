import { getModel as getPiModel } from '@earendil-works/pi-ai/compat';
import { describe, expect, it } from 'vitest';

import { validateModelsConfig } from '../../config/models-json.js';
import { getAllModels, getAllProviders, isProviderConfigured, isProviderConfiguredSync, providerSupportsOAuth, resolveModel } from '../index.js';

describe('resolveModel', () => {
  it('throws a setup-oriented error for an empty model ref', () => {
    expect(() => resolveModel('')).toThrow('No default model configured. Choose a model in onboarding');
    expect(() => resolveModel('   ')).toThrow('No default model configured. Choose a model in onboarding');
  });

  it('uses current upstream names and metadata without local aliases', () => {
    for (const id of ['gpt-6-sol', 'gpt-6-luna', 'gpt-6-astra']) {
      const expected = getPiModel('openai', id as never);
      expect(resolveModel(`openai/${id}`)).toMatchObject(expected);
      expect(getAllModels().find(model => model.provider === 'openai' && model.id === id)).toMatchObject(expected);
    }
    expect(() => resolveModel('openai/gpt-5.6')).toThrow('Model not found');
  });

  it('rejects retired providers instead of resolving or displaying them', async () => {
    expect(getAllProviders()).not.toContain('openai-codex');
    expect(getAllProviders()).not.toContain('azure-openai-responses');
    expect(getAllProviders()).toContain('azure');
    expect(providerSupportsOAuth('openai')).toBe(true);
    expect(() => resolveModel('openai-codex/gpt-6-sol')).toThrow('sign in with ChatGPT again');
    expect(() => resolveModel('azure-openai-responses/gpt-5')).toThrow('Update the provider ID');
    for (const provider of ['openai-codex', 'azure-openai-responses']) {
      expect(() => isProviderConfiguredSync(provider)).toThrow();
      await expect(isProviderConfigured(provider)).rejects.toThrow();
      const result = validateModelsConfig({ providers: { [provider]: { baseUrl: 'https://example.com/v1' } } });
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.objectContaining({ path: `providers.${provider}`, severity: 'error' }));
    }
    expect(validateModelsConfig({ providers: { azure: { baseUrl: 'https://example.com/v1', api: 'azure-openai-responses' } } }).valid).toBe(true);
  });

  it('keeps the native Computer Use contract for explicit supported models', () => {
    expect(resolveModel('openai/gpt-6-astra')).toMatchObject({
      api: 'openai-responses', computerUse: { profile: 'openai-responses-computer-v1' },
    });
  });
});
