import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  hasPendingAgentRunForChat,
  MessageSender,
  pendingAgentRunStorageKey,
  setPendingAgentRun,
} from '@/features/chat/messages/message-sender';
import type { MessagingCallbacks } from '@/features/chat/messages/message-sender';
import { fetchSessionActiveRun, resolveResumeRunId } from '@/features/chat/session/resolve-resume-run-id';
import { selectDisplayMessages } from '@/features/chat/session/chat-session-view';

vi.mock('@/lib/fetch', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('@/stores/gateway-store', () => ({
  useGatewayStore: {
    getState: () => ({ token: 'test-token', onUnauthorized: () => {} }),
  },
}));

import { apiFetch } from '@/lib/fetch';

describe('resolveResumeRunId', () => {
  const sessionKey = 'agent:main:webchat:default:direct:abc';
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
      _sseChatId: string;
      _trackedRunId?: string;
    };
    internals._abort = new AbortController();
    internals._sseChatId = sessionKey;
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
      vi.mocked(apiFetch).mockResolvedValue(
        new Response(
          [
            'event: run_start',
            'data: {"runId":"run-complete"}',
            '',
            'event: run_end',
            'data: {"payload":{}}',
            '',
            '',
          ].join('\n'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      );

      if (method === 'send') {
        await sender.send('hello', sessionKey);
      } else {
        setPendingAgentRun(sessionKey, 'run-complete');
        streamingStatesAtNotification.length = 0;
        await sender.resume('run-complete', sessionKey);
      }

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
    vi.mocked(apiFetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error: { code: 'NOT_FOUND', message: 'Run not found or already expired' },
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    setPendingAgentRun(sessionKey, 'run-expired');

    await expect(sender.resume('run-expired', sessionKey)).resolves.toBe(false);

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
    vi.mocked(apiFetch).mockResolvedValue(
      new Response(
        [
          'event: task_plan_updated',
          'data: {"payload":{"planId":"session:todo","revision":2,"source":"todo","scope":"session","items":[]}}',
          '',
          'event: run_end',
          'data: {"payload":{}}',
          '',
          '',
        ].join('\n'),
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );

    await sender.send('clear todos', sessionKey, undefined, undefined, callbacks);

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
