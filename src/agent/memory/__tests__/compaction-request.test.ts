import { completeSimple, type Api, type Model } from '@earendil-works/pi-ai/compat';
import { describe, expect, it, vi } from 'vitest';

import { compactionPayloadGuard, initialCompactionOutputLimit } from '../compaction-request.js';

const model: Model<Api> = {
  provider: 'xopc-cloud', id: 'auto', name: 'auto', api: 'openai-completions',
  baseUrl: 'https://diagnostic.invalid/v1', reasoning: true, input: ['text'],
  contextWindow: 128_000, maxTokens: 131_072,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

// Use the installed adapter with a local transport; never contact a provider.
describe('compaction provider budget contract', () => {
  it('scales the initial delta budget with prompt size without consuming the full cap', () => {
    expect(initialCompactionOutputLimit('system', 'small', 16_000)).toBe(4_000);
    expect(initialCompactionOutputLimit('system', 'x'.repeat(100_000), 16_000)).toBe(8_000);
    expect(initialCompactionOutputLimit('system', 'x'.repeat(100_000), 6_000)).toBe(6_000);
  });

  it('sends a total completion cap and retains thinking-only responses with unreported reasoning usage', async () => {
    let sent: Record<string, unknown>;
    const observed = vi.fn();
    const parts = [
      { choices: [{ index: 0, delta: { reasoning_content: 'Synthetic reasoning' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'length' }], usage: { prompt_tokens: 20, completion_tokens: 4_000 } },
    ];
    const result = await completeSimple(model, { messages: [{ role: 'user', content: 'Synthetic record', timestamp: 1 }] }, {
      apiKey: 'synthetic', reasoning: 'low', maxTokens: 4_000, maxRetries: 0,
      onPayload: compactionPayloadGuard(4_000, observed),
      fetch: async (_url, init) => {
        sent = JSON.parse(String(init?.body));
        return new Response(parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join('') + 'data: [DONE]\n\n', {
          headers: { 'Content-Type': 'text/event-stream' },
        });
      },
    });
    expect(sent!).toMatchObject({ max_completion_tokens: 4_000, reasoning_effort: 'low' });
    expect(observed).toHaveBeenCalledWith(4_000);
    expect(result).toMatchObject({ stopReason: 'length', usage: { output: 4_000, reasoning: 0 } });
    expect(result.content.map((block) => block.type)).toEqual(['thinking']);
  });

  it('caps the Anthropic payload after the SDK adds its thinking budget', async () => {
    let sent: Record<string, unknown>;
    const observed = vi.fn();
    await completeSimple({ ...model, provider: 'anthropic', api: 'anthropic-messages', id: 'claude-sonnet-4-20250514' }, {
      messages: [{ role: 'user', content: 'Synthetic record', timestamp: 1 }],
    }, {
      apiKey: 'synthetic', reasoning: 'low', maxTokens: 4_000, maxRetries: 0,
      onPayload: compactionPayloadGuard(4_000, observed),
      fetch: async (_url, init) => {
        sent = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ error: { type: 'invalid_request_error', message: 'Synthetic test response' } }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    expect(sent!).toMatchObject({ max_tokens: 4_000, thinking: { type: 'enabled', budget_tokens: 2_048 } });
    expect(observed).toHaveBeenCalledWith(4_000);
  });

  it('bounds Bedrock generation and thinking together', async () => {
    const payload = { inferenceConfig: { maxTokens: 6_048 }, additionalModelRequestFields: { thinking: { type: 'enabled', budget_tokens: 2_048 } } };
    await compactionPayloadGuard(2_048, vi.fn())(payload, model);
    expect(payload).toEqual({ inferenceConfig: { maxTokens: 2_048 }, additionalModelRequestFields: { thinking: { type: 'enabled', budget_tokens: 1_024 } } });
  });

  it('rejects insufficient thinking room without disabling reasoning', () => {
    const payload = { max_tokens: 2_304, thinking: { type: 'enabled', budget_tokens: 2_048 } };
    expect(() => compactionPayloadGuard(256, vi.fn())(payload, model)).toThrow('cannot fit enabled thinking');
    expect(payload.thinking.type).toBe('enabled');
  });
});
