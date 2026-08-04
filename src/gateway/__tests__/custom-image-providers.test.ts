import { describe, expect, it } from 'vitest';

import type { ModelsJsonConfig } from '../../config/models-json.js';
import {
  deleteCustomImageProvider,
  listCustomImageProviders,
  upsertCustomImageProvider,
} from '../custom-image-providers.js';

const imageInput = {
  baseUrl: 'https://images.example.com/v1',
  headers: { 'x-tenant': 'tenant-1' },
  imageGeneration: {
    api: 'openai-images' as const,
    name: 'Example Images',
    documentationUrl: 'https://images.example.com/docs',
    apiKeyUrl: 'https://images.example.com/keys',
    defaultModel: 'image-1',
    auth: { type: 'bearer' as const },
    models: [
      {
        id: 'image-1',
        capabilities: { generate: { maxCount: 1, supportsSize: true } },
      },
    ],
  },
};

describe('custom image provider configuration', () => {
  it('adds a strict OpenAI Images provider and lists no credentials', () => {
    const next = upsertCustomImageProvider({ providers: {} }, 'example-images', imageInput);

    expect(listCustomImageProviders(next)).toEqual([
      expect.objectContaining({
        providerId: 'example-images',
        baseUrl: 'https://images.example.com/v1',
        imageGeneration: expect.objectContaining({ api: 'openai-images' }),
      }),
    ]);
    expect('apiKey' in (listCustomImageProviders(next)[0] as object)).toBe(false);
  });

  it('rejects unknown protocol fields instead of treating them as compatibility hooks', () => {
    expect(() => upsertCustomImageProvider(
      { providers: {} },
      'example-images',
      {
        ...imageInput,
        imageGeneration: {
          ...imageInput.imageGeneration,
          responseMapping: { images: 'output.data' },
        },
      },
    )).toThrow(/Unrecognized key/);
  });

  it('rejects built-in image provider IDs', () => {
    expect(() => upsertCustomImageProvider({ providers: {} }, 'openai', imageInput)).toThrow(
      /cannot override a built-in provider ID/,
    );
  });

  it('rejects credential values placed in static headers', () => {
    expect(() => upsertCustomImageProvider(
      { providers: {} },
      'example-images',
      { ...imageInput, headers: { Authorization: 'Bearer plaintext-secret' } },
    )).toThrow(/Credential headers must be stored in the credential store/);
  });

  it('rejects non-ByteString static header values before runtime', () => {
    expect(() => upsertCustomImageProvider(
      { providers: {} },
      'example-images',
      { ...imageInput, headers: { 'x-route': 'primary→backup' } },
    )).toThrow(/HTTP ByteString/);
  });

  it('removes only image configuration when the provider also has text models', () => {
    const existing: ModelsJsonConfig = {
      providers: {
        'shared-provider': {
          baseUrl: 'https://shared.example.com/v1',
          api: 'openai-responses',
          models: [{ id: 'text-1' }],
          imageGeneration: imageInput.imageGeneration,
        },
      },
    };

    const next = deleteCustomImageProvider(existing, 'shared-provider');

    expect(next.providers['shared-provider']).toMatchObject({
      api: 'openai-responses',
      models: [{ id: 'text-1' }],
    });
    expect(next.providers['shared-provider']?.imageGeneration).toBeUndefined();
  });

  it('removes an image-only provider entry completely', () => {
    const configured = upsertCustomImageProvider({ providers: {} }, 'example-images', imageInput);
    const next = deleteCustomImageProvider(configured, 'example-images');
    expect(next.providers['example-images']).toBeUndefined();
  });
});
