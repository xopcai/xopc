import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Type } from '@sinclair/typebox';
import {
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  getCurrentTools,
  type AssistantMessage,
  type Model,
  type Api,
} from '@earendil-works/pi-ai';
import { expect, it, vi } from 'vitest';

const scripted = vi.hoisted(() => ({ stream: vi.fn() }));
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
import { createDelegateTool } from '../../tools/delegate-tool.js';
import { createAgentTurnPolicy } from '../../orchestration/agent-turn-policy.js';
import type { MessageBus } from '../../../infra/bus/index.js';

const model: Model<Api> = { id: 'gpt-4.1', name: 'Test', provider: 'openai', api: 'openai-completions',
  baseUrl: 'https://example.invalid', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };

it('runs research through real parent and child sessions with shared parent call limits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'delegate-capabilities-'));
  const conversationId = crypto.randomUUID();
  const search = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'Evidence: official release September 20' }], details: {} }));
  const parentPolicy = createAgentTurnPolicy({ maxTurns: 10,
    resolveToolLimit: name => name === 'web_search' ? { id: name, maxCalls: 1 } : undefined });
  const childRounds = new Map<string, number>();
  let parentRound = 0;
  const tools: any[] = [{ name: 'web_search', label: 'Search', description: 'Search', parameters: Type.Object({ query: Type.String() }), execute: search }];
  tools.push(createDelegateTool({ workspace: root, bus: {} as MessageBus, getConfig: () => undefined,
    getSubagentModel: () => model, getParentTools: () => { throw new Error('Must use current run tools'); },
    buildChildTools: () => { throw new Error('Read tools must retain their parent scope'); } }));
  scripted.stream.mockImplementation((_model, context) => {
    const isChild = getCurrentSystemPrompt(context.messages).includes('# Subagent Context');
    let content: AssistantMessage['content'];
    if (isChild) {
      expect(getCurrentTools(context.messages).map(tool => tool.name)).toEqual(['web_search']);
      const task = context.messages.find((message: any) => message.role === 'user')?.content;
      const key = JSON.stringify(task);
      const round = childRounds.get(key) ?? 0;
      childRounds.set(key, round + 1);
      content = round === 0 ? [{ type: 'toolCall', id: `search-${childRounds.size}`, name: 'web_search', arguments: { query: key } }]
        : [{ type: 'text', text: 'Research finished using available evidence.' }];
    } else {
      parentRound++;
      content = parentRound <= 2 ? [{ type: 'toolCall', id: `delegate-${parentRound}`, name: 'delegate_task', arguments: { goal: `Research ${parentRound}` } }]
        : [{ type: 'text', text: 'Research completed.' }];
    }
    const message: AssistantMessage = { role: 'assistant', api: 'openai-completions', provider: 'openai', model: model.id,
      content, stopReason: content[0]?.type === 'toolCall' ? 'toolUse' : 'stop', timestamp: Date.now(),
      usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message });
    return stream;
  });
  try {
    const result = await runXopcEmbeddedTurn({ conversationId, runId: 'parent-run', workspaceDir: root,
      model, modelRef: 'openai/gpt-4.1', tools, systemPrompt: 'Delegate two independent research tasks.',
      userMessage: { role: 'user', content: 'Research two topics', timestamp: Date.now() },
      transcriptRuntime: new InMemoryTranscriptRuntime({ runtimeId: conversationId, cwd: root }),
      turnPolicy: parentPolicy, timeoutMs: 15000 });
    expect(result).toMatchObject({ ok: true, lastAssistantText: 'Research completed.' });
    expect(childRounds.size).toBe(2);
    expect(search).toHaveBeenCalledTimes(1);
  } finally { evictEmbeddedSessionRunner(conversationId); await rm(root, { recursive: true, force: true }); }
}, 20000);
