import { afterEach, describe, expect, it, vi } from 'vitest';

const resolveApiKey = vi.fn(async () => 'oauth-access');

vi.mock('../../../../providers/provider-auth-service.js', () => ({
  getProviderAuthService: () => ({ resolveApiKey }),
}));

import { getModelCatalogStore, resetModelCatalogStore } from '../../../../providers/model-catalog-store.js';
import { buildXopcCloudImageGenerationProvider } from '../providers/xopc-cloud.js';

describe('XOPC Cloud image generation provider', () => {
  afterEach(() => {
    resetModelCatalogStore();
    vi.unstubAllGlobals();
    resolveApiKey.mockClear();
  });

  it('builds a dynamic OpenAI Images provider and resolves OAuth at request time', async () => {
    getModelCatalogStore().replaceSourceModels('xopc-cloud', {
      providerId: 'xopc-cloud',
      baseUrl: 'https://example.com/v1',
      api: 'openai-completions',
      etag: 'catalog-1',
      recommendedModel: null,
      lastSuccessAt: Date.now(),
    }, [{
      id: 'image-model',
      name: 'Image Model',
      kind: 'image',
      input: ['text'],
      output: ['image'],
      operations: ['images.generate'],
      reasoning: false,
      contextWindow: 128_000,
      maxOutputTokens: null,
      imageGeneration: {
        maxCount: 2,
        sizes: ['1024x1024'],
        aspectRatios: [],
        qualities: ['high'],
        formats: ['png'],
        backgrounds: [],
        maxInputImages: 0,
      },
    }]);
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://example.com/v1/images/generations');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer oauth-access');
      return Response.json({ data: [{ b64_json: 'aW1hZ2U=' }] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = buildXopcCloudImageGenerationProvider();
    expect(provider).toMatchObject({
      id: 'xopc-cloud',
      credentialMode: 'oauth',
      models: ['image-model'],
      capabilities: {
        generate: { maxCount: 2, supportsSize: true },
        geometry: { sizes: ['1024x1024'] },
      },
    });
    const result = await provider!.generateImage({
      provider: 'xopc-cloud', model: 'image-model', prompt: 'draw', count: 1,
    });
    expect(result.images).toHaveLength(1);
    expect(resolveApiKey).toHaveBeenCalledWith('xopc-cloud', undefined);
  });
});
