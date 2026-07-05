import { afterEach, describe, expect, it, vi } from 'vitest';

import { discoverProviderModels, isProviderApiDiscoverable } from '../model-discovery.js';

describe('provider model discovery', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads OpenAI-compatible /models responses', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [{ id: 'qwen-plus' }, { id: 'qwen-max' }, { id: 'qwen-plus' }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      discoverProviderModels({
        providerId: 'dashscope',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        apiKey: 'test-key',
        api: 'openai-completions',
      }),
    ).resolves.toEqual([
      { id: 'qwen-max', name: 'qwen-max', input: ['text'], source: 'live' },
      { id: 'qwen-plus', name: 'qwen-plus', input: ['text'], source: 'live' },
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ authorization: 'Bearer test-key' }),
      }),
    );
  });

  it('does not advertise discovery for Anthropic-compatible providers', () => {
    expect(isProviderApiDiscoverable('anthropic-messages')).toBe(false);
    expect(isProviderApiDiscoverable('openai-completions')).toBe(true);
    expect(isProviderApiDiscoverable(undefined)).toBe(true);
  });
});
