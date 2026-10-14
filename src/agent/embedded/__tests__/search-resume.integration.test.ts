import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAssistantMessageEventStream, type AssistantMessage, type Model, type Api } from '@earendil-works/pi-ai';
import { expect, it, vi } from 'vitest';

const scripted = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock('../xopc-stream-bridge.js', () => ({ wrapStreamFnForXopcExtensions: () => scripted.stream }));
vi.mock('../model-runtime.js', async () => {
  const { ModelRuntime } = await import('@earendil-works/pi-coding-agent');
  const { InMemoryModelsStore, InMemoryCredentialStore } = await import('@earendil-works/pi-ai');
  return { resolveEmbeddedProviderApiKeySync: () => 'test', createEmbeddedModelRuntime: async () => {
    const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false });
    await runtime.setRuntimeApiKey('openai', 'test'); return runtime;
  } };
});

import { createDelegateTool } from '../../tools/delegate-tool.js';
import { createWebSearchTool } from '../../tools/web.js';
import { closeXopcDatabase, ensureSessionRecord, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';
import { getResearchCheckpoint } from '../../../storage/sqlite/research-checkpoint-repository.js';
import type { Config } from '../../../config/schema.js';

it('reuses persisted successful searches across real research child sessions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'search-resume-'));
  const conversationId = crypto.randomUUID();
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' });
  ensureSessionRecord(conversationId, root, { agentId: 'main' });
  const fetch = vi.fn(async () => Response.json({ web: { results: [{ title: 'Official price', url: 'https://example.com/pricing', description: 'Contact sales' }] } }));
  vi.stubGlobal('fetch', fetch);
  const model: Model<Api> = { id: 'gpt-4.1', name: 'Test', provider: 'openai', api: 'openai-completions', baseUrl: 'https://example.invalid', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const query = 'Vendor official pricing';
  const responses: AssistantMessage['content'][] = [
    [{ type: 'toolCall', id: 'search-1', name: 'web_search', arguments: { query, count: 5 } }],
    [{ type: 'toolCall', id: 'save-1', name: 'research_checkpoint', arguments: { findings: [{ id: 'price', subject: 'Vendor', field: 'price', status: 'not_disclosed', conclusion: 'Contact sales', sources: [{ url: 'https://example.com/pricing', title: 'Pricing' }] }], nextSteps: ['Compile evidence'] } }],
    [{ type: 'text', text: 'Collected pricing evidence; compile the final answer.' }],
    [{ type: 'toolCall', id: 'search-2', name: 'web_search', arguments: { query, count: 5 } }],
    [{ type: 'toolCall', id: 'save-2', name: 'research_checkpoint', arguments: { findings: [], nextSteps: [] } }],
    [{ type: 'text', text: 'Pricing requires contacting sales.' }],
  ];
  scripted.stream.mockImplementation(() => {
    const content = responses.shift();
    if (!content) throw new Error('Unexpected extra model request');
    const message = { role: 'assistant', api: 'openai-completions', provider: 'openai', model: 'gpt-4.1', content,
      stopReason: content.some(block => block.type === 'toolCall') ? 'toolUse' : 'stop', timestamp: Date.now(),
      usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    } as AssistantMessage;
    const stream = createAssistantMessageEventStream(); stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message }); return stream;
  });
  const search = createWebSearchTool(() => ({ tools: { web: { search: { providers: [{ type: 'brave', apiKey: 'test' }] } } } }) as Config);
  const delegate = createDelegateTool({ workspace: root, getCurrentContext: () => ({ conversationId }), getConfig: () => undefined,
    getSubagentModel: () => model, bus: {} as any, getParentTools: () => [search], buildChildTools: () => [],
  });
  try {
    const first = await delegate.execute('first', { goal: 'Research Vendor pricing', maxAttempts: 1 });
    expect(first.details, first.content).toMatchObject({ status: 'partial', checkpoint: { searches: [expect.objectContaining({ query })] } });
    const capturedAt = first.details.checkpoint.searches[0].capturedAt;
    const second = await delegate.execute('second', { goal: 'Research Vendor pricing', resumeId: first.details.resumeId, maxAttempts: 1 });
    expect(second.details, second.content).toMatchObject({ status: 'success' });
    expect(fetch).toHaveBeenCalledOnce();
    expect(getResearchCheckpoint(first.details.resumeId, conversationId, root)?.checkpoint.searches?.[0]?.capturedAt).toBe(capturedAt);
    expect(responses).toHaveLength(0);
  } finally { vi.unstubAllGlobals(); closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); await rm(root, { recursive: true, force: true }); }
}, 20_000);
