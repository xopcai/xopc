import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { expect, it, vi } from 'vitest';

const scripted = vi.hoisted(() => ({ stream: vi.fn(), fetch: vi.fn() }));
vi.mock('undici', () => ({ Agent: class { async close() {} }, fetch: scripted.fetch }));
vi.mock('../xopc-stream-bridge.js', () => ({ wrapStreamFnForXopcExtensions: () => scripted.stream }));
vi.mock('../model-runtime.js', async () => {
  const { ModelRuntime } = await import('@earendil-works/pi-coding-agent');
  const { InMemoryModelsStore, InMemoryCredentialStore } = await import('@earendil-works/pi-ai');
  return { resolveEmbeddedProviderApiKeySync: () => 'test', createEmbeddedModelRuntime: async () => {
    const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false });
    await runtime.setRuntimeApiKey('openai', 'test');
    return runtime;
  } };
});

import { runXopcEmbeddedTurn } from '../run-turn.js';
import { InMemoryTranscriptRuntime } from '../transcript-runtime.js';
import { evictEmbeddedSessionRunner } from '../session-runner.js';
import { AgentRunCancelledError } from '../../orchestration/run-termination.js';
import { createWebFetchTool } from '../../tools/web.js';

it.each(['stop', 'aborted', 'error', 'deadline', 'user_cancelled', 'exhausted'])('finishes after four concurrent fetch timeouts and model %s', async (modelStop) => {
  const root = await mkdtemp(join(tmpdir(), 'web-timeout-recovery-'));
  const conversationId = crypto.randomUUID();
  const parent = new AbortController();
  const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
  const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => originalTimeout(ms === 25_000 ? 5 : ms));
  let round = 0;
  let active = 0;
  let peak = 0;
  scripted.fetch.mockImplementation(async (url, { signal }) => {
    if (url.includes('/fallback')) return new Response('Verified alternative source', { headers: { 'content-type': 'text/plain' } });
    active++;
    peak = Math.max(peak, active);
    try {
      await new Promise<void>((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    } finally { active--; }
  });
  scripted.stream.mockImplementation((_model, context, options) => {
    const attempt = round++;
    const interrupted = modelStop === 'exhausted' && attempt >= 2 || modelStop !== 'stop' && attempt === 2;
    const pending = (modelStop === 'deadline' || modelStop === 'user_cancelled') && attempt === 2;
    if (attempt === 1) {
      const results = context.messages.filter((message: any) => message.role === 'toolResult');
      expect(results).toHaveLength(4);
      for (const result of results) expect(result.content[0].text).toContain('tool_timeout');
      expect(parent.signal.aborted).toBe(false);
    }
    if (attempt >= 2) expect(context.messages.some((message: any) => message.role === 'toolResult'
      && message.content[0]?.text === 'Verified alternative source')).toBe(true);
    const message = { role: 'assistant', api: 'openai-completions', provider: 'openai', model: 'gpt-4.1',
      content: attempt === 0 ? Array.from({ length: 4 }, (_, index) => ({ type: 'toolCall', id: `raw-${index}`, name: 'web_fetch',
        arguments: { url: `https://raw.githubusercontent.com/example/repo/main/${index}.md` } }))
        : attempt === 1 ? [{ type: 'toolCall', id: 'fallback', name: 'web_fetch', arguments: { url: 'https://github.com/example/fallback' } }]
          : interrupted ? [] : [{ type: 'text', text: 'Research completed using the alternative source.' }],
      stopReason: attempt < 2 ? 'toolUse' : interrupted ? modelStop === 'error' ? 'error' : 'aborted' : 'stop',
      ...(interrupted ? { errorMessage: 'Request was aborted' } : {}), timestamp: Date.now(),
      usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    } as AssistantMessage;
    const stream = createAssistantMessageEventStream();
    if (pending) {
      const abort = () => stream.push({ type: 'error', reason: 'aborted', error: message });
      if (options.signal.aborted) abort();
      else options.signal.addEventListener('abort', abort, { once: true });
      if (modelStop === 'user_cancelled') setTimeout(() => parent.abort(new AgentRunCancelledError()), 5);
    } else if (interrupted) stream.push({ type: 'error', reason: modelStop === 'error' ? 'error' : 'aborted', error: message });
    else stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message });
    return stream;
  });
  try {
    const result = await runXopcEmbeddedTurn({ conversationId, runId: crypto.randomUUID(), workspaceDir: root,
      transcriptRuntime: new InMemoryTranscriptRuntime({ runtimeId: conversationId, cwd: root }),
      userMessage: { role: 'user', content: 'Research MCP authorization.', timestamp: Date.now() },
      systemPrompt: 'Use alternative sources after a fetch timeout.', modelRef: 'openai/gpt-4.1', timeoutMs: modelStop === 'deadline' ? 300 : 10000,
      model: { id: 'gpt-4.1', name: 'Test', provider: 'openai', api: 'openai-completions', baseUrl: 'https://example.invalid', reasoning: false,
        input: ['text'], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      tools: [createWebFetchTool(() => undefined)], abortSignal: parent.signal,
    });
    if (modelStop === 'deadline') {
      expect(result).toMatchObject({ ok: false, terminationReason: 'deadline_exceeded' });
      expect(result.errorMessage).toContain('Agent turn timed out');
    } else if (modelStop === 'user_cancelled') {
      expect(result).toMatchObject({ ok: false, terminationReason: 'user_cancelled', errorMessage: 'aborted' });
    } else if (modelStop === 'exhausted') {
      expect(result).toMatchObject({ ok: false, terminationReason: 'provider_error' });
      expect(result.errorMessage).toContain('Model request was interrupted');
    } else expect(result).toMatchObject({ ok: true, lastAssistantText: 'Research completed using the alternative source.' });
    expect(peak).toBe(4);
    expect(round).toBe(modelStop === 'exhausted' ? 5 : ['stop', 'deadline', 'user_cancelled'].includes(modelStop) ? 3 : 4);
    expect(parent.signal.aborted).toBe(modelStop === 'user_cancelled');
  } finally {
    timeoutSpy.mockRestore();
    evictEmbeddedSessionRunner(conversationId);
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
