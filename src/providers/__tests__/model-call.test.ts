import { completeSimple, type Api, type Model } from '@earendil-works/pi-ai/compat';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@earendil-works/pi-ai/compat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@earendil-works/pi-ai/compat')>();
  return { ...actual, completeSimple: vi.fn() };
});

vi.mock('../index.js', () => ({
  EXTENSION_PROVIDER_BASE_URL: 'extension://provider-plugin',
  getApiKey: vi.fn(),
}));

vi.mock('../extension-stream-bridge.js', () => ({
  createExtensionAwareStreamFn: vi.fn(),
}));

import { createExtensionAwareStreamFn } from '../extension-stream-bridge.js';
import { getApiKey } from '../index.js';
import {
  completeWithResolvedCredentials,
  resolveModelCallOptions,
} from '../model-call.js';

function model(overrides: Partial<Model<Api>> = {}): Model<Api> {
  return {
    provider: 'openai-codex',
    id: 'gpt-5.6-luna',
    name: 'GPT-5.6 Luna',
    api: 'openai-codex-responses' as Api,
    baseUrl: 'https://chatgpt.com/backend-api/codex',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
    ...overrides,
  } as Model<Api>;
}

describe('model-call', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getApiKey).mockResolvedValue('oauth-token');
  });

  it('injects resolved OAuth credentials and omits temperature for Codex Responses', async () => {
    const options = await resolveModelCallOptions(model(), { maxTokens: 1000, temperature: 0.2 });

    expect(getApiKey).toHaveBeenCalledWith('openai-codex');
    expect(options).toEqual({ maxTokens: 1000, apiKey: 'oauth-token' });
  });

  it('uses the extension provider bridge instead of pi-ai HTTP completion', async () => {
    const message = { role: 'assistant', content: [], stopReason: 'stop' };
    const result = vi.fn(async () => message);
    vi.mocked(createExtensionAwareStreamFn).mockReturnValue((() => ({ result })) as never);

    await expect(
      completeWithResolvedCredentials(
        model({ provider: 'extension-model', baseUrl: 'extension://provider-plugin' }),
        { messages: [] },
      ),
    ).resolves.toBe(message);

    expect(completeSimple).not.toHaveBeenCalled();
    expect(result).toHaveBeenCalledOnce();
  });

  it('uses the unified simple completion path for built-in models', async () => {
    const message = { role: 'assistant', content: [], stopReason: 'stop' };
    vi.mocked(completeSimple).mockResolvedValue(message as never);

    await expect(
      completeWithResolvedCredentials(
        model(),
        { messages: [] },
        { maxTokens: 1000, reasoning: 'low' },
      ),
    ).resolves.toBe(message);

    expect(completeSimple).toHaveBeenCalledWith(
      model(),
      { messages: [] },
      { maxTokens: 1000, reasoning: 'low', apiKey: 'oauth-token' },
    );
  });
});
