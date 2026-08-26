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

  it('adds a Bedrock history cache point before the current user message', () => {
    const bedrock = model('bedrock-converse-stream');
    const payload = transformPromptCachePayload(bedrock, {
      system: [{ text: prompt }],
      messages: [
        { role: 'user', content: [{ text: 'old' }] },
        { role: 'assistant', content: [{ text: 'answer' }] },
        { role: 'user', content: [{ text: 'current' }] },
      ],
    }) as Record<string, any>;

    expect(payload.messages[0].content.at(-1)).toEqual({ cachePoint: { type: 'default' } });
    expect(payload.messages[2].content.at(-1)).toEqual({ text: 'current' });
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
    const options = withPromptCachePayloadTransform(
      openai,
      { systemPrompt: prompt },
      { sessionId: 'session-a' },
      { mode: 'off', lifetime: 'short' },
    );
    expect(options.cacheRetention).toBe('none');
  });

  it('does not inject an unsupported field into custom OpenAI-compatible endpoints', () => {
    const compatible = model('openai-responses', 'custom-provider');
    const options = { sessionId: 'session-a' };

    const transformed = withPromptCachePayloadTransform(compatible, { systemPrompt: prompt }, options);
    expect(transformed.cacheRetention).toBe('none');
  });

  it('uses explicit OpenAI breakpoints for GPT-5.6 Responses', async () => {
    const openai = { ...model('openai-responses'), id: 'gpt-5.6' } as Model<Api>;
    const context = { systemPrompt: prompt, tools: [] };
    const options = withPromptCachePayloadTransform(openai, context, undefined);
    const payload = await options.onPayload?.({
      instructions: 'stable\ndynamic',
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'old' }] },
        { type: 'message', role: 'assistant', content: [{ type: 'input_text', text: 'answer' }] },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'current' }] },
      ],
    }, openai) as Record<string, any>;

    expect(payload.prompt_cache_options).toEqual({ mode: 'explicit', ttl: '30m' });
    expect(payload.instructions[0].content[0].prompt_cache_breakpoint).toEqual({ mode: 'explicit' });
    expect(payload.input[1].content[0].prompt_cache_breakpoint).toEqual({ mode: 'explicit' });
    expect(payload.input[2].content[0].prompt_cache_breakpoint).toBeUndefined();
  });

  it('does not overwrite an upstream OpenAI instruction transform', async () => {
    const openai = { ...model('openai-responses'), id: 'gpt-5.6' } as Model<Api>;
    const options = withPromptCachePayloadTransform(openai, { systemPrompt: prompt }, {
      onPayload: (payload) => ({ ...(payload as object), instructions: 'upstream identity' }),
    });
    const payload = await options.onPayload?.({ input: [] }, openai) as Record<string, any>;
    expect(payload.instructions).toBe('upstream identity');
  });

  it('adds an Anthropic history breakpoint before the current user message', () => {
    const anthropic = model('anthropic-messages');
    const plan = {
      policy: { mode: 'auto' as const, lifetime: 'long' as const },
      providerMode: 'explicit' as const,
    };
    const payload = transformPromptCachePayload(anthropic, {
      system: [{ type: 'text', text: prompt, cache_control: { type: 'ephemeral' } }],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'old' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
        { role: 'user', content: [{ type: 'text', text: 'current' }] },
      ],
    }, plan) as Record<string, any>;

    expect(payload.messages[0].content[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(payload.messages[2].content[0].cache_control).toBeUndefined();
  });
});
