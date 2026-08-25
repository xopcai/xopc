import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hasPendingAgentRunForChat,
  MessageSender,
  pendingAgentRunStorageKey,
  setPendingAgentRun,
} from '@/features/chat/messages/message-sender';
import type { MessagingCallbacks } from '@/features/chat/messages/message-sender';
import { fetchSessionActiveRun, resolveResumeRunId } from '@/features/chat/session/resolve-resume-run-id';
import { selectDisplayMessages } from '@/features/chat/session/chat-session-view';
import {
  clearEndpointTurnClaim,
  publishEndpointTurnClaim,
} from '@/features/endpoint-tools/turn-claim';
import type { RealtimeEventPayload } from '@xopcai/realtime-protocol';

const realtimeState = vi.hoisted(() => ({
  listener: undefined as undefined | {
    onEvent: (event: RealtimeEventPayload) => void;
    onGap?: (gap: { topic: string; requestedSeq: number; earliestSeq: number; recoverable: boolean }) => void;
  },
}));

vi.mock('@/lib/fetch', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('@/stores/gateway-store', () => ({
  useGatewayStore: {
    getState: () => ({ token: 'test-token', onUnauthorized: () => {} }),
  },
}));

vi.mock('@/features/gateway/gateway-realtime', () => ({
  subscribeRealtimeTopic: vi.fn((_topic: string, listener: typeof realtimeState.listener) => {
    realtimeState.listener = listener;
    return vi.fn();
  }),
}));

import { apiFetch } from '@/lib/fetch';

describe('resolveResumeRunId', () => {
  const sessionKey = 'agent:main:webchat:default:direct:abc';
  const storage = new Map<string, string>();

  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    storage.clear();
    realtimeState.listener = undefined;
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost:3000' },
      dispatchEvent: vi.fn(),
    });
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
      removeItem: (k: string) => {
        storage.delete(k);
      },
      clear: () => storage.clear(),
    });
  });

  it('fetchSessionActiveRun reads gateway payload', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ payload: { active: true, runId: 'run-gateway' } }),
    } as Response);

    await expect(fetchSessionActiveRun(sessionKey)).resolves.toEqual({
      active: true,
      runId: 'run-gateway',
    });
  });

  it('prefers gateway active run and syncs sessionStorage', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ payload: { active: true, runId: 'run-gateway' } }),
    } as Response);

    const runId = await resolveResumeRunId(sessionKey);
    expect(runId).toBe('run-gateway');
    expect(sessionStorage.getItem(pendingAgentRunStorageKey(sessionKey))).toContain('run-gateway');
  });

  it('falls back to sessionStorage when gateway reports inactive', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ payload: { active: false } }),
    } as Response);
    setPendingAgentRun(sessionKey, 'run-local');

    const runId = await resolveResumeRunId(sessionKey);
    expect(runId).toBe('run-local');
  });
});

describe('selectDisplayMessages', () => {
  it('returns empty when view key mismatches session key', () => {
    expect(
      selectDisplayMessages({
        viewSessionKey: 'a',
        sessionKey: 'b',
        messages: [{ role: 'user', content: [], timestamp: 1 }],
        streamingMsg: null,
      }),
    ).toEqual([]);
  });
});

describe('MessageSender abort', () => {
  const sessionKey = 'agent:main:webchat:default:direct:abort-me';
  const storage = new Map<string, string>();

  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    storage.clear();
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost:3000' },
      dispatchEvent: vi.fn(),
    });
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
      removeItem: (k: string) => {
        storage.delete(k);
      },
      clear: () => storage.clear(),
    });
  });

  it('clears pending run state after aborting so sidebar status can go idle', () => {
    const sender = new MessageSender();
    const internals = sender as unknown as {
      _abort: AbortController;
      _chatId: string;
      _trackedRunId?: string;
    };
    internals._abort = new AbortController();
    internals._chatId = sessionKey;
    internals._trackedRunId = 'run-abort';
    setPendingAgentRun(sessionKey, 'run-abort');
    vi.mocked(window.dispatchEvent).mockClear();

    sender.abort();

    expect(sender.isStreamingFor(sessionKey)).toBe(false);
    expect(hasPendingAgentRunForChat(sessionKey)).toBe(false);
    expect(window.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'xopc-pending-agent-run-changed' }),
    );
  });
});

