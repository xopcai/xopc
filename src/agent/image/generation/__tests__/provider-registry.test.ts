import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerImageGenerationProvider,
  getImageGenerationProvider,
  listImageGenerationProviders,
  listImageGenerationProvidersSummary,
  clearImageGenerationRegistryForTests,
  type ImageGenerationProvider,
} from '../provider-registry.js';

function createMockProvider(id: string): ImageGenerationProvider {
  return {
    id,
    label: `Mock ${id}`,
    defaultModel: `${id}-default`,
    models: [`${id}-default`, `${id}-v2`],
    async generateImage() {
      return {
        images: [{ buffer: Buffer.from('test'), mimeType: 'image/png' }],
        model: `${id}-default`,
      };
    },
  };
}

describe('ImageGenerationProvider registry', () => {
  beforeEach(() => {
    clearImageGenerationRegistryForTests();
  });

  it('registers and retrieves a provider', () => {
    const provider = createMockProvider('test-provider');
    registerImageGenerationProvider(provider);
    expect(getImageGenerationProvider('test-provider')).toBe(provider);
  });

  it('retrieves provider case-insensitively', () => {
    registerImageGenerationProvider(createMockProvider('TestProvider'));
    expect(getImageGenerationProvider('testprovider')).toBeDefined();
    expect(getImageGenerationProvider('TESTPROVIDER')).toBeDefined();
  });

  it('returns undefined for unregistered provider', () => {
    expect(getImageGenerationProvider('nonexistent')).toBeUndefined();
  });

  it('lists all registered providers', () => {
    registerImageGenerationProvider(createMockProvider('a'));
    registerImageGenerationProvider(createMockProvider('b'));
    const providers = listImageGenerationProviders();
    expect(providers).toHaveLength(2);
    expect(providers.map((p) => p.id).sort()).toEqual(['a', 'b']);
  });

  it('lists provider summaries', () => {
    registerImageGenerationProvider(createMockProvider('openai'));
    const summaries = listImageGenerationProvidersSummary();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toEqual({
      id: 'openai',
      defaultModel: 'openai-default',
      models: ['openai-default', 'openai-v2'],
    });
  });

  it('throws on empty provider id', () => {
    expect(() =>
      registerImageGenerationProvider({ ...createMockProvider('x'), id: '' }),
    ).toThrow('Image generation provider id is required');
  });

  it('overwrites provider with same id', () => {
    const first = createMockProvider('dup');
    const second = createMockProvider('dup');
    second.label = 'Updated';
    registerImageGenerationProvider(first);
    registerImageGenerationProvider(second);
    expect(getImageGenerationProvider('dup')?.label).toBe('Updated');
  });
});
