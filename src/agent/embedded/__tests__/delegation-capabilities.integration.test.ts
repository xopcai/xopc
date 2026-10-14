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
import { cloudCreditBudgetHeaders, reportCloudCreditError, withCloudCreditBudget } from '../../../providers/xopc-cloud-credit-budget.js';

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

it.each(['tokens', 'cancel'] as const)('does not start a summary after a hard stop: %s', async (stop) => {
  const root = await mkdtemp(join(tmpdir(), 'delegate-hard-stop-'));
  const controller = new AbortController();
  const read = vi.fn(async () => {
    controller.abort();
    return { content: [{ type: 'text' as const, text: 'Partial evidence' }], details: {} };
  });
  let rounds = 0;
  scripted.stream.mockImplementation(() => {
    rounds++;
    const message: AssistantMessage = { role: 'assistant', api: 'openai-completions', provider: 'openai', model: model.id,
      content: [{ type: 'toolCall', id: 'read', name: 'read_file', arguments: {} }], stopReason: 'toolUse', timestamp: Date.now(),
      usage: { input: stop === 'tokens' ? 100000 : 100, output: 100, cacheRead: 0, cacheWrite: 0,
        totalTokens: stop === 'tokens' ? 100100 : 200, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: 'done', reason: 'toolUse', message });
    return stream;
  });
  const tool = createDelegateTool({ workspace: root, bus: {} as MessageBus, getConfig: () => undefined,
    getSubagentModel: () => model, buildChildTools: () => [],
    getParentTools: () => [{ name: 'read_file', label: 'Read', description: 'Read', parameters: Type.Object({}), execute: read }],
  });
  try {
    const result = await tool.execute('delegate', { goal: 'Inspect files' }, controller.signal);
    expect(rounds).toBe(1);
    expect(read).toHaveBeenCalledTimes(stop === 'tokens' ? 0 : 1);
    expect(result.details).toMatchObject({ stopReason: stop === 'tokens' ? 'total_tokens' : 'parent_cancelled',
      handoff: { requested: false, completed: false } });
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20000);

it.each(['handoff', 'credit', 'retry'] as const)('retains parent Credit scope and bounds handoff dispatch (%s)', async (scenario) => {
  const exhaustCredit = scenario === 'credit';
  const root = await mkdtemp(join(tmpdir(), 'delegate-handoff-'));
  const read = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'file.ts:12: discovered evidence' }], details: {} }));
  const createBudget = vi.fn(async () => ({ id: 'shared-budget' } as any));
  let round = 0;
  const headers: Record<string, string>[] = [];
  const tool = createDelegateTool({ workspace: root, bus: {} as MessageBus, getConfig: () => undefined,
    getSubagentModel: () => model,
    getParentTools: () => [{ name: 'read_file', label: 'Read', description: 'Read', parameters: Type.Object({}), execute: read }],
    buildChildTools: () => [],
  });
  scripted.stream.mockImplementation((_model, context) => {
    round++;
    const handoff = context.messages.some((message: any) => message.role === 'user'
      && JSON.stringify(message.content).includes('Delegation budget is approaching'));
    if (round === 2) expect(handoff).toBe(true);
    const content: AssistantMessage['content'] = handoff
      ? [{ type: 'text', text: 'Found file.ts:12. Remaining: inspect its callers. Next: search inbound references.' }]
      : [{ type: 'toolCall', id: `read-${round}`, name: 'read_file', arguments: {} }];
    const message: AssistantMessage = { role: 'assistant', api: 'openai-completions', provider: 'openai', model: model.id,
      content, stopReason: handoff ? 'stop' : 'toolUse', timestamp: Date.now(),
      usage: { input: handoff ? 100 : 85000, output: 100, cacheRead: 0, cacheWrite: 0,
        totalTokens: handoff ? 200 : 85100, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const stream = createAssistantMessageEventStream();
    if (handoff && scenario === 'retry') {
      stream.push({ type: 'error', reason: 'error', error: {
        ...message, content: [], stopReason: 'error', errorMessage: 'fetch failed',
      } });
    } else stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message });
    return stream;
  });
  read.mockImplementation(async () => {
    headers.push(await cloudCreditBudgetHeaders({ createBudget }));
    if (exhaustCredit) reportCloudCreditError('credit_budget_exhausted');
    return { content: [{ type: 'text' as const, text: 'file.ts:12: discovered evidence' }], details: {} };
  });
  try {
    const result = await withCloudCreditBudget({ conversationId: 'parent', runId: 'run', limitCreditMicro: '1000000' }, async () => {
      headers.push(await cloudCreditBudgetHeaders({ createBudget }));
      return tool.execute('delegate', { goal: 'Research callers', budgetTier: 'standard' });
    });
    if (exhaustCredit) {
      expect(result.details).toMatchObject({ status: 'failed', stopReason: 'credit_budget',
        budget: { usage: { totalTokens: 85100, modelTurns: 1 } }, handoff: { requested: false, completed: false } });
    } else if (scenario === 'retry') {
      expect(result.details).toMatchObject({ status: 'failed', stopReason: 'total_tokens',
        handoff: { requested: true, completed: false, summary: expect.stringContaining('Delegation stopped: total_tokens.') } });
      expect((result.details as any).summary).not.toContain('fetch failed');
    } else {
      expect(result.details).toMatchObject({ status: 'partial', stopReason: 'total_tokens', iterations: 1,
        budget: { tier: 'standard', usage: { totalTokens: 85300, modelTurns: 2 } },
        handoff: { requested: true, completed: true, summary: expect.stringContaining('Next: search inbound references') } });
    }
    expect(round).toBe(exhaustCredit ? 1 : 2);
    expect(read).toHaveBeenCalledTimes(1);
    expect(headers).toEqual([{ 'x-xopc-credit-budget': 'shared-budget' }, { 'x-xopc-credit-budget': 'shared-budget' }]);
    expect(createBudget).toHaveBeenCalledTimes(1);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20000);
