import { describe, expect, it, vi } from 'vitest';
import type { Api, Model } from '@earendil-works/pi-ai';

import { PROMPT_CACHE_BOUNDARY } from '../../agent/prompt/cache-boundary.js';
import {
  preparePromptCacheContext,
  buildPromptCacheKey,
  transformPromptCachePayload,
  withPromptCachePayloadTransform,
} from '../prompt-cache-payload.js';

function model(api: Api, provider = api.startsWith('openai-') ? 'openai' : 'test'): Model<Api> {
  return { api, provider, id: 'model' } as Model<Api>;
}

const prompt = `stable${PROMPT_CACHE_BOUNDARY}dynamic`;

describe('prompt cache payload adaptation', () => {
  it('creates a real Anthropic cache boundary before dynamic system content', () => {
    const payload = transformPromptCachePayload(model('anthropic-messages'), {
      system: [{ type: 'text', text: prompt, cache_control: { type: 'ephemeral' } }],
    });

    expect(payload).toEqual({
      system: [
        { type: 'text', text: 'stable', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'dynamic' },
      ],
    });
  });

  it('preserves an Anthropic OAuth identity block ahead of the xopc cache blocks', () => {
    const identity = {
      type: 'text',
      text: 'You are Claude Code.',
      cache_control: { type: 'ephemeral' },
    };
    const payload = transformPromptCachePayload(model('anthropic-messages'), {
      system: [
        identity,
        { type: 'text', text: prompt, cache_control: { type: 'ephemeral' } },
      ],
    });

    expect(payload).toEqual({
      system: [
        identity,
        { type: 'text', text: 'stable', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'dynamic' },
      ],
    });
  });

  it('places the Bedrock cache point between stable and dynamic system content', () => {
    const payload = transformPromptCachePayload(model('bedrock-converse-stream'), {
      system: [{ text: prompt }, { cachePoint: { type: 'default' } }],
    });

    expect(payload).toEqual({
      system: [
        { text: 'stable' },
        { cachePoint: { type: 'default' } },
        { text: 'dynamic' },
      ],
    });
  });

  it('strips the internal marker for implicit-prefix-cache providers', () => {
    expect(preparePromptCacheContext(model('openai-responses'), { systemPrompt: prompt }))
      .toEqual({ systemPrompt: 'stable\ndynamic' });
  });

  it('composes after an existing payload transform', async () => {
    const upstream = vi.fn(() => ({
      system: [{ type: 'text', text: prompt, cache_control: { type: 'ephemeral' } }],
      metadata: { source: 'upstream' },
    }));
    const options = withPromptCachePayloadTransform(
      model('anthropic-messages'),
      { systemPrompt: prompt },
      { onPayload: upstream },
    );
    const transformed = await options?.onPayload?.({}, model('anthropic-messages'));

    expect(upstream).toHaveBeenCalledOnce();
    expect(transformed).toEqual({
      system: [
        { type: 'text', text: 'stable', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'dynamic' },
      ],
      metadata: { source: 'upstream' },
    });
  });

  it('uses a stable OpenAI cache key across sessions with the same static prefix', async () => {
    const openai = model('openai-responses');
    const contextA = { systemPrompt: prompt, tools: [{ name: 'read', parameters: { type: 'object' } }] };
    const contextB = {
      systemPrompt: `stable${PROMPT_CACHE_BOUNDARY}different dynamic state`,
      tools: [{ parameters: { type: 'object' }, name: 'read' }],
    };

    expect(buildPromptCacheKey(openai, contextA)).toBe(buildPromptCacheKey(openai, contextB));
    const options = withPromptCachePayloadTransform(openai, contextA, { sessionId: 'session-a' });
    await expect(options?.onPayload?.({}, openai)).resolves.toEqual({
      prompt_cache_key: buildPromptCacheKey(openai, contextA),
    });
  });

  it('does not send an OpenAI cache key when caching is disabled', () => {
    const openai = model('openai-responses');
    expect(withPromptCachePayloadTransform(openai, { systemPrompt: prompt }, {
      cacheRetention: 'none',
      sessionId: 'session-a',
    })).toEqual({ cacheRetention: 'none', sessionId: 'session-a' });
  });

  it('does not inject an unsupported field into custom OpenAI-compatible endpoints', () => {
    const compatible = model('openai-responses', 'custom-provider');
    const options = { sessionId: 'session-a' };

    expect(withPromptCachePayloadTransform(compatible, { systemPrompt: prompt }, options))
      .toBe(options);
  });
});
