import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderUsageScopeError } from '../../../../providers/model-usage.js';
import { describeImagesWithFallback } from '../runtime.js';

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

  it('rejects restricted fallback routes without invoking either provider', async () => {
    const primary = vi.fn(); const fallback = vi.fn();
    registerImageUnderstandingProvider({ ...createProvider('qwen-token-plan-cn'), describeImages: primary });
    registerImageUnderstandingProvider({ ...createProvider('paid'), describeImages: fallback });
    await expect(describeImagesWithFallback({ modelRef: 'qwen-token-plan-cn/vision', fallbacks: ['paid/vision'], images: [], prompt: 'describe' })).rejects.toThrow(ProviderUsageScopeError);
    expect(primary).not.toHaveBeenCalled(); expect(fallback).not.toHaveBeenCalled();
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
