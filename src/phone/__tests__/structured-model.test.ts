import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completeSimple } from '@earendil-works/pi-ai/compat';

import { ConfigSchema } from '../../config/schema.js';
import { getApiKey, resolveModel } from '../../providers/index.js';
import { createPhoneModel, type PhonePrediction } from '../model-adapter.js';

vi.mock('@earendil-works/pi-ai/compat', async importOriginal => ({
  ...await importOriginal<typeof import('@earendil-works/pi-ai/compat')>(), completeSimple: vi.fn(),
}));
vi.mock('../../providers/index.js', () => ({ resolveModel: vi.fn(), getApiKey: vi.fn() }));
const config = ConfigSchema.parse({});
const model = { id: 'gpt-6.1-sol', provider: 'openai', api: 'openai-responses', input: ['text', 'image'],
  baseUrl: 'https://api.openai.com/v1', maxTokens: 16384 };
const input: PhonePrediction = { goal: 'Tap Continue', allowedApps: ['com.example.app'], history: [], observation: {
  frameId: 'fresh', capturedAt: Date.now(), width: 600, height: 1000, rotation: 0, package: 'com.example.app', frame: Buffer.from('synthetic'), elements: [],
} };
const tap = { kind: 'action', action: { type: 'tap', point: [500, 480] } };
function reply(decision: unknown = tap, stopReason = 'toolUse') {
  return { role: 'assistant', stopReason, content: [{ type: 'toolCall', id: 'one', name: 'phone_decision', arguments: { decision } }],
    usage: { input: 1, output: 2, totalTokens: 3 } } as any;
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(resolveModel).mockReturnValue(model as never); vi.mocked(getApiKey).mockResolvedValue('oauth-access'); vi.mocked(completeSimple).mockResolvedValue(reply()); });
afterEach(() => vi.restoreAllMocks());

describe('generic phone vision calls', () => {
  it.each(['openai-responses', 'openai-completions'])('uses the shared client and refreshes credentials per prediction (%s)', async api => {
    vi.mocked(resolveModel).mockReturnValue({ ...model, api } as never);
    const adapter = await createPhoneModel('openai/gpt-6.1-sol', config, 'main');
    vi.mocked(getApiKey).mockResolvedValue('refreshed-oauth-access');
    expect(await adapter.predict(input, new AbortController().signal)).toEqual(tap);
    const [selected, context, options] = vi.mocked(completeSimple).mock.calls[0];
    expect(selected.api).toBe(api);
    expect(options).toMatchObject({ apiKey: 'refreshed-oauth-access', maxRetries: 0, transport: 'sse', cacheRetention: 'none' });
    expect(getApiKey).toHaveBeenLastCalledWith('openai', { agentId: 'main', appConfig: config });
    expect(context.messages[0].content).toContainEqual({ type: 'image', mimeType: 'image/png', data: input.observation.frame.toString('base64') });
    const body: Record<string, unknown> = {};
    await options!.onPayload!(body, selected);
    expect(body.parallel_tool_calls).toBe(false);
    expect(body.tool_choice).toEqual(api === 'openai-responses' ? { type: 'function', name: 'phone_decision' } : { type: 'function', function: { name: 'phone_decision' } });
    if (api === 'openai-responses') expect(body).toMatchObject({ store: false, stream: true });
  });
  it.each(['length', 'error', 'aborted', 'stop', 'pending'])('rejects partial or non-tool termination (%s)', async stopReason => {
    vi.mocked(completeSimple).mockResolvedValue(reply(tap, stopReason));
    const adapter = await createPhoneModel('openai/gpt-6.1-sol', config, 'main');
    await expect(adapter.predict(input, new AbortController().signal)).rejects.toMatchObject({ code: stopReason === 'length' ? 'PHONE_MODEL_TRUNCATED' : 'PHONE_MODEL_PROTOCOL' });
  });
  it.each([
    { kind: 'action', action: { type: 'tap', point: [1001, 200] } },
    { kind: 'action', action: { type: 'shell', command: 'ignored' } },
    { kind: 'action', action: { type: 'tapElement', frameId: 'fresh', selector: { text: 'Continue' } } },
    { ...tap, extra: 'ignored' },
  ])('rejects invalid actions and disabled semantic control (%j)', async decision => {
    vi.mocked(completeSimple).mockResolvedValue(reply(decision));
    const adapter = await createPhoneModel('openai/gpt-6.1-sol', config, 'main');
    await expect(adapter.predict(input, new AbortController().signal)).rejects.toMatchObject({ code: 'PHONE_MODEL_PROTOCOL' });
  });
  it('rejects multiple and unknown function calls', async () => {
    const adapter = await createPhoneModel('openai/gpt-6.1-sol', config, 'main');
    for (const content of [[], [{ type: 'toolCall', name: 'other', arguments: { decision: tap } }],
      [reply().content[0], reply().content[0]]]) {
      vi.mocked(completeSimple).mockResolvedValue({ ...reply(), content } as never);
      await expect(adapter.predict(input, new AbortController().signal)).rejects.toMatchObject({ code: 'PHONE_MODEL_PROTOCOL' });
    }
  });
  it('allows read-only transcription and field readings while rejecting actions', async () => {
    const adapter = await createPhoneModel('openai/gpt-6.1-sol', config, 'main');
    vi.mocked(completeSimple).mockResolvedValue(reply({ kind: 'complete', summary: 'Continue' }));
    expect(await adapter.readScreen!(input, new AbortController().signal)).toBe('Continue');
    vi.mocked(completeSimple).mockResolvedValue(reply({ kind: 'complete', summary: '{"label":"Continue"}' }));
    expect(await adapter.readFields!(input, [{ key: 'label', description: 'Button label' }], new AbortController().signal)).toEqual({ label: 'Continue' });
    vi.mocked(completeSimple).mockResolvedValue(reply(tap));
    await expect(adapter.readScreen!(input, new AbortController().signal)).rejects.toMatchObject({ code: 'PHONE_MODEL_PROTOCOL' });
  });
  it('keeps caller cancellation distinct from model timeout', async () => {
    const adapter = await createPhoneModel('openai/gpt-6.1-sol', config, 'main');
    const controller = new AbortController(); const reason = new Error('user stopped'); controller.abort(reason);
    await expect(adapter.predict(input, controller.signal)).rejects.toBe(reason);
    expect(completeSimple).not.toHaveBeenCalled();
  });
  it('applies the deadline to shared-client stream completion', async () => {
    const deadline = new AbortController(); vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    vi.mocked(completeSimple).mockImplementation(async (_model, _context, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true });
    }));
    const adapter = await createPhoneModel('openai/gpt-6.1-sol', config, 'main');
    const result = adapter.predict(input, new AbortController().signal);
    const check = expect(result).rejects.toMatchObject({ code: 'PHONE_MODEL_TIMEOUT' });
    await vi.waitFor(() => expect(completeSimple).toHaveBeenCalledOnce());
    deadline.abort(new DOMException('timed out', 'TimeoutError')); await check;
  });
});
