import { describe, expect, it, vi } from 'vitest';

import { normalizeGatewaySseEvent } from '../backends/gateway-sse-backend.js';
import { clearSeenStreamEvents, dispatchAgentEvent } from '../tui-agent-events.js';
import { createInitialState } from '../tui-types.js';

function streamEvent(type: string, seq: number, payload: Record<string, unknown>) {
  return {
    type,
    runId: 'r1',
    sessionKey: 'sk',
    seq,
    timestamp: 1,
    payload,
  };
}

describe('normalizeGatewaySseEvent', () => {
  it('unwraps broadcast agent.stream events into direct agent stream events', () => {
    const event = normalizeGatewaySseEvent({
      event: 'agent.stream',
      source: 'broadcast',
      data: {
        sessionKey: 'sk',
        event: {
          type: 'assistant_delta',
          runId: 'r1',
          sessionKey: 'sk',
          seq: 3,
          timestamp: 1,
          payload: { messageId: 'm1', delta: 'hello' },
        },
      },
    });

    expect(event).toEqual({
      event: 'assistant_delta',
      source: 'broadcast',
      data: {
        type: 'assistant_delta',
        runId: 'r1',
        sessionKey: 'sk',
        seq: 3,
        timestamp: 1,
        payload: { messageId: 'm1', delta: 'hello' },
      },
    });
  });

  it('leaves non-agent broadcast events untouched', () => {
    const event = {
      event: 'workflow.run.updated',
      source: 'broadcast' as const,
      data: { runId: 'wf1' },
    };

    expect(normalizeGatewaySseEvent(event)).toBe(event);
  });

  it('lets dispatch de-duplicate direct response events against wrapped broadcasts', () => {
    clearSeenStreamEvents();
    const state = createInitialState('sk');
    const chatLog = { updateAssistant: vi.fn() };
    const tui = { requestRender: vi.fn() };
    const setActivityStatus = vi.fn();
    const direct = streamEvent('assistant_delta', 4, { messageId: 'm1', delta: 'hello' });

    dispatchAgentEvent(
      'assistant_delta',
      direct,
      state,
      chatLog as never,
      tui as never,
      setActivityStatus,
      undefined,
      undefined,
      undefined,
      'agent-response',
    );

    const broadcast = normalizeGatewaySseEvent({
      event: 'agent.stream',
      source: 'broadcast',
      data: { sessionKey: 'sk', event: direct },
    });
    dispatchAgentEvent(
      broadcast.event,
      broadcast.data as Record<string, unknown>,
      state,
      chatLog as never,
      tui as never,
      setActivityStatus,
      undefined,
      undefined,
      undefined,
      broadcast.source,
    );

    expect(chatLog.updateAssistant).toHaveBeenCalledTimes(1);
  });
});
