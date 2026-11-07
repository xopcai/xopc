import { mkdtemp, rm } from 'node:fs/promises';
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

import { seedTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest, ensureSessionRecord,
  insertSessionInput, claimNextSessionInput } from '../../../storage/sqlite/index.js';
import { runXopcEmbeddedTurn } from '../run-turn.js';
import { InMemoryTranscriptRuntime } from '../transcript-runtime.js';
import { evictEmbeddedSessionRunner } from '../session-runner.js';

it('executes a generated native voice instruction through the real AgentSession without persisting owner speech', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-voice-task-'));
  const conversationId = crypto.randomUUID();
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' });
  seedTestAgentCatalog({ agents: [{ id: 'main', enabled: true, workspace: root }] });
  const runtime = new InMemoryTranscriptRuntime({ runtimeId: conversationId, cwd: root });
  try {
    ensureSessionRecord(conversationId, root, { agentId: 'main', sourceChannel: 'webchat', sessionType: 'chat' });
    insertSessionInput({ id: crypto.randomUUID(), conversationId, clientMessageId: 'voice-action:call:tool',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'Summarize the task',
      origin: { type: 'channel', channel: 'voice' } });
    const input = claimNextSessionInput(conversationId, crypto.randomUUID())!;
    scripted.stream.mockImplementation((_model, context) => {
      expect(JSON.stringify(context.messages)).toContain('Summarize the task');
      const message: AssistantMessage = { role: 'assistant', api: 'openai-completions', provider: 'openai', model: 'gpt-4.1',
        content: [{ type: 'text', text: 'Task completed.' }], stopReason: 'stop', timestamp: Date.now(),
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'done', reason: 'stop', message });
      return stream;
    });
    const result = await runXopcEmbeddedTurn({ conversationId, runId: input.runId!, workspaceDir: root,
      transcriptRuntime: runtime, voiceHistoryTokens: 4000, userMessage: { role: 'user', content: input.content, timestamp: Date.now() },
      systemPrompt: 'Summarize briefly.', modelRef: 'openai/gpt-4.1', timeoutMs: 10000, tools: [],
      model: { id: 'gpt-4.1', name: 'Test', provider: 'openai', api: 'openai-completions', baseUrl: 'https://example.invalid',
        reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } });
    expect(result).toMatchObject({ ok: true, lastAssistantText: 'Task completed.' });
    const entries = runtime.openSessionManager(root).getEntries();
    expect(entries).toContainEqual(expect.objectContaining({ type: 'custom_message', customType: 'voice_agent_instruction',
      content: 'Summarize the task', display: false }));
    expect(entries.some(entry => entry.type === 'message' && entry.message.role === 'user')).toBe(false);
  } finally {
    evictEmbeddedSessionRunner(conversationId); closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
