import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelsJsonConfig } from '../../../../config/models-json.js';
import * as providerHttp from '../../../../media-shared/http/index.js';
import {
  getModelCatalogStore,
  resetModelCatalogStore,
} from '../../../../providers/model-catalog-store.js';

import {
  getImageGenerationProvider,
  listImageGenerationProviders,
  listImageGenerationProvidersSummary,
  reloadImageGenerationProviders,
} from '../provider-registry.js';

describe('built-in image generation provider catalog', () => {
  beforeEach(() => {
    resetModelCatalogStore();
    reloadImageGenerationProviders({ providers: {} });
  });
  afterEach(() => {
    resetModelCatalogStore();
    vi.restoreAllMocks();
  });

  it('contains the always-available built-in providers in a stable order', () => {
    expect(listImageGenerationProviders().map((provider) => provider.id)).toEqual([
      'openai',
      'dashscope',
      'minimax',
      'google',
      'fal',
    ]);
  });

  it('prepends XOPC Cloud when the runtime catalog contains an image model', () => {
    getModelCatalogStore().replaceSourceModels('xopc-cloud', {
      providerId: 'xopc-cloud',
      baseUrl: 'https://router.test/v1',
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
    }]);

    reloadImageGenerationProviders({ providers: {} });

    expect(listImageGenerationProviders().map((provider) => provider.id)).toEqual([
      'xopc-cloud',
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

  it('registers explicitly configured custom OpenAI Images providers', () => {
    const config: ModelsJsonConfig = {
      providers: {
        'local-flux': {
          baseUrl: 'http://127.0.0.1:8080/v1',
          imageGeneration: {
            api: 'openai-images',
            name: 'Local Flux',
            defaultModel: 'flux-dev',
            auth: { type: 'none' },
            models: [
              {
                id: 'flux-dev',
                capabilities: {
                  generate: { maxCount: 1, supportsSize: true },
                  edit: { enabled: false },
                },
              },
              {
                id: 'flux-edit',
                capabilities: {
                  generate: { maxCount: 1 },
                  edit: { enabled: true, maxInputImages: 1 },
                },
              },
            ],
          },
        },
      },
    };

    reloadImageGenerationProviders(config);

    const provider = getImageGenerationProvider('local-flux');
    expect(provider).toMatchObject({
      id: 'local-flux',
      label: 'Local Flux',
      defaultModel: 'flux-dev',
      models: ['flux-dev', 'flux-edit'],
    });
    expect(provider?.modelCapabilities?.['flux-edit']?.edit?.enabled).toBe(true);
    expect(provider?.isConfigured({})).toBe(true);
  });

  it('rejects custom providers that collide with built-in image providers', () => {
    const config = {
      providers: {
        openai: {
          baseUrl: 'https://example.com/v1',
          imageGeneration: {
            api: 'openai-images',
            name: 'Override',
            defaultModel: 'model-1',
            auth: { type: 'none' },
            models: [
              {
                id: 'model-1',
                capabilities: { generate: { maxCount: 1 } },
              },
            ],
          },
        },
      },
    } as ModelsJsonConfig;

    expect(() => reloadImageGenerationProviders(config)).toThrow(
      'cannot override built-in provider "openai"',
    );
  });

  it('dispatches custom models with their exact defaults and capabilities', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.spyOn(providerHttp, 'postJsonRequest').mockImplementation(async (url, options) => {
      calls.push({ url: String(url), body: options.body });
      return new Response(
        JSON.stringify({ data: [{ b64_json: Buffer.from('image').toString('base64') }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const config: ModelsJsonConfig = {
      providers: {
        'custom-image': {
          baseUrl: 'https://images.example.com/v1',
          imageGeneration: {
            api: 'openai-images',
            name: 'Custom Image',
            defaultModel: 'small',
            auth: { type: 'none' },
            models: [
              {
                id: 'small',
                capabilities: { generate: { maxCount: 1 } },
                defaults: { count: 1, size: '512x512', outputFormat: 'jpeg' },
              },
              {
                id: 'large',
                capabilities: { generate: { maxCount: 2 } },
                defaults: { count: 2, size: '1024x1024', outputFormat: 'png' },
              },
            ],
          },
        },
      },
    };
    reloadImageGenerationProviders(config);
    const provider = getImageGenerationProvider('custom-image')!;

    await provider.generateImage({
      provider: 'custom-image',
      model: 'large',
      prompt: 'test',
    });

    expect(calls).toEqual([
      {
        url: 'https://images.example.com/v1/images/generations',
        body: expect.objectContaining({
          model: 'large',
          n: 2,
          size: '1024x1024',
          output_format: 'png',
        }),
      },
    ]);
    await expect(
      provider.generateImage({
        provider: 'custom-image',
        model: 'missing',
        prompt: 'test',
      }),
    ).rejects.toThrow('Image model is not configured for custom-image: missing');
  });
});
