// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  startAgentRunStreamEventBridge,
  type AgentStreamWindowDetail,
} from '../agent-run-stream-event-bridge';

describe('agent run stream event bridge', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it('replays a durable run and forwards ordered events with its effective mode', async () => {
    let listener: {
      onEvent: (event: { event: string; data: unknown; seq: number }) => void;
      onGap?: (gap: { recoverable: boolean }) => void;
    } | undefined;
    const unsubscribe = vi.fn();
    const subscribe = vi.fn((_topic, nextListener, _afterSeq) => {
      listener = nextListener;
      return unsubscribe;
    });
    const dispatch = vi.fn<(detail: AgentStreamWindowDetail) => void>();
    const cleanup = startAgentRunStreamEventBridge({
      subscribe: subscribe as never,
      loadActivityDetailLevel: async () => 'stream',
      dispatch,
    });
    cleanups.push(cleanup);

    window.dispatchEvent(new CustomEvent('run-started', {
      detail: { sessionKey: 'agent:main:webchat:test', runId: 'run-1' },
    }));

    expect(subscribe).toHaveBeenCalledWith(
      'run:run-1',
      expect.any(Object),
      0,
    );
    await Promise.resolve();
    listener?.onEvent({
      event: 'assistant_message_start',
      seq: 1,
      data: {
        type: 'assistant_message_start',
        runId: 'run-1',
        payload: { messageId: 'm1' },
      },
    });
    listener?.onEvent({
      event: 'assistant_delta',
      seq: 2,
      data: {
        type: 'assistant_delta',
        runId: 'run-1',
        payload: { messageId: 'm1', delta: 'Hello' },
      },
    });
    listener?.onEvent({
      event: 'run_end',
      seq: 3,
      data: {
        type: 'run_end',
        runId: 'run-1',
        payload: { status: 'success' },
      },
    });
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(3));

    expect(dispatch.mock.calls.map(([detail]) => ({
      type: (detail.event as { type: string }).type,
      seq: (detail.event as { seq: number }).seq,
      level: detail.activityDetailLevel,
    }))).toEqual([
      { type: 'assistant_message_start', seq: 1, level: 'stream' },
      { type: 'assistant_delta', seq: 2, level: 'stream' },
      { type: 'run_end', seq: 3, level: 'stream' },
    ]);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('deduplicates run announcements and stops unrecoverable subscriptions', () => {
    let onGap: ((gap: { recoverable: boolean }) => void) | undefined;
    const unsubscribe = vi.fn();
    const subscribe = vi.fn((_topic, listener) => {
      onGap = listener.onGap;
      return unsubscribe;
    });
    const cleanup = startAgentRunStreamEventBridge({
      subscribe: subscribe as never,
      loadActivityDetailLevel: async () => 'on',
      dispatch: vi.fn(),
    });
    cleanups.push(cleanup);
    const event = new CustomEvent('run-started', {
      detail: { sessionKey: 'agent:main:webchat:test', runId: 'run-1' },
    });

    window.dispatchEvent(event);
    window.dispatchEvent(event);
    expect(subscribe).toHaveBeenCalledTimes(1);

    onGap?.({ recoverable: false });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('holds live thinking until the activity-detail mode is known', async () => {
    let listener: {
      onEvent: (event: { event: string; data: unknown; seq: number }) => void;
    } | undefined;
    let resolveLevel: ((level: 'stream') => void) | undefined;
    const dispatch = vi.fn<(detail: AgentStreamWindowDetail) => void>();
    const cleanup = startAgentRunStreamEventBridge({
      subscribe: vi.fn((_topic, nextListener) => {
        listener = nextListener;
        return () => {};
      }) as never,
      loadActivityDetailLevel: () => new Promise((resolve) => {
        resolveLevel = resolve;
      }),
      dispatch,
    });
    cleanups.push(cleanup);
    window.dispatchEvent(new CustomEvent('run-started', {
      detail: { sessionKey: 'agent:main:webchat:test', runId: 'run-thinking' },
    }));

    listener?.onEvent({
      event: 'thinking_delta',
      seq: 1,
      data: { type: 'thinking_delta', payload: { delta: 'plan' } },
    });
    expect(dispatch).not.toHaveBeenCalled();

    resolveLevel?.('stream');
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      activityDetailLevel: 'stream',
      event: expect.objectContaining({ type: 'thinking_delta', seq: 1 }),
    }));
  });
});
