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
    ensureSessionRecord('agent:main:webchat:default:direct:chat-thinking', stateDir);
    ensureSessionRecord('agent:main:webchat:default:direct:chat-test', stateDir);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('coalesces thinking bursts before realtime publication', async () => {
    const sessionKey = 'agent:main:webchat:default:direct:chat-thinking';
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
      sessionIndex: {
        getSessionMetadata: async () => ({ sessionId: 'session-thinking' }),
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
      sessionKey,
      { type: 'system', source: 'internal' },
    )) events.push(item);

    const thinkingEvents = events.filter((item) => item.type === 'thinking_delta');
    expect(thinkingEvents).toHaveLength(1);
    expect(thinkingEvents[0]).toMatchObject({ payload: { delta: ' 30-minute plan.' } });
    expect(broadcastEvents.filter((item) => item.event?.type === 'thinking_delta')).toHaveLength(1);
  });

  it('does not replace or clear an existing active webchat run when this run fails', async () => {
    const sessionKey = 'agent:main:webchat:default:direct:chat-test';
    const activeWebchatRunBySession = new Map<string, string>([[sessionKey, 'existing-run']]);
    const emitted: Array<{ type: string; payload: unknown }> = [];

    const deps = {
      config: {},
      agentService: {
        resolveUserTimezoneForSession: () => 'UTC',
        prepareInboundAttachments: async () => undefined,
        beginInboundTurn: () => {},
        turnDispatcher: {
          processDirectStreaming: async function* () {
            expect(activeWebchatRunBySession.get(sessionKey)).toBe('existing-run');
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
        getSessionMetadata: async () => ({ sessionId: 'session-test' }),
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
      sessionKey,
      { type: 'system', source: 'internal' },
    )) {
      events.push(event);
    }

    expect(events.some((event) => event.type === 'error')).toBe(true);
    expect(activeWebchatRunBySession.get(sessionKey)).toBe('existing-run');
    expect(emitted.filter((event) => event.type === 'agent.run.ended')).toEqual([{
      type: 'agent.run.ended',
      payload: expect.objectContaining({ sessionKey, status: 'error' }),
    }]);
  });

  it('emits one global terminal event with safe session metadata', async () => {
    const sessionKey = 'agent:main:webchat:default:direct:chat-test';
    const emitted: Array<{ type: string; payload: unknown }> = [];
    const realtimeEvents: Array<{ topic: string; event: string; data: unknown }> = [];
    const persisted: Array<{ customType: string; data?: unknown }> = [];
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
            yield {
              type: 'message_update',
              message,
              assistantMessageEvent: {
                type: 'text_delta',
                delta: 'Here is the completed response with details.\nSecond line.',
              },
            };
            yield { type: 'message_end', message };
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
      sessionIndex: {
        getSessionMetadata: async () => ({ sessionId: 's1', name: 'Finish notifications' }),
        appendTranscriptCustomEntry: async (_key: string, entry: { customType: string; data?: unknown }) => {
          persisted.push(entry);
        },
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
      sessionKey,
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
        sessionKey,
        status: 'success',
        sessionTitle: 'Finish notifications',
        responsePreview: 'Here is the completed response with details. Second line.',
        target: { kind: 'chat', sessionKey },
      }),
    }]);
    expect(realtimeEvents.filter((event) => event.topic === 'sessions')).toEqual([
      {
        topic: 'sessions',
        event: 'run.started',
        data: { sessionKey, runId: 'run-terminal' },
      },
      {
        topic: 'sessions',
        event: 'run.completed',
        data: { sessionKey, runId: 'run-terminal', status: 'success' },
      },
    ]);
    expect(realtimeEvents.some((event) => event.event === 'turn_outcome')).toBe(true);
    expect(persisted).toEqual([
      expect.objectContaining({
        customType: 'turn_outcome',
        data: expect.objectContaining({ runId: 'run-terminal', status: 'succeeded' }),
      }),
    ]);
  });

  it('publishes a run-topic terminal when setup fails before active registration', async () => {
    const sessionKey = 'agent:main:webchat:default:direct:chat-test';
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
      sessionIndex: {
        getSessionMetadata: async () => ({ sessionId: 's1' }),
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
      sessionKey,
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

});