describe('MessageSender terminal state', () => {
  const sessionKey = 'agent:main:webchat:default:direct:complete-me';
  const storage = new Map<string, string>();

  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    storage.clear();
    realtimeState.listener = undefined;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
      removeItem: (k: string) => {
        storage.delete(k);
      },
      clear: () => storage.clear(),
    });
    publishEndpointTurnClaim('web-test', 'test-turn-token');
  });

  afterEach(() => {
    clearEndpointTurnClaim();
  });

  it('submits task chat input through the task endpoint with an active-session guard', async () => {
    const sender = new MessageSender();
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({
      payload: { sessionKey, state: { inputs: [] } },
    }), { status: 202, headers: { 'Content-Type': 'application/json' } }));

    await sender.send('continue', sessionKey, undefined, undefined, undefined, 'task-1');

    expect(apiFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/tasks/task-1/inputs'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Xopc-Expected-Session-Key': sessionKey }),
      }),
    );
  });

  it.each(['send', 'resume'] as const)(
    'marks the %s stream idle before notifying sidebar listeners',
    async (method) => {
      const sender = new MessageSender();
      const streamingStatesAtNotification: boolean[] = [];
      vi.stubGlobal('window', {
        location: { origin: 'http://localhost:3000' },
        dispatchEvent: vi.fn((event: Event) => {
          if (event.type === 'xopc-pending-agent-run-changed') {
            streamingStatesAtNotification.push(sender.isStreamingFor(sessionKey));
          }
          return true;
        }),
      });
      vi.mocked(apiFetch).mockImplementation(async (url, init) => {
        if (String(url).includes('/inputs')) {
          const submitted = JSON.parse(String(init?.body)) as { clientMessageId: string };
          return new Response(JSON.stringify({
            payload: {
              state: {
                activeRunId: 'run-complete',
                activeInputId: 'input-1',
                inputs: [{ id: 'input-1', clientMessageId: submitted.clientMessageId }],
              },
            },
          }), { status: 202, headers: { 'Content-Type': 'application/json' } });
        }
        throw new Error(`Unexpected request: ${String(url)}`);
      });

      let pending: Promise<unknown>;
      if (method === 'send') {
        pending = sender.send('hello', sessionKey);
      } else {
        setPendingAgentRun(sessionKey, 'run-complete');
        streamingStatesAtNotification.length = 0;
        pending = sender.resume('run-complete', sessionKey);
      }
      await vi.waitFor(() => expect(realtimeState.listener).toBeDefined());
      realtimeState.listener?.onEvent({
        topic: 'run:run-complete',
        seq: 1,
        event: 'run_end',
        data: {
          type: 'run_end',
          runId: 'run-complete',
          sessionKey,
          timestamp: Date.now(),
          payload: { status: 'success' },
        },
      });
      await pending;

      expect(streamingStatesAtNotification).toEqual([true, false]);
      expect(sender.isStreamingFor(sessionKey)).toBe(false);
      expect(hasPendingAgentRunForChat(sessionKey)).toBe(false);
    },
  );

  it('reports an expired resume run so the session state can return to idle', async () => {
    const sender = new MessageSender();
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost:3000' },
      dispatchEvent: vi.fn(),
    });
    setPendingAgentRun(sessionKey, 'run-expired');

    const pending = sender.resume('run-expired', sessionKey);
    await vi.waitFor(() => expect(realtimeState.listener).toBeDefined());
    realtimeState.listener?.onGap?.({
      topic: 'run:run-expired', requestedSeq: 0, earliestSeq: 1, recoverable: false,
    });
    await expect(pending).resolves.toBe(false);

    expect(sender.isStreamingFor(sessionKey)).toBe(false);
    expect(hasPendingAgentRunForChat(sessionKey)).toBe(false);
  });

  it('delivers an empty canonical task plan as a clear snapshot', async () => {
    const sender = new MessageSender();
    const onTaskPlanUpdated = vi.fn();
    const callbacks: MessagingCallbacks = {
      onStreamStart: vi.fn(),
      onToken: vi.fn(),
      onThinking: vi.fn(),
      onThinkingEnd: vi.fn(),
      onToolStart: vi.fn(),
      onToolEnd: vi.fn(),
      onProgress: vi.fn(),
      onTaskPlanUpdated,
      onResult: vi.fn(),
      onError: vi.fn(),
    };
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost:3000' },
      dispatchEvent: vi.fn(),
    });
    vi.mocked(apiFetch).mockImplementation(async (url, init) => {
      if (String(url).includes('/inputs')) {
        const submitted = JSON.parse(String(init?.body)) as { clientMessageId: string };
        return new Response(JSON.stringify({
          payload: {
            state: {
              activeRunId: 'run-plan',
              activeInputId: 'input-plan',
              inputs: [{ id: 'input-plan', clientMessageId: submitted.clientMessageId }],
            },
          },
        }), { status: 202, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected request: ${String(url)}`);
    });

    const pending = sender.send('clear todos', sessionKey, undefined, undefined, callbacks);
    await vi.waitFor(() => expect(realtimeState.listener).toBeDefined());
    realtimeState.listener?.onEvent({
      topic: 'run:run-plan',
      seq: 1,
      event: 'task_plan_updated',
      data: {
        type: 'task_plan_updated',
        runId: 'run-plan',
        sessionKey,
        timestamp: Date.now(),
        payload: {
          planId: 'session:todo', revision: 2, source: 'todo', scope: 'session', items: [],
        },
      },
    });
    realtimeState.listener?.onEvent({
      topic: 'run:run-plan',
      seq: 2,
      event: 'run_end',
      data: {
        type: 'run_end', runId: 'run-plan', sessionKey, timestamp: Date.now(),
        payload: { status: 'success' },
      },
    });
    await pending;

    expect(onTaskPlanUpdated).toHaveBeenCalledWith({
      planId: 'session:todo',
      revision: 2,
      source: 'todo',
      scope: 'session',
      explanation: undefined,
      items: [],
    });
  });
});
