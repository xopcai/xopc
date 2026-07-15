import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  imageProviders: [
    { id: 'image-on', models: ['img-model'] },
    { id: 'image-off', models: ['img-model'] },
  ],
  configuredImageProviders: new Set(['image-on']),
  configuredTextProviders: new Set(['vision-on']),
}));

vi.mock('../../agent/image/generation/runtime.js', () => ({
  listImageGenerationProvidersSummary: () => mocks.imageProviders,
  getImageGenerationProvider: (id: string) => ({
    id,
    isConfigured: () => mocks.configuredImageProviders.has(id),
  }),
}));

vi.mock('../../providers/index.js', () => ({
  getDefaultModelSync: () => '',
  getAllProviders: () => ['vision-on', 'vision-off', 'text-only'],
  getModelsByProvider: (provider: string) => {
    if (provider === 'text-only') {
      return [{ id: 'text-model', name: 'Text Model', input: ['text'] }];
    }
    return [{ id: 'vision-model', name: 'Vision Model', input: ['text', 'image'] }];
  },
  isProviderConfiguredSync: (provider: string) => mocks.configuredTextProviders.has(provider),
  isProviderConfigured: (provider: string) => mocks.configuredTextProviders.has(provider),
  resolveModel: (ref: string) => {
    const [provider, id] = ref.split('/');
    if (!provider || !id) throw new Error(`Model not found: ${ref}`);
    const model = provider === 'text-only'
      ? { provider, id, name: 'Text Model', input: ['text'] }
      : { provider, id, name: 'Vision Model', input: ['text', 'image'] };
    return model;
  },
}));

import {
  resolveCurrentImageModelCapabilities,
  resolveImageGenerationCapabilities,
  resolveImageUnderstandingCapabilities,
} from '../image-capabilities.js';

describe('image capabilities', () => {
  it('only returns configured image generation providers', async () => {
    const providers = await resolveImageGenerationCapabilities({} as any);

    expect(providers.map((provider) => provider.provider)).toEqual(['image-on']);
    expect(providers[0]?.models.map((model) => model.ref)).toEqual(['image-on/img-model']);
  });

  it('only returns configured image understanding providers with image input models', async () => {
    const providers = await resolveImageUnderstandingCapabilities({} as any);

    expect(providers.map((provider) => provider.provider)).toEqual(['vision-on']);
    expect(providers[0]?.models.map((model) => model.ref)).toEqual(['vision-on/vision-model']);
  });

  it('reports the effective runtime image understanding model source', () => {
    const config = {
      agents: {
        default: 'main',
        defaultPreset: 'default',
        capabilityPresets: {
          default: {
            id: 'default',
            name: 'Global defaults',
            version: 1,
            models: {
              defaultRole: 'deep',
              roles: {
                deep: { model: 'text-only/text-model' },
                vision: {
                  model: 'vision-on/vision-model',
                  description: 'Vision work',
                },
              },
            },
          },
        },
        list: [
          {
            id: 'main',
            enabled: true,
            identity: { name: 'Main', role: 'assistant' },
            responsibilities: { primary: ['Assist'] },
            workspace: { root: '/tmp' },
            tools: { builtin: {} },
            skills: { mode: 'all' },
            memory: { mode: 'off', sources: ['session'] },
            workflows: {},
            boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
          },
        ],
      },
    };

    const current = resolveCurrentImageModelCapabilities(config as any);

    expect(current.imageModel).toBeNull();
    expect(current.imageModelFallbacks).toEqual([]);
    expect(current.effectiveImageModel).toBe('vision-on/vision-model');
    expect(current.effectiveImageModelFallbacks).toEqual([]);
    expect(current.imageModelSource).toBe('auto-role');
    expect(current.imageModelRoleId).toBe('vision');
    expect(current.imageModelRoleDescription).toBe('Vision work');
  });
});
