import { describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import {
  getAgentImageGenerationConfig,
  prepareImageGenerationSetup,
  verifyImageGenerationCredential,
} from '../image-generation-setup.js';

function createConfig() {
  return ConfigSchema.parse({
    agents: {
      default: 'main',
      list: [
        {
          id: 'main',
          enabled: true,
          identity: { name: 'Main', role: 'Agent' },
          responsibilities: { primary: ['Help'] },
          workspace: { root: '/tmp/main' },
          models: {
            defaultRole: 'default',
            roles: { default: { model: 'openai/gpt-5' } },
          },
          tools: { builtin: {} },
          skills: { mode: 'all' },
          workflows: {},
          boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
        },
        {
          id: 'studio',
          enabled: true,
          identity: { name: 'Studio', role: 'Agent' },
          responsibilities: { primary: ['Create'] },
          workspace: { root: '/tmp/studio' },
          models: {
            defaultRole: 'default',
            roles: { default: { model: 'google/gemini-3.1-pro' } },
          },
          tools: { builtin: {} },
          skills: { mode: 'all' },
          workflows: {},
          boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
        },
      ],
    },
  });
}

describe('image generation setup', () => {
  it('configures only the requested agent and stores no credential', () => {
    const config = createConfig();
    const result = prepareImageGenerationSetup(config, 'studio', {
      providerId: 'google',
      modelId: 'gemini-3.1-flash-image',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getAgentImageGenerationConfig(result.config, 'studio').model?.primary).toBe(
      'google/gemini-3.1-flash-image',
    );
    expect(getAgentImageGenerationConfig(result.config, 'main').model).toBeNull();
    expect(result.config.providers?.google).toEqual({});
    expect(JSON.stringify(result.config)).not.toContain('apiKey');
  });

  it('requires an explicit region for regional providers', () => {
    const result = prepareImageGenerationSetup(createConfig(), 'main', {
      providerId: 'dashscope',
    });
    expect(result).toEqual({ ok: false, error: 'dashscope requires region "cn" or "intl"' });
  });

  it('preserves provider connection settings when selecting an image model', () => {
    const config = createConfig();
    config.providers = {
      openai: {
        baseUrl: 'https://old.example.com/v1',
        request: { timeoutMs: 30_000, headers: { 'X-Trace': 'enabled' } },
        azure: { resource: 'images', deployment: 'gpt-image', apiVersion: '2025-04-01-preview' },
      },
    };

    const result = prepareImageGenerationSetup(config, 'main', {
      providerId: 'openai',
      baseUrl: 'https://new.example.com/v1',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.providers?.openai).toEqual({
      baseUrl: 'https://new.example.com/v1',
      request: { timeoutMs: 30_000, headers: { 'X-Trace': 'enabled' } },
      azure: { resource: 'images', deployment: 'gpt-image', apiVersion: '2025-04-01-preview' },
    });
  });

  it('updates only the local image model override without materializing preset models', () => {
    const config = createConfig();
    config.agents.capabilityPresets.image = {
      id: 'image',
      name: 'Image defaults',
      models: {
        defaultRole: 'inherited',
        roles: { inherited: { model: 'openai/gpt-5-mini' } },
      },
    };
    config.agents.list[1]!.extends = ['image'];

    const result = prepareImageGenerationSetup(config, 'studio', { providerId: 'google' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.agents.list[1]!.models).toEqual({
      defaultRole: 'default',
      roles: { default: { model: 'google/gemini-3.1-pro' } },
      imageGenerationModel: { primary: 'google/gemini-3.1-flash-image' },
    });
  });

  it('blocks private-network credential verification URLs before fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await verifyImageGenerationCredential({
      providerId: 'openai',
      apiKey: 'secret',
      baseUrl: 'http://127.0.0.1:8080/v1',
    });

    expect(result).toMatchObject({ verified: false, supported: true });
    expect(result.message).toMatch(/blocked|private|loopback/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('strictly rejects removed legacy provider fields and region names', () => {
    const config = createConfig();
    expect(ConfigSchema.safeParse({ ...config, providers: { openai: { apiKey: 'legacy' } } }).success).toBe(false);
    expect(ConfigSchema.safeParse({ ...config, providers: { openai: { imageBaseUrl: 'https://example.com' } } }).success).toBe(false);
    expect(ConfigSchema.safeParse({ ...config, providers: { dashscope: { region: 'beijing' } } }).success).toBe(false);
  });

  it('rejects unknown agents, providers, and models instead of falling back', () => {
    const config = createConfig();
    expect(() => getAgentImageGenerationConfig(config, 'missing')).toThrow('Agent not found: missing');
    expect(prepareImageGenerationSetup(config, 'missing', { providerId: 'openai' })).toEqual({
      ok: false,
      error: 'Agent not found: missing',
    });
    expect(prepareImageGenerationSetup(config, 'main', { providerId: 'gemini' })).toEqual({
      ok: false,
      error: 'Unknown image provider: gemini',
    });
    expect(prepareImageGenerationSetup(config, 'main', {
      providerId: 'openai',
      modelId: 'missing-model',
    })).toEqual({
      ok: false,
      error: 'Unknown openai image model: missing-model',
    });
  });
});
