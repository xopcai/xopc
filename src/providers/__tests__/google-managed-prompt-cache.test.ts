import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api, Model } from '@earendil-works/pi-ai';

import { PROMPT_CACHE_BOUNDARY } from '../../agent/prompt/cache-boundary.js';
import {
  applyGoogleManagedPromptCache,
  clearGoogleManagedPromptCaches,
} from '../google-managed-prompt-cache.js';

const model = {
  provider: 'google',
  id: 'gemini-2.5-pro',
  api: 'google-generative-ai',
} as Model<Api>;
const stable = 's'.repeat(5_000);
const systemPrompt = `${stable}${PROMPT_CACHE_BOUNDARY}current runtime`;
const payload = {
  model: model.id,
  contents: [{ role: 'user', parts: [{ text: 'old' }] }, { role: 'user', parts: [{ text: 'current' }] }],
  config: {
    systemInstruction: `${stable}\ncurrent runtime`,
    tools: [{ functionDeclarations: [{ name: 'read' }] }],
    toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
    temperature: 0.2,
  },
};

describe('Google managed prompt cache', () => {
  beforeEach(clearGoogleManagedPromptCaches);

  it('creates and reuses a content-addressed cachedContents resource', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      name: 'cachedContents/cache-1',
      expireTime: '2030-01-01T00:00:00Z',
    }), { status: 200 }));
    const params = {
      model,
      context: { systemPrompt },
      payload,
      policy: { mode: 'auto' as const, lifetime: 'short' as const },
      apiKey: 'secret',
      fetchImpl: fetchImpl as typeof fetch,
      now: 1_000,
    };

    const first = await applyGoogleManagedPromptCache(params) as Record<string, any>;
    const second = await applyGoogleManagedPromptCache(params) as Record<string, any>;

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(first.config).toEqual({ temperature: 0.2, cachedContent: 'cachedContents/cache-1' });
    expect(first.contents.at(-2).parts[0].text).toContain('current runtime');
    expect(second.config.cachedContent).toBe('cachedContents/cache-1');
  });

  it('falls back without mutating the payload when cache creation fails', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 400 }));
    const result = await applyGoogleManagedPromptCache({
      model,
      context: { systemPrompt },
      payload,
      policy: { mode: 'auto', lifetime: 'short' },
      apiKey: 'secret',
      fetchImpl: fetchImpl as typeof fetch,
      now: 1_000,
    });

    expect(result).toBe(payload);
  });

  it('deduplicates concurrent cache creation', async () => {
    let resolveResponse!: (response: Response) => void;
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    }));
    const params = {
      model,
      context: { systemPrompt },
      payload,
      policy: { mode: 'auto' as const, lifetime: 'short' as const },
      apiKey: 'secret',
      fetchImpl: fetchImpl as typeof fetch,
      now: 1_000,
    };
    const first = applyGoogleManagedPromptCache(params);
    const second = applyGoogleManagedPromptCache(params);
    resolveResponse(new Response(JSON.stringify({ name: 'cachedContents/shared' }), { status: 200 }));

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
