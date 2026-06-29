import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearImageUnderstandingRegistryForTests,
  getImageUnderstandingProvider,
  registerImageUnderstandingProvider,
  registerImageUnderstandingProviderFactory,
} from '../provider-registry.js';
import type { ImageUnderstandingProvider } from '../types.js';

function createProvider(id: string): ImageUnderstandingProvider {
  return {
    id,
    label: `Mock ${id}`,
    async isConfigured() {
      return true;
    },
    async describeImages() {
      return { text: 'ok', provider: id, model: 'vision' };
    },
  };
}

describe('ImageUnderstandingProvider registry', () => {
  beforeEach(() => {
    clearImageUnderstandingRegistryForTests();
  });

  it('returns explicitly registered providers case-insensitively', () => {
    const provider = createProvider('CustomVision');
    registerImageUnderstandingProvider(provider);

    expect(getImageUnderstandingProvider('customvision')).toBe(provider);
    expect(getImageUnderstandingProvider('CUSTOMVISION')).toBe(provider);
  });

  it('lazily creates and caches providers through registered factories', () => {
    let calls = 0;
    registerImageUnderstandingProviderFactory((providerId) => {
      calls += 1;
      return providerId === 'acme' ? createProvider(providerId) : undefined;
    });

    const first = getImageUnderstandingProvider('acme');
    const second = getImageUnderstandingProvider('ACME');

    expect(first?.id).toBe('acme');
    expect(second).toBe(first);
    expect(calls).toBe(1);
  });

  it('returns undefined when no factory can create a provider', () => {
    registerImageUnderstandingProviderFactory(() => undefined);

    expect(getImageUnderstandingProvider('missing')).toBeUndefined();
  });

  it('throws on empty provider id', () => {
    expect(() =>
      registerImageUnderstandingProvider({ ...createProvider('x'), id: '' }),
    ).toThrow('Image understanding provider id is required');
  });
});
