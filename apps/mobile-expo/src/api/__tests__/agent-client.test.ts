import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RealtimeEventPayload } from '@xopcai/realtime-protocol';

const testState = vi.hoisted(() => ({
  memory: new Map<string, string>(),
  apiFetch: vi.fn(),
  apiUploadFile: vi.fn(),
  language: 'zh' as 'en' | 'zh',
  reconnect: vi.fn(),
  unsubscribe: vi.fn(),
  realtimeAfterSeq: undefined as number | undefined,
  realtimeListener: undefined as undefined | {
    onEvent?: (event: RealtimeEventPayload) => void;
    onGap?: (gap: { topic: string; requestedSeq: number; earliestSeq: number; recoverable: boolean }) => void;
  },
}));

vi.mock('../client', () => ({
  apiFetch: testState.apiFetch,
  apiUploadFile: testState.apiUploadFile,
  formatApiHttpError: vi.fn((status: number, statusText: string, message?: string) =>
    message ? `${status} ${statusText}: ${message}` : `${status} ${statusText}`,
  ),
  notifyUnauthorizedIfNeeded: vi.fn(),
}));

vi.mock('../../stores/preferences-store', () => ({
  usePreferencesStore: {
    getState: () => ({ language: testState.language }),
  },
}));

vi.mock('../../features/gateway/use-gateway-realtime', () => ({
  requestMobileRealtimeReconnect: testState.reconnect,
  subscribeMobileRealtimeTopic: vi.fn((_topic: string, listener: {
    onEvent?: (event: RealtimeEventPayload) => void;
    onGap?: (gap: { topic: string; requestedSeq: number; earliestSeq: number; recoverable: boolean }) => void;
  }, afterSeq?: number) => {
    testState.realtimeListener = listener;
    testState.realtimeAfterSeq = afterSeq;
    return testState.unsubscribe;
  }),
}));

vi.mock('../../features/chat/attachment-file-io', () => ({
  readUriAsBase64: vi.fn(),
}));

vi.mock('../../stores/gateway-store', () => ({
  useGatewayStore: {
    getState: vi.fn(() => ({
      apiUrl: (path: string) => `https://gateway.test${path}`,
    })),
  },
}));

vi.mock('../../storage/mmkv', () => ({
  KEYS: { endpointId: 'endpoint:id' },
  storage: {
    getString: (key: string) => testState.memory.get(key),
    set: (key: string, value: string | number | boolean) => {
      testState.memory.set(key, String(value));
    },
    delete: (key: string) => {
      testState.memory.delete(key);
    },
  },
  pendingRunStorageKey: (sessionKey: string) => `pending:${sessionKey}`,
}));

import {
  AgentMessageSender,
  AgentStreamReplayExpiredError,
  refineVoiceTranscript,
  transcribeVoice,
} from '../agent-client';
import { readUriAsBase64 } from '../../features/chat/attachment-file-io';
import {
  clearMobileEndpointTurnClaim,
  publishMobileEndpointTurnClaim,
} from '../../features/endpoint-tools/turn-claim';

