import { describe, expect, it, vi, afterEach } from 'vitest';
import { createAssistantMessageEventStream, normalizeContext, type Model, type Api } from '@earendil-works/pi-ai';

import { wrapStreamFnForXopcExtensions } from '../xopc-stream-bridge.js';
import {
  ProviderPluginRegistry,
  setProviderRegistry,
  getProviderRegistry,
} from '../../../providers/plugin-registry.js';
import { EXTENSION_PROVIDER_BASE_URL } from '../../../providers/index.js';
import type { ProviderPlugin } from '../../../extensions/types/providers.js';
import { XopcCloudAccountService } from '../../../providers/xopc-cloud-account-service.js';
import { withCloudCreditBudget } from '../../../providers/xopc-cloud-credit-budget.js';

const FAKE_TOOLS = [{ name: 'search', description: 'Search', parameters: {} }];
const FAKE_CONTEXT = normalizeContext({
  systemPrompt: 'You are xopc.',
  messages: [],
  tools: FAKE_TOOLS,
});

function makeBuiltinModel(): Model<Api> {
  return {
    provider: 'openai',
    id: 'gpt-4o',
    api: 'openai-completions',
    baseUrl: 'https://api.openai.com/v1',
  } as unknown as Model<Api>;
}

function makeExtensionModel(providerId: string): Model<Api> {
  return {
    provider: providerId,
    id: 'demo-model',
    api: 'openai-completions',
    baseUrl: EXTENSION_PROVIDER_BASE_URL,
  } as unknown as Model<Api>;
}

describe('wrapStreamFnForXopcExtensions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setProviderRegistry(new ProviderPluginRegistry());
  });

  it('attaches a shared budget to Cloud requests and stops fallback after exhaustion', async () => {
    vi.spyOn(XopcCloudAccountService.prototype, 'createBudget').mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000001', limitCreditMicro: '10000', remainingCreditMicro: '10000',
      chargedCreditMicro: '0', reservedCreditMicro: '0', revision: 1, createdAt: 1,
    });
    const original = vi.fn(() => {
      const stream = createAssistantMessageEventStream();
      const message = { role: 'assistant', content: [], api: 'openai-completions', provider: 'xopc-cloud', model: 'cloud',
        stopReason: 'error', errorMessage: '402 Task Credit budget exhausted; increase its limit to continue',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: Date.now() } as const;
      stream.push({ type: 'error', reason: 'error', error: message as never });
      return stream;
    });
    const wrapped = wrapStreamFnForXopcExtensions(original);
    await withCloudCreditBudget({ conversationId: 'chat', runId: 'run', limitCreditMicro: '10000' }, async () => {
      const stream = await wrapped({ ...makeBuiltinModel(), provider: 'xopc-cloud' }, FAKE_CONTEXT, { headers: { 'x-test': '1' } });
      await stream.result();
      expect(original.mock.calls[0][2].headers).toEqual({ 'x-test': '1', 'x-xopc-credit-budget': '00000000-0000-4000-8000-000000000001' });
      expect(() => wrapped(makeBuiltinModel(), FAKE_CONTEXT)).toThrow('credit_budget_exhausted');
    });
    expect(original).toHaveBeenCalledOnce();
  });

  it('delegates builtin models with the prompt-cache adapter', async () => {
    const original = vi.fn(() => ({}) as never);
    const wrapped = wrapStreamFnForXopcExtensions(original as never);
    const model = makeBuiltinModel();

    wrapped(model, FAKE_CONTEXT, undefined);

    expect(original).toHaveBeenCalledTimes(1);
    const [calledModel, calledContext, calledOptions] = original.mock.calls[0]!;
    expect(calledModel).toBe(model);
    expect(calledContext).toEqual(FAKE_CONTEXT);
    expect(calledOptions).toEqual({ cacheRetention: 'none', onPayload: expect.any(Function) });
    await expect(calledOptions.onPayload({}, model)).resolves.toEqual({
      prompt_cache_key: expect.stringMatching(/^xopc-/),
    });
  });

  it('routes extension models through the plugin registry, bypassing the original streamFn', () => {
    const fakePlugin: ProviderPlugin = {
      id: 'demo',
      name: 'Demo Provider',
      models: [{ id: 'demo-model', name: 'Demo' }],
      createStream: vi.fn(async function* () {
        return;
      }) as never,
    } as ProviderPlugin;
    getProviderRegistry().register(fakePlugin);

    const original = vi.fn(() => ({}) as never);
    const wrapped = wrapStreamFnForXopcExtensions(original as never);

    wrapped(makeExtensionModel('demo'), FAKE_CONTEXT, undefined);

    expect(original).not.toHaveBeenCalled();
    expect(fakePlugin.createStream).toHaveBeenCalledTimes(1);
  });

  it('passes prompt context and stream options to extension providers', () => {
    const fakePlugin: ProviderPlugin = {
      id: 'demo',
      name: 'Demo Provider',
      models: [{ id: 'demo-model', name: 'Demo' }],
      createStream: vi.fn(async function* () {
        return;
      }) as never,
    } as ProviderPlugin;
    getProviderRegistry().register(fakePlugin);

    const original = vi.fn(() => ({}) as never);
    const wrapped = wrapStreamFnForXopcExtensions(original as never);
    const signal = new AbortController().signal;

    wrapped(makeExtensionModel('demo'), FAKE_CONTEXT, {
      temperature: 0.2,
      maxTokens: 123,
      apiKey: 'extension-managed',
      sessionId: 'session-1',
      reasoning: 'medium',
      headers: { 'x-test': '1' },
      timeoutMs: 1000,
      maxRetries: 1,
      metadata: { requestId: 'request-1' },
      transport: 'sse',
      signal,
    } as never);

    expect(fakePlugin.createStream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'demo-model',
        systemPrompt: 'You are xopc.',
        messages: [],
        tools: FAKE_TOOLS,
        temperature: 0.2,
        maxTokens: 123,
        apiKey: 'extension-managed',
        sessionId: 'session-1',
        reasoning: 'medium',
        headers: { 'x-test': '1' },
        timeoutMs: 1000,
        maxRetries: 1,
        metadata: { requestId: 'request-1' },
        transport: 'sse',
        signal,
      }),
    );
  });
});
