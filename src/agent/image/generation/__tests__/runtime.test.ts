import { describe, expect, it, vi } from 'vitest';

import { isFailoverError } from '../../../failover-error.js';
import { generateImage } from '../runtime.js';
import type { ImageGenerationProvider } from '../types.js';

function buildProviderMock(overrides: Partial<ImageGenerationProvider> & { id: string }): ImageGenerationProvider {
  return {
    defaultModel: `${overrides.id}-default`,
    models: [`${overrides.id}-default`],
    capabilities: { generate: { maxCount: 4, supportsSize: true } },
    isConfigured: () => true,
    async generateImage() {
      return {
        images: [{ buffer: Buffer.from('x'), mimeType: 'image/png' }],
      };
    },
    ...overrides,
  } as ImageGenerationProvider;
}

const baseModelConfig = { primary: 'mock/mock-default' };

describe('generateImage runtime', () => {
  it('returns provider/model/attempts on success and surfaces normalization metadata', async () => {
    const provider = buildProviderMock({
      id: 'mock',
      capabilities: {
        generate: { supportsSize: true },
        geometry: { sizes: ['1024x1024'] },
      },
      generateImage: vi.fn(async (req) => {
        expect(req.size).toBe('1024x1024'); // normalised from 1000x1000
        return {
          images: [{ buffer: Buffer.from('img'), mimeType: 'image/png', fileName: 'a.png' }],
          metadata: { providerId: 'mock' },
        };
      }),
    });

    const result = await generateImage(
      { cfg: undefined, modelConfig: baseModelConfig, prompt: 'cat', size: '1000x1000' },
      {
        getProvider: () => provider,
        listProviders: () => [provider],
      },
    );

    expect(result.provider).toBe('mock');
    expect(result.model).toBe('mock-default');
    expect(result.images).toHaveLength(1);
    expect(result.attempts).toEqual([]);
    expect(result.normalization?.size?.applied).toBe('1024x1024');
    expect(result.metadata?.providerId).toBe('mock');
    expect(result.metadata?.normalization).toBeDefined();
    expect(result.ignoredOverrides).toEqual([]);
  });

  it('records each candidate failure with provider/model/error/reason and walks fallbacks', async () => {
    const failing = buildProviderMock({
      id: 'failing',
      generateImage: vi.fn(async () => {
        throw new Error('upstream 500');
      }),
    });
    const succeeding = buildProviderMock({
      id: 'good',
      generateImage: vi.fn(async () => ({
        images: [{ buffer: Buffer.from('y'), mimeType: 'image/png' }],
      })),
    });

    const result = await generateImage(
      {
        cfg: undefined,
        modelConfig: {
          primary: 'failing/failing-default',
          fallbacks: ['good/good-default'],
        },
        prompt: 'p',
      },
      {
        getProvider: (id) => (id === 'failing' ? failing : succeeding),
        listProviders: () => [failing, succeeding],
      },
    );

    expect(result.provider).toBe('good');
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({
      provider: 'failing',
      model: 'failing-default',
      error: expect.stringContaining('upstream 500'),
    });
    expect(result.attempts[0]?.reason).toBeDefined();
  });

  it('throws FailoverError with structured attempts when every candidate fails', async () => {
    const failing = buildProviderMock({
      id: 'failing',
      generateImage: vi.fn(async () => {
        throw new Error('boom');
      }),
    });

    await expect(
      generateImage(
        { cfg: undefined, modelConfig: { primary: 'failing/failing-default' }, prompt: 'p' },
        {
          getProvider: () => failing,
          listProviders: () => [failing],
        },
      ),
    ).rejects.toSatisfy((err: unknown) => {
      if (!isFailoverError(err)) return false;
      return err.attempts.length === 1 && err.attempts[0]?.provider === 'failing';
    });
  });

  it('records "config" reason when candidate provider is not registered', async () => {
    await expect(
      generateImage(
        { cfg: undefined, modelConfig: { primary: 'unknown/x' }, prompt: 'p' },
        {
          getProvider: () => undefined,
          listProviders: () => [],
        },
      ),
    ).rejects.toSatisfy((err: unknown) => {
      if (!isFailoverError(err)) return false;
      return err.attempts[0]?.reason === 'config';
    });
  });

  it('throws a configuration message when no candidate models are available', async () => {
    await expect(
      generateImage(
        { cfg: undefined, prompt: 'p' },
        {
          listProviders: () => [],
          getProvider: () => undefined,
        },
      ),
    ).rejects.toThrow(/image-generation/);
  });
});
