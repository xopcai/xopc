import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { resolveModel } from '../../providers/index.js';
import { ConfigSchema } from '../../config/schema.js';
import { createPhoneModel, type PhonePrediction } from '../model-adapter.js';

vi.mock('../../providers/index.js', () => ({
  resolveModel: vi.fn(() => ({ id: 'gpt-6.1-sol', provider: 'openai', api: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1', input: ['text', 'image'], reasoning: true, maxTokens: 16384, contextWindow: 128000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })),
  getApiKey: vi.fn(async () => 'synthetic-chatgpt-oauth-access'),
}));
const input: PhonePrediction = { goal: 'Tap Continue', allowedApps: ['com.example.app'], history: [], observation: {
  frameId: 'one', capturedAt: Date.now(), width: 600, height: 1000, rotation: 0,
  package: 'com.example.app', frame: Buffer.from('synthetic-image'), elements: [],
} };
const item = { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'phone_decision',
  arguments: JSON.stringify({ decision: { kind: 'action', action: { type: 'tap', point: [500, 480] } } }), status: 'completed' };
function sse(events: unknown[]) {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
}
const events = [
  { type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '' } },
  { type: 'response.function_call_arguments.delta', output_index: 0, item_id: item.id, delta: item.arguments },
  { type: 'response.output_item.done', output_index: 0, item },
  { type: 'response.completed', response: { id: 'response_1', status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } } },
];
beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => sse(events))));
afterEach(() => vi.unstubAllGlobals());

it('uses the real provider serializer with OAuth, image input and one function tool', async () => {
  const adapter = await createPhoneModel('openai/gpt-6.1-sol', ConfigSchema.parse({}), 'main');
  expect(await adapter.predict(input, new AbortController().signal)).toMatchObject({ kind: 'action', action: { type: 'tap', point: [500, 480] } });
  const [url, init] = vi.mocked(fetch).mock.calls[0];
  expect(String(url)).toBe('https://api.openai.com/v1/responses');
  expect(new Headers(init!.headers).get('authorization')).toBe('Bearer synthetic-chatgpt-oauth-access');
  const body = JSON.parse(init!.body as string);
  expect(body).toMatchObject({ store: false, stream: true, parallel_tool_calls: false, tool_choice: { type: 'function', name: 'phone_decision' } });
  expect(body.max_output_tokens).toBeUndefined(); // Shared OAuth client omits unsupported subscription fields.
  expect(body.input.some((message: { content?: Array<{ type: string }> }) => Array.isArray(message.content) && message.content.some(part => part.type === 'input_image'))).toBe(true);
});

it.each(['missing_terminal', 'missing_item_done', 'failed', 'truncated'])('rejects unfinished provider streams (%s)', async mode => {
  const stream = mode === 'missing_terminal' ? events.slice(0, -1)
    : mode === 'missing_item_done' ? events.filter(event => event.type !== 'response.output_item.done')
    : [...events.slice(0, -1), { type: mode === 'failed' ? 'response.failed' : 'response.incomplete', response: {
      id: 'response_1', status: mode === 'failed' ? 'failed' : 'incomplete', output: [item], incomplete_details: { reason: 'max_output_tokens' },
    } }];
  vi.stubGlobal('fetch', vi.fn(async () => sse(stream)));
  const adapter = await createPhoneModel('openai/gpt-6.1-sol', ConfigSchema.parse({}), 'main');
  await expect(adapter.predict(input, new AbortController().signal)).rejects.toMatchObject({ code: mode === 'truncated' ? 'PHONE_MODEL_TRUNCATED' : 'PHONE_MODEL_PROTOCOL' });
  expect(fetch).toHaveBeenCalledOnce();
});

it('serializes a custom Chat Completions visual model using the same decision schema', async () => {
  vi.mocked(resolveModel).mockReturnValueOnce({ id: 'custom-vision', provider: 'custom', api: 'openai-completions',
    baseUrl: 'https://model.test/v1', input: ['text', 'image'], reasoning: false, maxTokens: 3000, contextWindow: 128000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } as never);
  vi.stubGlobal('fetch', vi.fn(async () => sse([
    { id: 'chat_1', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'phone_decision', arguments: item.arguments } }] }, finish_reason: null }] },
    { id: 'chat_1', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } },
  ])));
  const adapter = await createPhoneModel('custom/custom-vision', ConfigSchema.parse({}), 'main');
  expect(await adapter.predict(input, new AbortController().signal)).toMatchObject({ kind: 'action', action: { type: 'tap' } });
  const [url, init] = vi.mocked(fetch).mock.calls[0];
  expect(String(url)).toBe('https://model.test/v1/chat/completions');
  const body = JSON.parse(init!.body as string);
  expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'phone_decision' } });
  expect(body.tools[0].function.name).toBe('phone_decision');
});