describe('AgentMessageSender voice message', () => {
  beforeEach(() => {
    testState.memory.clear();
    testState.apiFetch.mockReset();
    testState.apiUploadFile.mockReset();
    testState.language = 'zh';
    vi.mocked(readUriAsBase64).mockReset();
    clearMobileEndpointTurnClaim();
  });

  afterEach(() => {
    clearMobileEndpointTurnClaim();
  });

  it('queues the native recording URI without materializing base64', async () => {
    const sender = new AgentMessageSender();
    const sendMessage = vi.spyOn(sender, 'sendMessage').mockResolvedValue(undefined);

    await sender.sendVoiceMessage(
      {
        uri: 'file:///data/user/0/ai.xopc.xopc/cache/Audio/recording.m4a',
        durationMillis: 1_250,
        mimeType: 'audio/mp4',
      },
      'session-a',
    );

    expect(readUriAsBase64).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(
      '',
      'session-a',
      undefined,
      [expect.objectContaining({
        type: 'voice',
        mimeType: 'audio/mp4',
        name: 'voice.m4a',
        localUri: 'file:///data/user/0/ai.xopc.xopc/cache/Audio/recording.m4a',
        durationSeconds: 1.25,
      })],
      undefined,
    );
  });

  it('uploads voice bytes once and submits only the media reference', async () => {
    publishMobileEndpointTurnClaim('mobile-test', 'test-turn-token');
    testState.apiUploadFile.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      payload: {
        uri: 'media://inbound/voice---id.m4a',
        name: 'voice.m4a',
        mimeType: 'audio/mp4',
        size: 3,
      },
    }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    testState.apiFetch.mockImplementation(async (_path, init) => {
      const body = JSON.parse(String(init?.body)) as { clientMessageId: string };
      return new Response(JSON.stringify({
        ok: true,
        payload: { state: { inputs: [{ id: 'input-1', clientMessageId: body.clientMessageId }] } },
      }), { status: 202, headers: { 'Content-Type': 'application/json' } });
    });

    try {
      await new AgentMessageSender().sendVoiceMessage({
        uri: 'file:///documents/voice.m4a',
        durationMillis: 1_250,
        mimeType: 'audio/mp4',
      }, 'session-a');
    } finally {
      clearMobileEndpointTurnClaim();
    }

    expect(readUriAsBase64).not.toHaveBeenCalled();
    expect(testState.apiUploadFile).toHaveBeenCalledWith('/api/media', {
      uri: 'file:///documents/voice.m4a',
      fieldName: 'file',
      mimeType: 'audio/mp4',
      timeoutMs: 60_000,
    });
    const sessionCall = testState.apiFetch.mock.calls.find(([path]) => path === '/api/sessions/session-a/inputs');
    const submitted = JSON.parse(String(sessionCall?.[1]?.body)) as {
      attachments: Array<{ uri?: string; data?: string; localUri?: string }>;
    };
    expect(submitted.attachments).toEqual([
      expect.objectContaining({ uri: 'media://inbound/voice---id.m4a' }),
    ]);
    expect(submitted.attachments[0]).not.toHaveProperty('data');
    expect(submitted.attachments[0]).not.toHaveProperty('localUri');
  });

  it('uploads transcription audio natively with the preferred UI language', async () => {
    testState.apiUploadFile.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      payload: { text: 'hello', refinementAvailable: false },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(transcribeVoice('file:///documents/voice.m4a', 'audio/mp4'))
      .resolves.toEqual({ text: 'hello', refinementAvailable: false });

    expect(readUriAsBase64).not.toHaveBeenCalled();
    expect(testState.apiUploadFile).toHaveBeenCalledWith('/api/voice/transcriptions', {
      uri: 'file:///documents/voice.m4a',
      fieldName: 'audio',
      mimeType: 'audio/mp4',
      parameters: { language: 'zh-CN' },
      timeoutMs: 60_000,
      recoverRouteOnNetworkError: true,
    });
  });

  it('allows callers to override the transcription language', async () => {
    testState.apiUploadFile.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      payload: { text: 'hello', refinementAvailable: false },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await transcribeVoice('file:///documents/voice.m4a', 'audio/mp4', { language: 'en-US' });

    expect(testState.apiUploadFile).toHaveBeenCalledWith(
      '/api/voice/transcriptions',
      expect.objectContaining({ parameters: { language: 'en-US' } }),
    );
  });

  it('maps the English UI preference to English speech recognition', async () => {
    testState.language = 'en';
    testState.apiUploadFile.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      payload: { text: 'hello', refinementAvailable: false },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await transcribeVoice('file:///documents/voice.m4a', 'audio/mp4');

    expect(testState.apiUploadFile).toHaveBeenCalledWith(
      '/api/voice/transcriptions',
      expect.objectContaining({ parameters: { language: 'en-US' } }),
    );
  });

  it('refines an already returned transcript through the separate endpoint', async () => {
    testState.apiFetch.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      payload: { text: 'Hello, world.' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(refineVoiceTranscript('hello world')).resolves.toBe('Hello, world.');
    expect(testState.apiFetch).toHaveBeenCalledWith('/api/voice/transcriptions/refine', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ text: 'hello world' }),
    }));
  });
});

