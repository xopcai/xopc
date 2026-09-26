import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  ensureSessionRecord,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../storage/sqlite/index.js';
import { runGatewayAgent, type RunGatewayAgentDeps } from '../run-gateway-agent.js';

describe('runGatewayAgent', () => {
  let stateDir: string;

  beforeEach(() => {
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

  it('emits one global terminal event with safe session metadata', async () => {
    const conversationId = "1f0d2f37-a857-4724-82d9-3eee13a09dff";
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
      { runId: 'run-terminal' },
    )) {
      // Drain the run.
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

  it.each(['throws', 'consumer_stops'])('reports cancellation and clears session ownership when %s', async (mode) => {
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
