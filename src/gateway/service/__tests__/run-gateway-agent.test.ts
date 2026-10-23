import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const latencyLogs = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock('../../../utils/logger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/logger.js')>();
  return { ...actual, createLogger: (prefix: string) => {
    const logger = actual.createLogger(prefix);
    if (prefix === 'Gateway:Service') logger.info = latencyLogs.info;
    return logger;
  } };
});

import {
  closeXopcDatabase,
  ensureSessionRecord,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../storage/sqlite/index.js';
import { runGatewayAgent, type RunGatewayAgentDeps } from '../run-gateway-agent.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import { personalAgentId } from '../../../personal-agent/repository.js';
import { AgentCatalogRepository } from '../../../agent-catalog/repository.js';
import { GatewayAgentRunner } from '../agent-runner.js';
import { TaskCreateRequestSchema } from '@xopcai/gateway-contract';
import { TaskApplicationService } from '../../../tasks/task-application-service.js';
import { defineTaskContract } from '../../../tasks/task-contract-definition.js';
import { TaskRepository } from '../../../tasks/task-repository.js';
import { TaskRunCoordinator } from '../../../tasks/task-run-coordinator.js';
import { TaskConversationRepository } from '../../../tasks/task-conversation-repository.js';
import { TaskRunRepository } from '../../../tasks/task-run-repository.js';
import { insertSessionInput, claimNextSessionInput, finishSessionInputRun, getSessionInputState } from '../../../storage/sqlite/session-input-repository.js';
import { requireSessionConnection, getConnectionWait, updateConnectionWait, queueConnectionResolution } from '../../../storage/sqlite/connection-wait-repository.js';
import { resolveConnectionCandidate } from '../../../connectors/connection-candidates.js';

describe('runGatewayAgent', () => {
  let stateDir: string;

  beforeEach(() => {
    latencyLogs.info.mockClear();
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-gateway-agent-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    ensureSessionRecord("d3dcfc3b-3238-4056-8feb-c95014705996", stateDir, { agentId: "main" });
    ensureSessionRecord("1f0d2f37-a857-4724-82d9-3eee13a09dff", stateDir, { agentId: "main" });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it.each(['heartbeat', 'automation', 'internal', 'task_update'] as const)(
    'uses the actual %s input origin instead of user-like session metadata when starting a task turn', async source => {
      const conversationId = 'd3dcfc3b-3238-4056-8feb-c95014705996';
      const catalog = new AgentCatalogRepository();
      catalog.ensureInitialized();
      if (!catalog.get('main')) catalog.create({ id: 'main', profile: { name: 'Main' } }, { ready: true });
      catalog.markProvisioned('main');
      const created = new TaskApplicationService().create(TaskCreateRequestSchema.parse({
        idempotencyKey: 'gateway-origin-task', title: 'Origin task', contract: { ...defineTaskContract('Work'), acceptancePolicy: 'manual', outputDestinations: [] },
        activation: { mode: 'capture', phase: 'ready' } }));
      if (!created.ok) throw new Error('Expected task');
      const taskId = created.model.task.id;
      new TaskConversationRepository().activateExecutionSession({ taskId, conversationId, agentId: 'main' });
      new TaskApplicationService().execute({ taskId, expectedVersion: created.model.task.version,
        idempotencyKey: 'gateway-origin-move', command: { type: 'move', phase: 'backlog' } });
      const tasks = new TaskRepository();
      const before = tasks.require(taskId);
      const start = vi.spyOn(TaskRunCoordinator, 'start');
      try {
        const deps = {
          config: {}, agentService: {
            resolveUserTimezoneForSession: () => 'UTC', prepareInboundAttachments: async () => undefined,
            beginInboundTurn: () => {}, endInboundTurn: () => {},
            turnDispatcher: { processDirectStreaming: async function* () {} },
            getLastAssistantPlainText: () => '', takeTaskReviewStreamHint: () => undefined,
            outboundCoordinator: { emitSessionTurnComplete: async () => {} },
          }, bus: { publishInbound: async () => {} }, runAbortControllers: new Map(),
          activeWebchatRunBySession: new Map(), activeExecutionBySession: new Map(),
          sessionIndex: { getSessionMetadata: async () => ({ transcriptId: 'origin-transcript', customData: { triggerKind: 'user' } }),
            updateSessionMetadata: async () => {}, appendTranscriptCustomEntry: async () => {} },
          emit: () => {}, publishRealtime: () => {}, completeRealtimeTopic: () => {},
        } as unknown as RunGatewayAgentDeps;
        for await (const _event of runGatewayAgent(deps, 'Background update', 'webchat', conversationId,
          { type: 'system', source }, undefined, undefined, { runId: `gateway-${source}` })) { /* Drain the turn. */ }
        expect(start).toHaveBeenCalledWith(expect.objectContaining({ inputOrigin: { type: 'system', source },
          context: expect.objectContaining({ taskId, triggerKind: 'user' }) }));
        expect(tasks.require(taskId)).toEqual(before);
        expect(tasks.automaticStartAllowed(taskId)).toBe(false);
        expect(new TaskRunRepository().listByTask(taskId)).toEqual([]);
      } finally { start.mockRestore(); }
    });

  it('honors Task cancellation during metadata startup and runs the next message only once', async () => {
    const conversationId = 'd3dcfc3b-3238-4056-8feb-c95014705996';
    const task = new TaskApplicationService().create(TaskCreateRequestSchema.parse({ idempotencyKey: 'startup-task',
      title: 'Read Slack', body: 'Read Slack', originConversationId: conversationId,
      contract: { ...defineTaskContract('Read Slack'), acceptancePolicy: 'manual', outputDestinations: [] },
      activation: { mode: 'start', executor: { kind: 'agent', agentId: 'main' } } }));
    if (!task.ok || !task.runId) throw new Error('Task fixture must start');
    insertSessionInput({ id: 'startup-origin', conversationId, clientMessageId: 'startup-origin', taskRunId: task.runId,
      content: 'Read Slack', requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', origin: { type: 'channel', channel: 'webchat' } });
    claimNextSessionInput(conversationId, 'startup-origin-run');
    const required = requireSessionConnection({ conversationId, principalId: 'local-owner', agentId: 'main',
      summary: 'Read Slack', needs: [resolveConnectionCandidate('composio-slack')] });
    finishSessionInputRun(conversationId, 'startup-origin-run', 'suspended');
    const wait = getConnectionWait(required.waitId!)!;
    queueConnectionResolution(updateConnectionWait({ ...wait, intent: { objectiveRevision: wait.objectiveRevision,
      validUntil: Date.now() + 60_000 } }, wait.version), 'continued');
    let releaseMetadata!: () => void;
    const metadataGate = new Promise<void>(resolve => { releaseMetadata = resolve; });
    let calls = 0;
    const process = vi.fn(async function* () {});
    const runner = new GatewayAgentRunner({ getConfig: () => ({}),
      getAgentService: () => ({ resolveUserTimezoneForSession: () => 'UTC', prepareInboundAttachments: async () => [],
        sessionStore: { idleCompaction: { interrupt: () => {} } }, beginInboundTurn: () => {}, endInboundTurn: () => {},
        turnDispatcher: { processDirectStreaming: process }, getLastAssistantPlainText: () => '', takeTaskReviewStreamHint: () => undefined,
        outboundCoordinator: { emitSessionTurnComplete: async () => {} } }),
      sessionIndex: { getSessionMetadata: async () => { if (++calls === 1) await metadataGate; return { transcriptId: wait.transcriptId }; },
        updateSessionMetadata: async () => {}, appendTranscriptContextEntry: async () => {}, appendTranscriptCustomEntry: async () => {} },
      emit: () => {}, publishRealtime: () => {}, completeRealtimeTopic: () => {}, bus: { publishInbound: async () => {} },
    } as never);
    const draining = runner.inputs.drain(conversationId);
    try {
      await vi.waitFor(() => expect(calls).toBe(1));
      const send = (content: string) => runner.submitSessionInput({ conversationId, clientMessageId: content, content,
        delivery: 'next', origin: { type: 'channel', channel: 'webchat' } });
      await send('取消这个目标');
      await send('Another question');
      expect(process).not.toHaveBeenCalled();
      releaseMetadata();
      await draining;
      await runner.inputs.waitForCompletion(conversationId, 'Another question');
      expect(process).toHaveBeenCalledOnce();
      expect(getConnectionWait(wait.id)?.resolution).toBe('cancelled');
      expect(new TaskRunRepository().get(task.runId)?.status).toBe('cancelled');
      runner.recoverSessionInputs();
      await runner.inputs.drain(conversationId);
      expect(process).toHaveBeenCalledOnce();
      expect(getSessionInputState(conversationId).activeRunId).toBeUndefined();
    } finally { releaseMetadata(); await draining; runner.disposeClarifications(); }
  });

  it('coalesces thinking bursts before realtime publication', async () => {
    const conversationId = "d3dcfc3b-3238-4056-8feb-c95014705996";
    const broadcastEvents: Array<{ event?: { type?: string } }> = [];
    const deps = {
      config: {},
      agentService: {
        resolveUserTimezoneForSession: () => 'UTC',
        prepareInboundAttachments: async () => undefined,
        beginInboundTurn: () => {},
        turnDispatcher: {
          processDirectStreaming: async function* () {
            const message = { role: 'assistant', content: [] };
            yield { type: 'message_start', message };
            for (const delta of [' ', '30', '-minute', ' plan', '.']) {
              yield {
                type: 'message_update',
                message,
                assistantMessageEvent: { type: 'thinking_delta', delta },
              };
            }
            yield { type: 'message_end', message };
          },
        },
        getLastAssistantPlainText: () => '',
        takeTaskReviewStreamHint: () => undefined,
        outboundCoordinator: { emitSessionTurnComplete: async () => {} },
        endInboundTurn: () => {},
      },
      bus: { publishInbound: async () => {} },
      runAbortControllers: new Map<string, AbortController>(),
      activeWebchatRunBySession: new Map<string, string>(),
      activeExecutionBySession: new Map(),
      sessionIndex: {
        getSessionMetadata: async () => ({ transcriptId: 'session-thinking' }),
        updateSessionMetadata: async () => {},
        appendTranscriptCustomEntry: async () => {},
      },
      emit: (_type: string, payload: unknown) => {
        broadcastEvents.push(payload as { event?: { type?: string } });
      },
      publishRealtime: (_topic: string, _event: string, data: unknown) => {
        broadcastEvents.push({ event: data as { type?: string } });
      },
      completeRealtimeTopic: () => {},
    } as unknown as RunGatewayAgentDeps;

    const events = [];
    for await (const item of runGatewayAgent(
      deps,
      'hello',
      'webchat',
      conversationId,
      { type: 'system', source: 'internal' },
    )) events.push(item);

    const thinkingEvents = events.filter((item) => item.type === 'thinking_delta');
    expect(thinkingEvents).toHaveLength(1);
    expect(thinkingEvents[0]).toMatchObject({ payload: { delta: ' 30-minute plan.' } });
    expect(broadcastEvents.filter((item) => item.event?.type === 'thinking_delta')).toHaveLength(1);
  });

  it('does not replace or clear an existing active webchat run when this run fails', async () => {
    const conversationId = "1f0d2f37-a857-4724-82d9-3eee13a09dff";
    const activeWebchatRunBySession = new Map<string, string>([[conversationId, 'existing-run']]);
    const emitted: Array<{ type: string; payload: unknown }> = [];

    const deps = {
      config: {},
      agentService: {
        resolveUserTimezoneForSession: () => 'UTC',
        prepareInboundAttachments: async () => undefined,
        beginInboundTurn: () => {},
        turnDispatcher: {
          processDirectStreaming: async function* () {
            expect(activeWebchatRunBySession.get(conversationId)).toBe('existing-run');
            throw new Error('Agent is already processing');
          },
        },
        getLastAssistantPlainText: () => '',
        takeTaskReviewStreamHint: () => undefined,
        outboundCoordinator: {
          emitSessionTurnComplete: async () => {},
        },
        endInboundTurn: () => {},
      },
      bus: {
        publishInbound: async () => {},
      },
      runAbortControllers: new Map<string, AbortController>(),
      activeWebchatRunBySession,
      sessionIndex: {
        getSessionMetadata: async () => ({ transcriptId: 'session-test' }),
        updateSessionMetadata: async () => {},
        appendTranscriptCustomEntry: async () => {},
      },
      emit: (type: string, payload: unknown) => emitted.push({ type, payload }),
      publishRealtime: () => {},
      completeRealtimeTopic: () => {},
    } as unknown as RunGatewayAgentDeps;

    const events = [];
    for await (const event of runGatewayAgent(
      deps,
      'hello',
      'webchat',
      conversationId,
      { type: 'system', source: 'internal' },
    )) {
      events.push(event);
    }

    expect(events.some((event) => event.type === 'error')).toBe(true);
    expect(activeWebchatRunBySession.get(conversationId)).toBe('existing-run');
    expect(emitted.filter((event) => event.type === 'agent.run.ended')).toEqual([{
      type: 'agent.run.ended',
      payload: expect.objectContaining({ conversationId, status: 'error' }),
    }]);
  });

  it.each([false, true])('emits one global terminal event with safe session metadata (personal=%s)', async (personal) => {
    const conversationId = "1f0d2f37-a857-4724-82d9-3eee13a09dff";
    if (personal) {
      const agentId = personalAgentId('local-owner');
      const catalog = new AgentCatalogRepository();
      catalog.ensureInitialized();
      catalog.create({ id: agentId, profile: { name: 'Personal' } }, { ready: true });
      getSqliteDatabase().prepare("UPDATE sessions SET custom_data_json = ?, agent_id = ? WHERE conversation_id = ?")
        .run(JSON.stringify({ personalAgent: true }), agentId, conversationId);
    }
    let deliverAudio!: (audio: { type: 'tts_audio'; uri: string; name: string; mimeType: string }) => void;
    const emitted: Array<{ type: string; payload: unknown }> = [];
    const realtimeEvents: Array<{ topic: string; event: string; data: unknown }> = [];
    const deps = {
      config: {},
      agentService: {
        resolveUserTimezoneForSession: () => 'UTC',
        prepareInboundAttachments: async () => undefined,
        beginInboundTurn: () => {},
        turnDispatcher: {
          processDirectStreaming: async function* (...args: unknown[]) {
            deliverAudio = (args[5] as { onDeferredAudio: typeof deliverAudio }).onDeferredAudio;
            const message = { role: 'assistant', content: [] };
            yield { type: 'message_start', message };
            yield {
              type: 'message_update',
              message,
              assistantMessageEvent: {
                type: 'text_delta',
                delta: '## **Response complete**\n\n- Updated `api.ts`\n- See [release notes](https://example.com).',
              },
            };
            yield { type: 'message_end', message };
            yield {
              type: 'turn_outcome',
              outcome: {
                version: 1,
                outcomeId: 'run-terminal:outcome',
                runId: 'run-terminal',
                turnId: 'run-terminal',
                status: 'succeeded',
                deliverables: [],
                evidence: [],
                createdAt: '2026-09-03T00:00:00.000Z',
              },
            };
          },
        },
        getLastAssistantPlainText: () => 'cached response must not supply the notification preview',
        takeTaskReviewStreamHint: () => undefined,
        outboundCoordinator: { emitSessionTurnComplete: async () => {} },
        endInboundTurn: () => {},
      },
      bus: { publishInbound: async () => {} },
      runAbortControllers: new Map<string, AbortController>(),
      activeWebchatRunBySession: new Map<string, string>(),
      activeExecutionBySession: new Map(),
      sessionIndex: {
        getSessionMetadata: async () => ({ transcriptId: 's1', name: 'Finish notifications' }),
      },
      emit: (type: string, payload: unknown) => emitted.push({ type, payload }),
      publishRealtime: (topic: string, event: string, data: unknown) => {
        realtimeEvents.push({ topic, event, data });
      },
      completeRealtimeTopic: () => {},
    } as unknown as RunGatewayAgentDeps;

    for await (const _event of runGatewayAgent(
      deps,
      'hello',
      'webchat',
      conversationId,
      { type: 'system', source: 'internal' },
      undefined,
      undefined,
      { runId: 'run-terminal', inputReceivedAtMs: Date.now() - 1000 },
    )) {
      // Drain the run.
    }
    const firstTextLogs = latencyLogs.info.mock.calls.filter(([, message]) => message === 'Gateway first response text ready');
    expect(firstTextLogs).toHaveLength(1);
    expect(firstTextLogs[0]![0]).toMatchObject({ conversationId, runId: 'run-terminal', phase: 'first_response_text' });
    expect(firstTextLogs[0]![0].inputToTextMs).toBeGreaterThanOrEqual(1000);
    expect(firstTextLogs[0]![0].queueMs).toBeGreaterThanOrEqual(1000);
    for (const event of realtimeEvents.filter(item => ['run_start', 'assistant_message_start', 'assistant_delta'].includes(item.event))) {
      const payload = (event.data as { payload: { textSurface?: string } }).payload;
      expect(payload.textSurface).toBe(personal ? 'conversation' : undefined);
    }

    expect(emitted.filter((event) => event.type === 'agent.run.ended')).toEqual([{
      type: 'agent.run.ended',
      payload: expect.objectContaining({
        schemaVersion: 1,
        runId: 'run-terminal',
        conversationId,
        status: 'success',
        sessionTitle: 'Finish notifications',
        responsePreview: 'Response complete • Updated api.ts • See release notes.',
        target: { kind: 'chat', conversationId },
      }),
    }]);
    expect(realtimeEvents.filter((event) => event.topic === 'sessions')).toEqual([
      {
        topic: 'sessions',
        event: 'run.started',
        data: { conversationId, runId: 'run-terminal' },
      },
      {
        topic: 'sessions',
        event: 'run.completed',
        data: { conversationId, runId: 'run-terminal', status: 'success' },
      },
    ]);
    expect(realtimeEvents.some((event) => event.event === 'turn_outcome')).toBe(true);
    const runEventCount = realtimeEvents.filter(event => event.topic === 'run:run-terminal').length;
    deliverAudio({ type: 'tts_audio', uri: 'media://tts/reply.mp3', name: 'reply.mp3', mimeType: 'audio/mpeg' });
    expect(realtimeEvents.at(-1)).toMatchObject({
      topic: 'sessions', event: 'session.audio_ready',
      data: { conversationId, runId: 'run-terminal', uri: 'media://tts/reply.mp3' },
    });
    expect(emitted.at(-1)).toEqual({ type: 'session.transcript_updated', payload: { key: conversationId } });
    expect(realtimeEvents.filter(event => event.topic === 'run:run-terminal')).toHaveLength(runEventCount);

  });

  it('publishes a run-topic terminal when setup fails before active registration', async () => {
    const conversationId = "1f0d2f37-a857-4724-82d9-3eee13a09dff";
    const realtimeEvents: Array<{ topic: string; event: string; data: unknown }> = [];
    const completedTopics: string[] = [];
    const deps = {
      config: {},
      agentService: {
        resolveUserTimezoneForSession: () => 'UTC',
        prepareInboundAttachments: async () => { throw new Error('attachment setup failed'); },
        beginInboundTurn: () => {},
        getLastAssistantPlainText: () => '',
        takeTaskReviewStreamHint: () => undefined,
        outboundCoordinator: { emitSessionTurnComplete: async () => {} },
        endInboundTurn: () => {},
      },
      bus: { publishInbound: async () => {} },
      runAbortControllers: new Map<string, AbortController>(),
      activeWebchatRunBySession: new Map<string, string>(),
      activeExecutionBySession: new Map(),
      sessionIndex: {
        getSessionMetadata: async () => ({ transcriptId: 's1' }),
        appendTranscriptCustomEntry: async () => {},
      },
      emit: () => {},
      publishRealtime: (topic: string, event: string, data: unknown) => {
        realtimeEvents.push({ topic, event, data });
      },
      completeRealtimeTopic: (topic: string) => completedTopics.push(topic),
    } as unknown as RunGatewayAgentDeps;

    const events = [];
    for await (const event of runGatewayAgent(
      deps,
      'hello',
      'webchat',
      conversationId,
      { type: 'system', source: 'internal' },
      undefined,
      undefined,
      { runId: 'run-setup-failure' },
    )) events.push(event);

    expect(events.at(-1)).toMatchObject({
      type: 'run_end',
      payload: { status: 'error' },
    });
    expect(realtimeEvents.at(-1)).toMatchObject({
      topic: 'run:run-setup-failure',
      event: 'run_end',
    });
    expect(completedTopics).toEqual(['run:run-setup-failure']);
  });

  it.each(['throws', 'consumer_stops', 'embedded_abort'])('reports cancellation and clears session ownership when %s', async (mode) => {
    const conversationId = "1f0d2f37-a857-4724-82d9-3eee13a09dff";
    const controller = new AbortController();
    const emitted: Array<{ type: string; payload: unknown }> = [];
    const deps = {
      config: {}, bus: {}, runAbortControllers: new Map(), activeWebchatRunBySession: new Map(), activeExecutionBySession: new Map(),
      sessionIndex: { getSessionMetadata: async () => ({ transcriptId: 'session-test' }), updateSessionMetadata: async () => {} },
      agentService: {
        resolveUserTimezoneForSession: () => 'UTC', prepareInboundAttachments: async () => undefined,
        beginInboundTurn: () => {}, endInboundTurn: () => {}, getLastAssistantPlainText: () => '',
        takeTaskReviewStreamHint: () => undefined,
        outboundCoordinator: { emitSessionTurnComplete: async () => {} },
        turnDispatcher: { processDirectStreaming: async function* () {
          const message = { role: 'assistant', content: [] };
          yield { type: 'message_start', message };
          if (mode === 'embedded_abort') {
            yield { type: 'turn_outcome', outcome: { version: 1, outcomeId: 'internal-abort',
              runId: 'internal-abort', turnId: 'internal-abort', status: 'partial', summary: 'aborted',
              deliverables: [], evidence: [], createdAt: new Date().toISOString() } };
            return;
          }
          if (mode === 'throws') { controller.abort(); throw new DOMException('Interrupted', 'AbortError'); }
          yield { type: 'message_update', message, assistantMessageEvent: { type: 'text_delta', delta: 'Hello' } };
          if (!controller.signal.aborted) await new Promise<void>((resolve) => controller.signal.addEventListener('abort', () => resolve(), { once: true }));
          throw new DOMException('Interrupted', 'AbortError');
        } },
      },
      emit: (type: string, payload: unknown) => emitted.push({ type, payload }),
      publishRealtime: () => {}, completeRealtimeTopic: () => {},
    } as unknown as RunGatewayAgentDeps;
    const events = [];
    for await (const event of runGatewayAgent(deps, 'hello', 'webchat', conversationId, { type: 'channel', channel: 'webchat' }, undefined, undefined, { signal: controller.signal })) {
      events.push(event);
      if (mode === 'consumer_stops' && event.type === 'assistant_delta') { controller.abort(); break; }
    }
    expect(events.some((event) => event.type === 'error')).toBe(false);
    expect(deps.activeWebchatRunBySession.size).toBe(0);
    expect(deps.runAbortControllers.size).toBe(0);
    expect(emitted.filter((event) => event.type === 'agent.run.ended')).toEqual([
      { type: 'agent.run.ended', payload: expect.objectContaining({ status: 'cancelled' }) },
    ]);
  });

});
