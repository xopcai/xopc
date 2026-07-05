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
  getAllProviders: () => ['vision-on', 'vision-off', 'text-only'],
  getModelsByProvider: (provider: string) => {
    if (provider === 'text-only') {
      return [{ id: 'text-model', name: 'Text Model', input: ['text'] }];
    }
    return [{ id: 'vision-model', name: 'Vision Model', input: ['text', 'image'] }];
  },
  isProviderConfigured: (provider: string) => mocks.configuredTextProviders.has(provider),
}));

import {
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
});
