import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { expect, it, vi } from 'vitest';

const scripted = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock('../xopc-stream-bridge.js', () => ({ wrapStreamFnForXopcExtensions: () => scripted.stream }));
vi.mock('../model-runtime.js', async () => {
  const { ModelRuntime } = await import('@earendil-works/pi-coding-agent');
  const { InMemoryModelsStore, InMemoryCredentialStore } = await import('@earendil-works/pi-ai');
  return {
    resolveEmbeddedProviderApiKeySync: () => 'test',
    createEmbeddedModelRuntime: async () => {
      const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false });
      await runtime.setRuntimeApiKey('openai', 'test');
      return runtime;
    },
  };
});

import { runXopcEmbeddedTurn } from '../run-turn.js';
import { InMemoryTranscriptRuntime } from '../transcript-runtime.js';
import { evictEmbeddedSessionRunner } from '../session-runner.js';
import { abortEmbeddedRun, getEmbeddedRunByConversationId, reserveEmbeddedRunCancellation } from '../runs.js';
import { createReadFileTool } from '../../tools/read.js';
import { AgentRunCancelledError } from '../../orchestration/run-termination.js';

it.each(['execution', 'parent', 'dispatch'] as const)('prevents model and tool execution when %s cancellation arrives during attached startup', async source => {
  const root = await mkdtemp(join(tmpdir(), 'cancel-startup-'));
  const conversationId = crypto.randomUUID();
  const runId = 'cancelled-startup';
  const control = reserveEmbeddedRunCancellation({ conversationId, runId });
  const parent = new AbortController();
  const runtime = new InMemoryTranscriptRuntime({ runtimeId: conversationId, cwd: root });
  const load = runtime.loadMessages.bind(runtime);
  let cancelled = false;
  const addEventListener = AbortSignal.prototype.addEventListener;
  const listenerSpy = source === 'dispatch' ? vi.spyOn(AbortSignal.prototype, 'addEventListener')
    .mockImplementation(function (this: AbortSignal, type, listener, options) {
      addEventListener.call(this, type, listener, options);
      if (type === 'abort' && typeof listener === 'function' && listener.name === 'abortListener') {
        // Cancel after listener registration, before the deferred turn callback starts.
        queueMicrotask(() => {
          cancelled = true;
          parent.abort(new AgentRunCancelledError('Cancelled before turn dispatch', 'user_cancelled'));
        });
      }
    }) : undefined;
  runtime.loadMessages = async () => {
    if (source !== 'dispatch' && !cancelled && getEmbeddedRunByConversationId(conversationId)) {
      cancelled = true;
      if (source === 'execution') await abortEmbeddedRun(conversationId, 'user_cancelled', runId);
      else parent.abort(new AgentRunCancelledError('Cancelled during startup', 'user_cancelled'));
    }
    return load();
  };
  const read = createReadFileTool(root);
  const execute = vi.spyOn(read, 'execute');
  let round = 0;
  scripted.stream.mockReset().mockImplementation(() => {
    const first = round++ === 0;
    const message = { role: 'assistant', api: 'openai-completions', provider: 'openai', model: 'gpt-4.1',
      content: first ? [{ type: 'toolCall', id: 'read', name: 'read_file', arguments: { path: 'note.md' } }]
        : [{ type: 'text', text: 'Completed new run.' }],
      stopReason: first ? 'toolUse' : 'stop', timestamp: Date.now(),
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    } as AssistantMessage;
    const stream = createAssistantMessageEventStream();
    stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message });
    return stream;
  });
  const params = { conversationId, workspaceDir: root, transcriptRuntime: runtime,
    userMessage: { role: 'user' as const, content: 'Read note.md.', timestamp: Date.now() },
    systemPrompt: 'Read the note.', modelRef: 'openai/gpt-4.1', timeoutMs: 10000,
    model: { id: 'gpt-4.1', name: 'Test', provider: 'openai', api: 'openai-completions' as const,
      baseUrl: 'https://example.invalid', reasoning: false, input: ['text' as const], contextWindow: 128000,
      maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }, tools: [read] };
  try {
    await writeFile(join(root, 'note.md'), 'New run evidence.');
    const result = await runXopcEmbeddedTurn({ ...params, runId,
      abortSignal: AbortSignal.any([control.signal, parent.signal]) });
    expect(cancelled).toBe(true);
    expect(result).toMatchObject({ ok: false, terminationReason: 'user_cancelled' });
    expect(scripted.stream).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(getEmbeddedRunByConversationId(conversationId)).toBeUndefined();
    listenerSpy?.mockRestore();
    control.release();
    runtime.loadMessages = load;
    const next = reserveEmbeddedRunCancellation({ conversationId, runId: 'new-startup' });
    try {
      expect(await abortEmbeddedRun(conversationId, 'user_cancelled', runId)).toBe(false);
      expect(next.signal.aborted).toBe(false);
      const result = await runXopcEmbeddedTurn({ ...params, runId: 'new-startup', abortSignal: next.signal });
      expect(result).toMatchObject({ ok: true, lastAssistantText: 'Completed new run.' });
      expect(scripted.stream).toHaveBeenCalledTimes(2);
      expect(execute).toHaveBeenCalledOnce();
    } finally { next.release(); }
  } finally {
    listenerSpy?.mockRestore();
    control.release();
    evictEmbeddedSessionRunner(conversationId);
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
