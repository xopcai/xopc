import { describe, expect, it } from 'vitest';

import { AgentRunRelay } from '../../agent-run-relay.js';
import { runGatewayAgent, type RunGatewayAgentDeps } from '../run-gateway-agent.js';

describe('runGatewayAgent', () => {
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
        persistentGoals: {
          takeStreamOutcome: () => undefined,
        },
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
});
