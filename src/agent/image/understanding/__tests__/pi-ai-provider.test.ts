import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getModelsByProvider: vi.fn(),
  resolveModel: vi.fn(),
  getApiKey: vi.fn(),
  complete: vi.fn(),
}));

vi.mock('@earendil-works/pi-ai', () => ({
  complete: mocks.complete,
}));

vi.mock('../../../../providers/index.js', () => ({
  getModelsByProvider: mocks.getModelsByProvider,
  resolveModel: mocks.resolveModel,
  getApiKey: mocks.getApiKey,
}));

import '../pi-ai-provider.js';
import { getImageUnderstandingProvider } from '../provider-registry.js';

describe('pi-ai image understanding provider registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lazily exposes non-default providers that declare image-capable models', () => {
    mocks.getModelsByProvider.mockReturnValue([
      { id: 'vision-model', input: ['text', 'image'] },
    ]);

    const provider = getImageUnderstandingProvider('acme');

    expect(provider?.id).toBe('acme');
    expect(provider?.label).toBe('pi-ai (acme)');
  });

  it('does not expose providers with no image-capable models', () => {
    mocks.getModelsByProvider.mockReturnValue([{ id: 'text-model', input: ['text'] }]);

    expect(getImageUnderstandingProvider('textonly')).toBeUndefined();
  });
});
