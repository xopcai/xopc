import { describe, expect, it, vi } from 'vitest';
import type { Api, Model } from '@earendil-works/pi-ai';
import { streamSimple } from '@earendil-works/pi-ai/compat';

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

  it('places explicit OpenAI breakpoints in input without duplicating system instructions', async () => {
    const openai = { ...model('openai-responses'), id: 'gpt-5.6', compat: { supportsExplicitPromptCacheMode: true } } as Model<Api>;
    const context = { systemPrompt: prompt, tools: [] };
    const options = withPromptCachePayloadTransform(openai, context, undefined);
    const payload = await options.onPayload?.({
      prompt_cache_options: { mode: 'explicit' },
      input: [
        { role: 'developer', content: 'stable\ndynamic' },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'old' }] },
        { type: 'message', role: 'assistant', content: [{ type: 'input_text', text: 'answer' }] },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'current' }] },
      ],
    }, openai) as Record<string, any>;

    expect(payload.prompt_cache_options).toEqual({ mode: 'explicit', ttl: '30m' });
    expect(payload.instructions).toBeUndefined();
    expect(payload.input).toHaveLength(4);
    expect(payload.input[0]).toEqual({ role: 'developer', content: [
      { type: 'input_text', text: 'stable', prompt_cache_breakpoint: { mode: 'explicit' } },
      { type: 'input_text', text: 'dynamic' },
    ] });
    expect(payload.input[2].content[0].prompt_cache_breakpoint).toEqual({ mode: 'explicit' });
    expect(payload.input[3].content[0].prompt_cache_breakpoint).toBeUndefined();
  });

  it('does not overwrite an upstream OpenAI instruction transform', async () => {
    const openai = { ...model('openai-responses'), id: 'gpt-5.6', compat: { supportsExplicitPromptCacheMode: true } } as Model<Api>;
    const options = withPromptCachePayloadTransform(openai, { systemPrompt: prompt }, {
      onPayload: (payload) => ({ ...(payload as object), instructions: 'upstream identity' }),
    });
    const payload = await options.onPayload?.({ prompt_cache_options: { mode: 'explicit' }, input: [] }, openai) as Record<string, any>;
    expect(payload.instructions).toBe('upstream identity');
  });

  it('keeps string instructions unchanged for instructions-based payloads', async () => {
    const openai = { ...model('openai-responses'), id: 'gpt-5.6-sol', compat: { supportsExplicitPromptCacheMode: true } } as Model<Api>;
    const options = withPromptCachePayloadTransform(openai, { systemPrompt: prompt }, undefined);
    const payload = await options.onPayload?.({ instructions: 'stable\ndynamic', input: [] }, openai);
    expect(payload).toMatchObject({ instructions: 'stable\ndynamic', input: [] });
  });

  it('does not cache dynamic system content as a history breakpoint on the first turn', async () => {
    const openai = { ...model('openai-responses'), id: 'gpt-5.6-sol', compat: { supportsExplicitPromptCacheMode: true } } as Model<Api>;
    const options = withPromptCachePayloadTransform(openai, { systemPrompt: prompt }, undefined);
    const payload = await options.onPayload?.({ prompt_cache_options: { mode: 'explicit' }, input: [
      { role: 'system', content: [{ type: 'input_text', text: 'stable\ndynamic' }] },
      { role: 'user', content: [{ type: 'input_text', text: 'current' }] },
    ] }, openai) as Record<string, any>;
    expect(payload.input[0].content[0].prompt_cache_breakpoint).toEqual({ mode: 'explicit' });
    expect(payload.input[0].content[1]).toEqual({ type: 'input_text', text: 'dynamic' });
    expect(payload.input[1].content[0].prompt_cache_breakpoint).toBeUndefined();
  });

  it('preserves upstream input instruction changes', async () => {
    const openai = { ...model('openai-responses'), id: 'gpt-5.6-sol', compat: { supportsExplicitPromptCacheMode: true } } as Model<Api>;
    const options = withPromptCachePayloadTransform(openai, { systemPrompt: prompt }, undefined);
    const payload = await options.onPayload?.({ prompt_cache_options: { mode: 'explicit' }, input: [
      { role: 'developer', content: 'upstream identity' },
      { role: 'user', content: 'current' },
    ] }, openai) as Record<string, any>;
    expect(payload.input[0]).toEqual({ role: 'developer', content: 'upstream identity' });
  });

  it('preserves pi subscription cache restrictions for ChatGPT OAuth', async () => {
    const openai = { ...model('openai-responses'), id: 'gpt-5.6-sol', compat: { supportsExplicitPromptCacheMode: true }, baseUrl: 'https://api.openai.com/v1' } as Model<Api>;
    const options = withPromptCachePayloadTransform(openai, { systemPrompt: prompt }, { apiKey: 'oauth-token' });
    const input = [{ role: 'developer', content: 'stable\ndynamic' }, { role: 'user', content: 'current' }];
    const payload = await options.onPayload?.({ input }, openai);
    expect(payload).toEqual({ input, prompt_cache_key: buildPromptCacheKey(openai, { systemPrompt: prompt }) });
  });

  it.each(['sk-test', 'oauth-token'])('sends a valid Responses request when %s credentials are resolved after the wrapper', async (apiKey) => {
    const openai = {
      ...model('openai-responses'), id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol',
      baseUrl: 'https://api.openai.com/v1', compat: { supportsExplicitPromptCacheMode: true }, reasoning: true, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 16384,
    } as Model<Api>;
    let requestBody: Record<string, any> | undefined;
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      if (apiKey === 'oauth-token' && requestBody?.prompt_cache_options !== undefined) {
        return new Response(JSON.stringify({ error: { message: 'prompt_cache_options is not supported on this model' } }), { status: 400 });
      }
      if (requestBody?.instructions !== undefined && typeof requestBody.instructions !== 'string') {
        return new Response(JSON.stringify({ error: { message: 'instructions must be a string' } }), { status: 400 });
      }
      const event = { type: 'response.completed', response: { id: 'response-test', status: 'completed', output: [],
        usage: { input_tokens: 10, output_tokens: 0, total_tokens: 10 } } };
      return new Response(`data: ${JSON.stringify(event)}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    });
    const context = { systemPrompt: prompt, messages: [{ role: 'user' as const, content: 'hello', timestamp: 0 }] };
    const transformedOptions = withPromptCachePayloadTransform(openai, context, { fetch: fetchImpl, maxRetries: 0 });
    const stream = streamSimple(openai, preparePromptCacheContext(openai, context), { ...transformedOptions, apiKey });
    const result = await stream.result();
    expect(result.errorMessage).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(requestBody?.instructions).toBeUndefined();
    expect(requestBody?.input).toHaveLength(2);
    if (apiKey === 'oauth-token') {
      expect(requestBody?.prompt_cache_options).toBeUndefined();
      expect(requestBody?.input[0].content).toBe('stable\ndynamic');
    } else {
      expect(requestBody?.input[0].content).toEqual([
        { type: 'input_text', text: 'stable', prompt_cache_breakpoint: { mode: 'explicit' } },
        { type: 'input_text', text: 'dynamic' },
      ]);
    }
  });

  it('does not infer explicit caching from a GPT-5.6 model name', async () => {
    const openai = { ...model('openai-responses'), id: 'gpt-5.6-luna', compat: { supportsExplicitPromptCacheMode: false } } as Model<Api>;
    const input = [{ role: 'developer', content: 'stable\ndynamic' }, { role: 'user', content: 'current' }];
    const options = withPromptCachePayloadTransform(openai, { systemPrompt: prompt }, undefined);
    expect(await options.onPayload?.({ input }, openai)).toEqual({ input, prompt_cache_key: buildPromptCacheKey(openai, { systemPrompt: prompt }) });
  });

  it('respects authentication resolved inside the original stream function', async () => {
    const openai = { ...model('openai-responses'), id: 'gpt-5.6-sol', compat: { supportsExplicitPromptCacheMode: true } } as Model<Api>;
    const input = [{ role: 'developer', content: 'stable\ndynamic' }, { role: 'user', content: 'current' }];
    // The wrapper has no API key yet. pi omits cache options after resolving OAuth.
    const options = withPromptCachePayloadTransform(openai, { systemPrompt: prompt }, undefined);
    const payload = await options.onPayload?.({ input, prompt_cache_options: undefined }, openai);
    expect(payload).toEqual({ input, prompt_cache_options: undefined, prompt_cache_key: buildPromptCacheKey(openai, { systemPrompt: prompt }) });
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
