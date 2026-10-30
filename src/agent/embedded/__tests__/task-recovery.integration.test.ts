import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, appendFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({ baseUrl: '', fallback: false }));
vi.mock('../model-runtime.js', async () => {
  const { ModelRuntime } = await import('@earendil-works/pi-coding-agent');
  const { InMemoryModelsStore, InMemoryCredentialStore } = await import('@earendil-works/pi-ai');
  return {
    resolveEmbeddedProviderApiKeySync: () => 'test',
    createEmbeddedModelRuntime: async () => {
      const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(),
        modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false });
      runtime.registerProvider('openai', { baseUrl: transport.baseUrl, api: 'openai-completions', apiKey: 'test',
        models: [testModel('gpt-4o-mini'), testModel('gpt-4o')] });
      await runtime.setRuntimeApiKey('openai', 'test');
      return runtime;
    },
  };
});
vi.mock('../../../providers/index.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../providers/index.js')>(),
  resolveModel: (ref: string) => testModel(ref.includes('gpt-4o-mini') ? 'gpt-4o-mini' : 'gpt-4o'),
}));

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';
import { seedTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { onSessionTranscriptUpdate } from '../../../session/transcript-events.js';
import { SessionStore } from '../../../session/store.js';
import { ConfigSchema } from '../../../config/schema.js';
import { runProcessDirectStreaming, type ProcessDirectStreamingDeps } from '../../service/process-direct-streaming.js';
import { runGatewayAgent, type RunGatewayAgentDeps } from '../../../gateway/service/run-gateway-agent.js';
import { evictAllEmbeddedSessionRunners } from '../session-runner.js';
import { createAgentTurnPolicy } from '../../orchestration/agent-turn-policy.js';
import { TaskRunRepository } from '../../../tasks/task-run-repository.js';
import { TaskApplicationService } from '../../../tasks/task-application-service.js';
import { TaskContextRepository } from '../../../tasks/task-context-repository.js';
import { TaskConversationRepository } from '../../../tasks/task-conversation-repository.js';
import { TaskRunDispatcher } from '../../../tasks/task-run-dispatcher.js';
import { SessionInputCoordinator } from '../../../gateway/service/session-input-coordinator.js';
import { insertSessionInput } from '../../../storage/sqlite/session-input-repository.js';
import { claimNextSessionInput } from '../../../storage/sqlite/session-input-repository.js';

function testModel(id = 'gpt-4o-mini') {
  return { id, name: id, provider: 'openai', api: 'openai-completions' as const, baseUrl: transport.baseUrl,
    reasoning: false, input: ['text' as const], contextWindow: 128_000, maxTokens: 4096,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
}

// Exercise HTTP/SSE, pi AgentSession, tool execution, SQLite, direct streaming and Gateway together.
// Only authentication/model discovery are substituted; no Agent or recovery implementation is mocked.
describe('task model recovery over the real execution chain', () => {
  let root: string;
  let server: Server;
  let unsubscribe: () => void;
  let store: SessionStore;
  let mode: 'transient' | 'connection' | 'uncertain_connection' | 'fallback' | 'broken_stream' | 'permanent' | 'cancel' | 'replay' | 'task_retry' | 'uncertain' | 'exhausted' | 'rate_limit' | 'deadline';
  let requests: Array<{ model: string; messages: Array<{ role: string; content: string }> }>;
  let effects: number;
  let controller: AbortController;
  let gateway: RunGatewayAgentDeps;
  let conversationId: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'xopc-http-recovery-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(root, 'xopc.db') });
    seedTestAgentCatalog({ defaults: { models: { chat: { primary: 'openai/gpt-4o-mini', fallbacks: [] }, intents: {} },
      skills: { mode: 'all-enabled', exclude: [] }, tools: {}, runtime: {} },
      agents: [{ id: 'main', enabled: true, workspace: root }] });
    store = new SessionStore({ config: ConfigSchema.parse({}) });
    unsubscribe = onSessionTranscriptUpdate(update => { void store.syncEmbeddedTranscriptUpdate(update); });
    conversationId = createConversation({ agentId: 'main', sourceChannel: 'webchat', sourceChatId: 'test' }).key;
    requests = []; effects = 0; controller = new AbortController(); transport.fallback = false;
    server = createServer(async (req, res) => {
      let body = '';
      for await (const part of req) body += part;
      const payload = JSON.parse(body);
      requests.push(payload);
      const completed = payload.messages.some((message: { role: string; content: string }) => message.role === 'tool'
        && (message.content.includes('effect-confirmed') || message.content.includes('Remote response lost')));
      const first = !completed;
      if (!first && (mode === 'uncertain_connection' || mode === 'connection' && requests.length === 2)) {
        res.destroy(); return;
      }
      if (!first && mode === 'deadline') return;
      if (!first && mode === 'rate_limit' && requests.length === 2) {
        res.writeHead(429, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Too Many Requests' } }));return;
      }
      if (!first && payload.model === 'gpt-4o-mini' && ((mode === 'fallback' || mode === 'replay')
        || (mode === 'transient' && requests.length === 2) || (mode === 'task_retry' && requests.length <= 4)
        || mode === 'uncertain' || mode === 'exhausted')) {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Service Unavailable' } })); return;
      }
      if (!first && mode === 'cancel') { controller.abort(); res.destroy(); return; }
      if (!first && mode === 'permanent') {
        res.writeHead(401, { 'content-type': 'application/json' });res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const replay = mode === 'replay' && payload.model === 'gpt-4o'
        && !payload.messages.some((message: { role: string; content: string }) => message.role === 'tool' && message.content.includes('already completed'));
      const delta = first || replay
        ? { role: 'assistant', tool_calls: [{ index: 0, id: `call-${requests.length}`, type: 'function',
            function: { name: 'confirmed_effect', arguments: '{"value":"one"}' } }] }
        : { role: 'assistant', content: 'All remaining work finished.' };
      res.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', model: payload.model,
        choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      if (!first && mode === 'broken_stream' && requests.length === 2) { res.end(); return; }
      res.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', model: payload.model,
        choices: [{ index: 0, delta: {}, finish_reason: first || replay ? 'tool_calls' : 'stop' }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    transport.baseUrl = `http://127.0.0.1:${address.port}/v1`;
    const effect: AgentTool = { name: 'confirmed_effect', label: 'Effect', description: 'Commit an external effect',
      parameters: Type.Object({ value: Type.String() }), execute: async () => {
        effects += 1;
        await appendFile(join(root, 'effects.log'), 'commit\n');
        if (mode === 'uncertain' || mode === 'uncertain_connection') throw new Error('Remote response lost after effect');
        return { content: [{ type: 'text', text: 'effect-confirmed' }], details: {} };
      } };
    const agentManager = {
      getOrCreateAgent: () => ({ state: { tools: [effect], systemPrompt: 'Finish the task', thinkingLevel: 'off' } }),
      getResolvedWorkspaceForSession: () => root, setModelForSession: () => {}, emitRuntimeEvent: () => {},
      createAgentTurnPolicy: () => createAgentTurnPolicy({}), prepareUserTurnContext: async () => ({ dynamicSystemContext: '' }),
      beginBackgroundReviewUserTurn: () => {}, scheduleBackgroundReviewAfterUserTurn: () => {},
      prepareSkillTurn: (_id: string, text: string) => ({ text, activatedCapabilityNames: [] }),
      withSkillCapabilities: (_id: string, _names: string[], run: () => unknown) => run(),
    };
    const modelManager = {
      getModelForSession: () => 'openai/gpt-4o-mini', getResolvedModelForSession: () => testModel(), applyResolvedModel: () => {},
      getFallbackCandidatesForSession: () => [{ provider: 'openai', model: 'gpt-4o-mini' },
        ...(transport.fallback ? [{ provider: 'openai', model: 'gpt-4o' }] : [])],
    };
    const deps = {
      log: { info: vi.fn(), warn: vi.fn() }, sessionStore: store, agentManager, modelManager, getConfig: () => undefined,
      sessionConfigStore: { get: async () => ({}) },
      resolveSessionEndpoint: async () => ({ channel: 'webchat', chatId: conversationId }), initDirectStreamingSession: () => ({}),
      registerWebchatStreamPublisher: () => {}, unregisterWebchatStreamPublisher: () => {}, endDirectRequestContext: () => {},
      hydrateSessionWorkspaceFromStore: async () => {}, hydrateSessionModelFromStore: async () => {}, applyResolvedThinkingLevel: async () => {},
      prepareInboundAttachments: async () => undefined, buildTranscriptUserMessage: async (content: string) => ({ role: 'user', content, timestamp: Date.now() }),
      maybeEmitWebchatTts: async () => null,
    } as unknown as ProcessDirectStreamingDeps;
    gateway = { config: undefined as never, agentService: {
      resolveUserTimezoneForSession: () => 'UTC', prepareInboundAttachments: async () => undefined, beginInboundTurn: () => {}, endInboundTurn: () => {},
      turnDispatcher: { processDirectStreaming: (content: string, id: string, origin: unknown, _attachments: unknown, _thinking: unknown, options: object) =>
        runProcessDirectStreaming(deps, { content, conversationId: id, origin, ...options } as never) },
      getLastAssistantPlainText: () => '', takeTaskReviewStreamHint: () => undefined,
      outboundCoordinator: { emitSessionTurnComplete: async () => {} },
    }, bus: { publishInbound: async () => {} }, runAbortControllers: new Map(), activeWebchatRunBySession: new Map(), activeExecutionBySession: new Map(),
      sessionIndex: { getSessionMetadata: (id: string) => store.getMetadata(id) }, emit: () => {}, publishRealtime: () => {}, completeRealtimeTopic: () => {},
    } as unknown as RunGatewayAgentDeps;
  });

  afterEach(async () => {
    controller.abort();
    evictAllEmbeddedSessionRunners();unsubscribe();
    server.closeAllConnections();await new Promise<void>(resolve => server.close(() => resolve()));
    closeXopcDatabase();resetXopcDatabaseSingletonForTest();await rm(root, { recursive: true, force: true });
  });

  async function run(options: { runId?: string; taskRunId?: string } = {}) {
    const events = [];const iter = runGatewayAgent(gateway, 'Commit one effect and finish', 'webchat', conversationId,
      { type: 'system', source: 'internal' }, undefined, undefined, { signal: controller.signal, ...options });
    for (;;) { const next = await iter.next();if (next.done) return { events, result: next.value };events.push(next.value); }
  }

  it.each(['transient', 'connection', 'broken_stream', 'fallback', 'replay', 'rate_limit'] as const)('resumes after %s without repeating a confirmed external effect', async scenario => {
    mode = scenario;transport.fallback = scenario === 'fallback' || scenario === 'replay';
    const { events, result } = await run();
    expect(result.status, result.summary).toBe('ok');expect(effects).toBe(1);
    expect(await readFile(join(root, 'effects.log'), 'utf8')).toBe('commit\n');
    expect(events.at(-1)).toMatchObject({ type: 'run_end', payload: { status: 'success' } });
    expect(events.some(event => event.type === 'error')).toBe(false);
    const history = await store.loadTranscriptRows(conversationId);
    expect(history.filter(row => 'role' in row && row.role === 'user')).toHaveLength(1);
    expect(history.some(row => 'type' in row && row.type === 'custom' && row.customType === 'coding_verification')).toBe(true);
    expect(requests.filter(request => request.messages.some(message => message.role === 'tool' && message.content.includes('effect-confirmed'))).length).toBeGreaterThan(1);
  }, 30_000);

  it('reports a terminal authentication failure after partial execution as an error', async () => {
    mode = 'permanent';const { events, result } = await run();
    expect(result.status).toBe('error');expect(effects).toBe(1);expect(requests).toHaveLength(2);
    expect(await readFile(join(root, 'effects.log'), 'utf8')).toBe('commit\n');
    expect(events.at(-1)).toMatchObject({ type: 'run_end', payload: { status: 'error' } });
  }, 15_000);

  it('does not retry or switch models after cancellation', async () => {
    mode = 'cancel';transport.fallback = true;const { events, result } = await run();
    expect(result.status).toBe('aborted');expect(effects).toBe(1);expect(requests).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ type: 'run_end', payload: { status: 'cancelled' } });
  }, 15_000);

  it.each(['uncertain', 'uncertain_connection'] as const)('does not replay an external effect when its result cannot be confirmed: %s', async scenario => {
    mode = scenario;transport.fallback = true;
    const { result } = await run();
    expect(result.status).toBe('error');expect(effects).toBe(1);expect(requests).toHaveLength(2);
  }, 15_000);

  it('preserves the root TaskRun deadline and reports timeout without treating it as user cancellation', async () => {
    mode = 'deadline';transport.fallback = true;
    const created = new TaskApplicationService().create({ idempotencyKey: 'deadline-task', title: 'Finish within deadline',
      priority: 'normal', contract: { objective: 'Commit once', acceptanceCriteria: [], expectedOutputs: [], constraints: [], assumptions: [],
        risks: [], approvalRequired: [], acceptancePolicy: 'verified_auto', outputDestinations: [] }, dependencies: [], context: [],
      authorityGrants: [], activation: { mode: 'start', executor: { kind: 'agent', agentId: 'main' } } });
    if (!created.ok || !created.runId) throw new Error('Expected TaskRun');
    const runs = new TaskRunRepository();const queued = runs.require(created.runId);
    new TaskConversationRepository().activateExecutionSession({ taskId: queued.taskId, runId: queued.id, conversationId, agentId: 'main' });
    const snapshot = new TaskContextRepository().captureSnapshot({ ownerKind: 'task_run', ownerId: queued.id, query: 'deadline' });
    const deadline = Date.now() + 1500;
    runs.start({ runId: queued.id, expectedVersion: queued.version, contextSnapshotId: snapshot.id, policySnapshot: {}, conversationId, timeoutAt: deadline });
    const executionId = crypto.randomUUID();
    insertSessionInput({ id: crypto.randomUUID(), conversationId, clientMessageId: 'deadline-input', requestedDelivery: 'next',
      effectiveDelivery: 'next', status: 'queued', content: 'Commit once', origin: { type: 'system', source: 'task' }, taskRunId: queued.id });
    claimNextSessionInput(conversationId, executionId);
    const { result, events } = await run({ runId: executionId, taskRunId: queued.id });
    expect(result).toMatchObject({ status: 'error', summary: 'Agent run deadline expired' });
    expect(events.at(-1)).toMatchObject({ type: 'run_end', payload: { status: 'error' } });
    expect(effects).toBe(1);expect(requests).toHaveLength(2);
    expect(runs.require(queued.id).timeoutAt).toBe(deadline);
    expect(runs.require(queued.id).policySnapshot.continuationAttempts).toBeUndefined();
  }, 15_000);

  it.each(['task_retry', 'exhausted'] as const)('handles %s through the dispatcher and durable input queue without replay', async scenario => {
    mode = scenario;
    const created = new TaskApplicationService().create({ idempotencyKey: 'recovery-task', title: 'Commit once',
      priority: 'normal', contract: { objective: 'Commit once and finish', acceptanceCriteria: [], expectedOutputs: [],
        constraints: [], assumptions: [], risks: [], approvalRequired: [], acceptancePolicy: 'verified_auto', outputDestinations: [] },
      dependencies: [], context: [], authorityGrants: [], activation: { mode: 'start', executor: { kind: 'agent', agentId: 'main' } } });
    if (!created.ok || !created.runId) throw new Error('TaskRun was not created');
    const runs = new TaskRunRepository();const runId = created.runId;
    new TaskConversationRepository().activateExecutionSession({ taskId: created.model.task.id, runId, conversationId, agentId: 'main' });
    const coordinator = new SessionInputCoordinator({ sessionExists: async () => true, emit: () => {},
      prepareAttachments: async () => undefined, prepareContexts: async () => [], steer: async () => false,
      execute: async input => {
        const stream = runGatewayAgent(gateway, input.content, 'webchat', input.conversationId, input.origin,
          undefined, undefined, { runId: input.runId, taskRunId: input.taskRunId });
        for (;;) { const next = await stream.next();if (next.done) return next.value; }
      } });
    const dispatcher = new TaskRunDispatcher({ workerId: 'regression', maxConcurrency: 1,
      ensureSession: async () => conversationId, runAgent: async (id, conversation, content) => {
        const clientMessageId = runs.nextAgentInputClientMessageId(id);
        insertSessionInput({ id: crypto.randomUUID(), conversationId: conversation, clientMessageId,
          expectedTranscriptId: (await store.getMetadata(conversation))!.transcriptId, requestedDelivery: 'next',
          effectiveDelivery: 'next', status: 'queued', content, origin: { type: 'system', source: 'task' }, taskRunId: id });
        void coordinator.drain(conversation);
        await coordinator.waitForCompletion(conversation, clientMessageId);
      } });
    try { await dispatcher.drain(); } finally { dispatcher.stop(); }
    expect(effects).toBe(1);
    expect(await readFile(join(root, 'effects.log'), 'utf8')).toBe('commit\n');
    expect(runs.listByTask(created.model.task.id)).toHaveLength(1);
    expect(runs.require(runId)).toMatchObject({ status: scenario === 'task_retry' ? 'succeeded' : 'failed',
      policySnapshot: { continuationAttempts: scenario === 'task_retry' ? 1 : 2 } });
    expect(runs.getReceipt(runId)?.status).toBe(scenario === 'task_retry' ? 'succeeded' : 'failed');
    expect(requests).toHaveLength(scenario === 'task_retry' ? 5 : 10);
    expect((await store.loadTranscriptRows(conversationId)).filter(row => 'role' in row && row.role === 'user')).toHaveLength(1);
  }, 30_000);
});