describe('AgentMessageSender local detach', () => {
  beforeEach(() => {
    testState.memory.clear();
    testState.apiFetch.mockReset();
    testState.reconnect.mockReset();
    testState.unsubscribe.mockReset();
    testState.realtimeAfterSeq = undefined;
    testState.realtimeListener = undefined;
    publishMobileEndpointTurnClaim('mobile-test', 'test-turn-token');
  });

  afterEach(() => {
    vi.useRealTimers();
    clearMobileEndpointTurnClaim();
  });

  it('detaches from a run topic without server abort and keeps the pending run', async () => {
    testState.apiFetch.mockImplementation(async (_path, init) => {
      const body = JSON.parse(String(init?.body)) as { clientMessageId: string };
      return new Response(JSON.stringify({
        payload: {
          state: {
            activeRunId: 'run-123',
            activeInputId: 'input-1',
            inputs: [{ id: 'input-1', clientMessageId: body.clientMessageId }],
          },
        },
      }), { status: 202, headers: { 'Content-Type': 'application/json' } });
    });
    const sender = new AgentMessageSender();
    const pending = sender.sendMessage('hello', 'session-a');

    await vi.waitFor(() => {
      expect(testState.memory.get('pending:session-a')).toBe(JSON.stringify({ runId: 'run-123', lastSeq: 0 }));
    });

    sender.detachLocalStream();

    await expect(pending).resolves.toBeUndefined();
    expect(testState.apiFetch).not.toHaveBeenCalledWith(
      '/api/agent/abort',
      expect.anything(),
    );
    expect(testState.memory.get('pending:session-a')).toBe(JSON.stringify({ runId: 'run-123', lastSeq: 0 }));
  });

  it('clears an expired run after a replay gap', async () => {
    const sender = new AgentMessageSender();
    const pending = sender.resume('run-expired', 'session-a');

    await vi.waitFor(() => expect(testState.realtimeListener).toBeDefined());
    testState.realtimeListener?.onGap?.({
      topic: 'run:run-expired', requestedSeq: 0, earliestSeq: 1, recoverable: false,
    });

    await expect(pending).rejects.toBeInstanceOf(AgentStreamReplayExpiredError);
    expect(testState.memory.get('pending:session-a')).toBeUndefined();
  });

  it('does not let an older attachment clear a newer pending run', async () => {
    const sender = new AgentMessageSender();
    const pending = sender.resume('run-old', 'session-a');
    await vi.waitFor(() => expect(testState.realtimeListener).toBeDefined());
    testState.memory.set('pending:session-a', JSON.stringify({ runId: 'run-new', lastSeq: 0 }));

    testState.realtimeListener?.onEvent?.({
      topic: 'run:run-old',
      seq: 4,
      event: 'run_end',
      data: {
        type: 'run_end',
        runId: 'run-old',
        sessionKey: 'session-a',
        payload: { status: 'success' },
      },
    });

    await pending;
    expect(testState.memory.get('pending:session-a')).toBe(JSON.stringify({ runId: 'run-new', lastSeq: 0 }));
  });

  it('requests an immediate realtime reconnect while waiting for the endpoint claim', async () => {
    clearMobileEndpointTurnClaim();
    testState.apiFetch.mockResolvedValue(new Response(JSON.stringify({
      payload: { state: { inputs: [] } },
    }), { status: 202, headers: { 'Content-Type': 'application/json' } }));

    const sender = new AgentMessageSender();
    const pending = sender.sendMessage('hello', 'session-a');

    await vi.waitFor(() => expect(testState.reconnect).toHaveBeenCalledOnce());
    publishMobileEndpointTurnClaim('mobile-test', 'replacement-turn-token');

    await expect(pending).resolves.toBeUndefined();
  });

  it('submits task chat messages through the bound task endpoint', async () => {
    testState.apiFetch.mockResolvedValue(new Response(JSON.stringify({
      payload: { state: { inputs: [] } },
    }), { status: 202, headers: { 'Content-Type': 'application/json' } }));

    await new AgentMessageSender().sendMessage('hello', 'session-a', undefined, undefined, 'task/1');

    expect(testState.apiFetch).toHaveBeenCalledWith(
      '/api/tasks/task%2F1/inputs',
      expect.objectContaining({
        headers: { 'X-Xopc-Expected-Session-Key': 'session-a' },
      }),
    );
  });

  it('times out a stalled run attachment and preserves it for recovery', async () => {
    vi.useFakeTimers();
    const sender = new AgentMessageSender();
    const pending = sender.resume('run-stalled', 'session-a');
    const rejected = expect(pending).rejects.toThrow('stream attach timed out');

    await vi.advanceTimersByTimeAsync(15_000);

    await rejected;
    expect(testState.reconnect).toHaveBeenCalledOnce();
    expect(testState.memory.get('pending:session-a')).toBe(JSON.stringify({ runId: 'run-stalled', lastSeq: 0 }));
  });

  it('retries an ambiguous submission with the same client message id', async () => {
    vi.useFakeTimers();
    testState.apiFetch
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        payload: { state: { inputs: [] } },
      }), { status: 202, headers: { 'Content-Type': 'application/json' } }));
    const sender = new AgentMessageSender();
    const pending = sender.sendMessage('hello', 'session-a');

    await vi.advanceTimersByTimeAsync(500);
    await pending;

    const first = JSON.parse(String(testState.apiFetch.mock.calls[0]?.[1]?.body)) as { clientMessageId: string };
    const second = JSON.parse(String(testState.apiFetch.mock.calls[1]?.[1]?.body)) as { clientMessageId: string };
    expect(second.clientMessageId).toBe(first.clientMessageId);
    expect(testState.memory.has('session-input-outbox:session-a')).toBe(false);
  });

  it('keeps an input durable when a successful response body is truncated', async () => {
    testState.apiFetch.mockResolvedValue(new Response('not-json', { status: 202 }));
    const sender = new AgentMessageSender();

    await expect(sender.sendMessage('hello', 'session-a')).rejects.toThrow('Network response was invalid');

    expect(testState.memory.has('session-input-outbox:session-a')).toBe(true);
  });

  it('keeps an ambiguous input across sender instances and reuses its id', async () => {
    vi.useFakeTimers();
    testState.apiFetch.mockRejectedValue(new Error('Network request failed'));
    const firstSender = new AgentMessageSender();
    const firstAttempt = firstSender.sendMessage('durable', 'session-a');
    const firstRejected = expect(firstAttempt).rejects.toThrow('Network request failed');
    await vi.advanceTimersByTimeAsync(2_000);
    await firstRejected;

    const stored = JSON.parse(testState.memory.get('session-input-outbox:session-a')!) as {
      clientMessageId: string;
      content: string;
    };
    expect(stored.content).toBe('durable');

    testState.apiFetch.mockReset();
    testState.apiFetch.mockResolvedValue(new Response(JSON.stringify({
      payload: { state: { inputs: [] } },
    }), { status: 202, headers: { 'Content-Type': 'application/json' } }));
    const secondSender = new AgentMessageSender();
    await secondSender.retryPendingMessage('session-a');

    const retried = JSON.parse(String(testState.apiFetch.mock.calls[0]?.[1]?.body)) as {
      clientMessageId: string;
    };
    expect(retried.clientMessageId).toBe(stored.clientMessageId);
    expect(testState.memory.has('session-input-outbox:session-a')).toBe(false);
  });

  it('resumes from the last applied run sequence', async () => {
    const sender = new AgentMessageSender();
    const first = sender.resume('run-cursor', 'session-a');
    await vi.waitFor(() => expect(testState.realtimeListener).toBeDefined());
    testState.realtimeListener?.onEvent?.({
      topic: 'run:run-cursor',
      seq: 7,
      event: 'assistant_delta',
      data: { type: 'assistant_delta', payload: { delta: 'hello' } },
    });
    sender.detachLocalStream();
    await first;

    const second = sender.resume('run-cursor', 'session-a');
    await vi.waitFor(() => expect(testState.realtimeAfterSeq).toBe(7));
    sender.detachLocalStream();
    await second;
  });

  it('replays from the beginning when the UI projection was rebuilt', async () => {
    testState.memory.set('pending:session-a', JSON.stringify({ runId: 'run-cursor', lastSeq: 7 }));
    const sender = new AgentMessageSender();

    const pending = sender.resume('run-cursor', 'session-a', undefined, { replayFromStart: true });

    await vi.waitFor(() => expect(testState.realtimeAfterSeq).toBe(0));
    sender.detachLocalStream();
    await pending;
  });
});
