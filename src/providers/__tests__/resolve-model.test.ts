import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getModel as getPiModel } from '@earendil-works/pi-ai/compat';
import { describe, expect, it } from 'vitest';

import { computerModelProfile } from '../../computer/model-policy.js';
import { validateModelsConfig } from '../../config/models-json.js';
import { getAllModels, getAllProviders, isProviderConfigured, isProviderConfiguredSync, providerSupportsApiKey, providerSupportsOAuth, resolveModel } from '../index.js';
import { ModelRegistry } from '../model-registry.js';

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

  it('infers visual function tools without a GPT model allowlist', () => {
    for (const id of ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna']) {
      const model = resolveModel(`openai/${id}`);
      expect(computerModelProfile(model)).toBe('structured-tools-v1');
    }
  });

  it('ignores Antigravity in installed model configs and still loads other providers', async () => {
    const provider = 'google-antigravity';
    const config = {
      providers: {
        [provider]: { baseUrl: 'https://example.com/old', api: 'openai-completions', models: [{ id: 'old' }] },
        'custom-models': { baseUrl: 'https://example.com/v1', api: 'openai-completions', models: [{ id: 'custom' }] },
      },
    };
    expect(validateModelsConfig(config)).toMatchObject({
      valid: true,
      errors: [expect.objectContaining({ path: `providers.${provider}`, severity: 'warning' })],
    });
    expect(getAllProviders()).not.toContain(provider);
    expect(providerSupportsOAuth(provider)).toBe(false);
    expect(providerSupportsApiKey(provider)).toBe(false);
    expect(() => resolveModel(`${provider}/old`)).toThrow('Antigravity OAuth has been removed');

    const dir = await mkdtemp(join(tmpdir(), 'xopc-retired-provider-'));
    try {
      const file = join(dir, 'models.json');
      await writeFile(file, JSON.stringify(config));
      const registry = new ModelRegistry(file);
      expect(registry.resolve('custom-models/custom')).toMatchObject({ id: 'custom' });
      expect(registry.getAll().some((model) => model.provider === provider)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
