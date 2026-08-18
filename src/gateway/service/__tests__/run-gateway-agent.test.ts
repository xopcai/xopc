import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentRunRelay } from '../../agent-run-relay.js';
import {
  closeXopcDatabase,
  ensureSessionRecord,
  listExecutionReceipts,
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

  it('coalesces thinking bursts before relay sequence assignment', async () => {
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
        takeOutcomeReviewStreamHint: () => undefined,
        outboundCoordinator: { emitSessionTurnComplete: async () => {} },
        endInboundTurn: () => {},
      },
      bus: { publishInbound: async () => {} },
      runRelay: new AgentRunRelay(),
      runAbortControllers: new Map<string, AbortController>(),
      activeWebchatRunBySession: new Map<string, string>(),
      sessionIndex: {
        getSessionMetadata: async () => ({ sessionId: 'session-thinking' }),
        updateSessionMetadata: async () => {},
      },
      emit: (_type: string, payload: unknown) => {
        broadcastEvents.push(payload as { event?: { type?: string } });
      },
    } as unknown as RunGatewayAgentDeps;

    const events = [];
    for await (const item of runGatewayAgent(deps, 'hello', 'webchat', sessionKey)) events.push(item);

    const thinkingEvents = events.filter((item) => item.type === 'thinking_delta');
    expect(thinkingEvents).toHaveLength(1);
    expect(thinkingEvents[0]).toMatchObject({ payload: { delta: ' 30-minute plan.' } });
    expect(events.map((item) => item.seq)).toEqual(events.map((_, index) => index + 1));
    expect(broadcastEvents.filter((item) => item.event?.type === 'thinking_delta')).toHaveLength(1);
  });

  it('does not replace or clear an existing active webchat run when this run fails', async () => {
    const sessionKey = 'agent:main:webchat:default:direct:chat-test';
    const activeWebchatRunBySession = new Map<string, string>([[sessionKey, 'existing-run']]);

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
        takeOutcomeReviewStreamHint: () => undefined,
        outboundCoordinator: {
          emitSessionTurnComplete: async () => {},
        },
        endInboundTurn: () => {},
      },
      bus: {
        publishInbound: async () => {},
      },
      runRelay: new AgentRunRelay(),
      runAbortControllers: new Map<string, AbortController>(),
      activeWebchatRunBySession,
      sessionIndex: {
        getSessionMetadata: async () => ({ sessionId: 'session-test' }),
        updateSessionMetadata: async () => {},
      },
      emit: () => {},
    } as unknown as RunGatewayAgentDeps;

    const events = [];
    for await (const event of runGatewayAgent(deps, 'hello', 'webchat', sessionKey)) {
      events.push(event);
    }

    expect(events.some((event) => event.type === 'error')).toBe(true);
    expect(activeWebchatRunBySession.get(sessionKey)).toBe('existing-run');
  });

  it('does not treat completed plan items as verified outcome criteria', async () => {
    const sessionKey = 'agent:main:webchat:default:direct:chat-test';
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
              type: 'tool_execution_end',
              toolCallId: 'plan-1',
              toolName: 'update_plan',
              isError: false,
              result: {
                content: [{ type: 'text', text: 'plan updated' }],
                details: {
                  plan: [{ step: 'Run regression tests', status: 'completed' }],
                },
              },
            };
            yield { type: 'message_end', message };
          },
        },
        getLastAssistantPlainText: () => 'Done',
        takeOutcomeReviewStreamHint: () => undefined,
        outboundCoordinator: { emitSessionTurnComplete: async () => {} },
        endInboundTurn: () => {},
      },
      bus: { publishInbound: async () => {} },
      runRelay: new AgentRunRelay(),
      runAbortControllers: new Map<string, AbortController>(),
      activeWebchatRunBySession: new Map<string, string>(),
      sessionIndex: {
        getSessionMetadata: async () => ({ sessionId: 'session-test' }),
        updateSessionMetadata: async () => {},
      },
      emit: () => {},
    } as unknown as RunGatewayAgentDeps;

    for await (const _event of runGatewayAgent(deps, 'verify the change', 'webchat', sessionKey)) {
      // Consume the stream so the outcome finalizer runs.
    }

    expect(listExecutionReceipts({ sessionKey })).toEqual([
      expect.objectContaining({
        evidence: [expect.objectContaining({
          title: 'Plan item completed: Run regression tests',
        })],
        verification: expect.objectContaining({ status: 'unverified' }),
        completionVerdict: 'partial',
      }),
    ]);
  });
});
