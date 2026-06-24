import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../providers/index.js', () => ({
  getApiKey: vi.fn(),
  getDefaultModelSync: vi.fn(),
  resolveModel: vi.fn(),
}));

vi.mock('../../providers/extension-stream-bridge.js', () => ({
  createExtensionAwareStreamFn: vi.fn(),
}));

import type { Model, Api } from '@earendil-works/pi-ai';

import { createExtensionAwareStreamFn } from '../../providers/extension-stream-bridge.js';
import { getApiKey, getDefaultModelSync, resolveModel } from '../../providers/index.js';
import { isLocalModelBaseUrl, resolveTextAssistApiKey, streamTextAssist } from '../text-assist.js';

const mockedGetApiKey = vi.mocked(getApiKey);
const mockedGetDefaultModelSync = vi.mocked(getDefaultModelSync);
const mockedResolveModel = vi.mocked(resolveModel);
const mockedCreateExtensionAwareStreamFn = vi.mocked(createExtensionAwareStreamFn);

function model(overrides: Partial<Model<Api>> = {}): Model<Api> {
  return {
    provider: 'custom',
    id: 'model',
    name: 'model',
    api: 'openai-completions' as Api,
    baseUrl: 'https://api.example.com/v1',
    reasoning: false,
    input: ['text'],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 128000,
    maxTokens: 4096,
    ...overrides,
  } as Model<Api>;
}

describe('text assist model auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the unified provider API key resolver', async () => {
    mockedGetApiKey.mockResolvedValue('resolved-key');

    await expect(resolveTextAssistApiKey(model({ provider: 'openai' }))).resolves.toBe('resolved-key');
    expect(mockedGetApiKey).toHaveBeenCalledWith('openai');
  });

  it('uses a dummy key for local OpenAI-compatible providers without configured credentials', async () => {
    mockedGetApiKey.mockResolvedValue(undefined);

    await expect(
      resolveTextAssistApiKey(model({ provider: 'local-qwen', baseUrl: 'http://localhost:11434/v1' })),
    ).resolves.toBe('xopc-local');
  });

  it('also falls back for local providers when credential resolution throws', async () => {
    mockedGetApiKey.mockRejectedValue(new Error('credential store unavailable'));

    await expect(
      resolveTextAssistApiKey(model({ provider: 'local-qwen', baseUrl: 'http://127.0.0.1:8000/v1' })),
    ).resolves.toBe('xopc-local');
  });

  it('does not invent credentials for remote providers', async () => {
    mockedGetApiKey.mockResolvedValue(undefined);

    await expect(
      resolveTextAssistApiKey(model({ provider: 'remote-custom', baseUrl: 'https://api.vendor.example/v1' })),
    ).resolves.toBeUndefined();
  });

  it('recognizes common local/private base URLs', () => {
    expect(isLocalModelBaseUrl('http://localhost:11434/v1')).toBe(true);
    expect(isLocalModelBaseUrl('http://[::1]:11434/v1')).toBe(true);
    expect(isLocalModelBaseUrl('http://10.0.0.5:8000/v1')).toBe(true);
    expect(isLocalModelBaseUrl('http://172.16.0.5:8000/v1')).toBe(true);
    expect(isLocalModelBaseUrl('http://172.31.0.5:8000/v1')).toBe(true);
    expect(isLocalModelBaseUrl('http://192.168.1.2:8000/v1')).toBe(true);
    expect(isLocalModelBaseUrl('https://api.vendor.example/v1')).toBe(false);
  });

  it('streams text deltas and emits a final sanitized result', async () => {
    const resolvedModel = model({ provider: 'local-qwen', baseUrl: 'http://localhost:11434/v1' });
    mockedGetDefaultModelSync.mockReturnValue('local-qwen/qwen');
    mockedResolveModel.mockReturnValue(resolvedModel);
    mockedGetApiKey.mockResolvedValue(undefined);

    const finalMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: '```markdown\nhello world\n```' }],
      api: resolvedModel.api,
      provider: resolvedModel.provider,
      model: resolvedModel.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: Date.now(),
    } as const;
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield { type: 'thinking_delta', delta: 'checking tone' };
        yield { type: 'text_delta', delta: '```markdown\nhello ' };
        yield { type: 'text_delta', delta: 'world\n```' };
      },
      result: vi.fn().mockResolvedValue(finalMessage),
    };
    mockedCreateExtensionAwareStreamFn.mockReturnValue(() => stream as never);

    const events = [];
    const generator = streamTextAssist({ input: 'hello', locale: 'en' });
    while (true) {
      const next = await generator.next();
      if (next.done) {
        expect(next.value).toEqual({ text: 'hello world' });
        break;
      }
      events.push(next.value);
    }

    expect(events).toEqual([
      { type: 'start', provider: 'local-qwen', modelId: 'model', scenario: 'generic.text' },
      { type: 'thinking_delta', delta: 'checking tone' },
      { type: 'text_delta', delta: '```markdown\nhello ' },
      { type: 'text_delta', delta: 'world\n```' },
      { type: 'done', text: 'hello world' },
    ]);
  });

  it('does not use thinking content as the final suggestion', async () => {
    const resolvedModel = model({ provider: 'local-qwen', baseUrl: 'http://localhost:11434/v1' });
    mockedGetDefaultModelSync.mockReturnValue('local-qwen/qwen');
    mockedResolveModel.mockReturnValue(resolvedModel);
    mockedGetApiKey.mockResolvedValue(undefined);

    const finalMessage = {
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'private reasoning that should not be shown' }],
      api: resolvedModel.api,
      provider: resolvedModel.provider,
      model: resolvedModel.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: Date.now(),
    } as const;
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield { type: 'thinking_delta', delta: 'private reasoning that should not be shown' };
      },
      result: vi.fn().mockResolvedValue(finalMessage),
    };
    mockedCreateExtensionAwareStreamFn.mockReturnValue(() => stream as never);

    const events = [];
    const generator = streamTextAssist({ input: 'hello', locale: 'en' });
    await expect(async () => {
      while (true) {
        const next = await generator.next();
        if (next.done) break;
        events.push(next.value);
      }
    }).rejects.toThrow('AI returned an empty suggestion');

    expect(events).toEqual([
      { type: 'start', provider: 'local-qwen', modelId: 'model', scenario: 'generic.text' },
      { type: 'thinking_delta', delta: 'private reasoning that should not be shown' },
    ]);
  });
});
