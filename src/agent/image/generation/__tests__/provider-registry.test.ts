import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerImageGenerationProvider,
  getImageGenerationProvider,
  listImageGenerationProviders,
  listImageGenerationProvidersSummary,
  clearImageGenerationRegistryForTests,
  type ImageGenerationProvider,
} from '../provider-registry.js';

function createMockProvider(id: string, overrides?: Partial<ImageGenerationProvider>): ImageGenerationProvider {
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
    ...overrides,
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

  it('lists provider summaries with new optional fields', () => {
    registerImageGenerationProvider(
      createMockProvider('openai', { aliases: ['openai-images'], capabilities: { generate: { maxCount: 4 } } }),
    );
    const summaries = listImageGenerationProvidersSummary();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      id: 'openai',
      label: 'Mock openai',
      defaultModel: 'openai-default',
      models: ['openai-default', 'openai-v2'],
      aliases: ['openai-images'],
    });
    expect(summaries[0]?.capabilities).toBeDefined();
  });

  it('includes gateway ui metadata on summaries when the provider defines it', () => {
    registerImageGenerationProvider(
      createMockProvider('acme', {
        ui: {
          regions: [{ value: 'eu', label: 'EU', imageBaseUrl: 'https://acme.example/gen' }],
        },
      }),
    );
    const summaries = listImageGenerationProvidersSummary();
    expect(summaries[0]?.ui?.regions?.[0]?.value).toBe('eu');
    expect(summaries[0]?.ui?.regions?.[0]?.imageBaseUrl).toContain('acme');
  });

  it('throws on empty provider id', () => {
    expect(() =>
      registerImageGenerationProvider({ ...createMockProvider('x'), id: '' }),
    ).toThrow('Image generation provider id is required');
  });

  it('throws on reserved provider id', () => {
    expect(() =>
      registerImageGenerationProvider({ ...createMockProvider('x'), id: '__proto__' }),
    ).toThrow(/reserved/);
  });

  it('overwrites provider with same id', () => {
    const first = createMockProvider('dup');
    const second = createMockProvider('dup');
    second.label = 'Updated';
    registerImageGenerationProvider(first);
    registerImageGenerationProvider(second);
    expect(getImageGenerationProvider('dup')?.label).toBe('Updated');
  });

  it('resolves a provider by alias (case-insensitive)', () => {
    registerImageGenerationProvider(createMockProvider('vendor', { aliases: ['Vendor-Images'] }));
    expect(getImageGenerationProvider('vendor-images')?.id).toBe('vendor');
    expect(getImageGenerationProvider('VENDOR-IMAGES')?.id).toBe('vendor');
  });

  it('drops stale alias entries when a provider is re-registered without that alias', () => {
    registerImageGenerationProvider(createMockProvider('vendor', { aliases: ['old-alias'] }));
    expect(getImageGenerationProvider('old-alias')?.id).toBe('vendor');
    registerImageGenerationProvider(createMockProvider('vendor', { aliases: ['new-alias'] }));
    expect(getImageGenerationProvider('old-alias')).toBeUndefined();
    expect(getImageGenerationProvider('new-alias')?.id).toBe('vendor');
  });

  it('skips providers disabled via cfg.extensions[<id>].enabled = false', () => {
    registerImageGenerationProvider(createMockProvider('openai'));
    registerImageGenerationProvider(createMockProvider('dashscope'));
    const cfg = { extensions: { openai: { enabled: false } } } as any;
    expect(getImageGenerationProvider('openai', cfg)).toBeUndefined();
    expect(getImageGenerationProvider('dashscope', cfg)?.id).toBe('dashscope');
    expect(listImageGenerationProviders(cfg).map((p) => p.id)).toEqual(['dashscope']);
  });
});
