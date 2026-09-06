import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RealtimeEventPayload } from '@xopcai/realtime-protocol';

const testState = vi.hoisted(() => ({
  memory: new Map<string, string>(),
  apiFetch: vi.fn(),
  apiUploadFile: vi.fn(),
  language: 'zh' as 'en' | 'zh',
  gatewayId: 'computer-a',
  generation: 1,
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
      activeGatewayId: testState.gatewayId,
      connectionGeneration: testState.generation,
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

import type { MessageSubmission } from '../../features/chat/message-submission';

function submission(overrides: Partial<MessageSubmission> = {}): MessageSubmission {
  return {
    clientMessageId: 'message-a', gatewayId: 'computer-a', sessionKey: 'session-a',
    expectedSessionId: 'instance-a', content: 'hello', attachments: [], contextRefs: [], ...overrides,
  };
}

function accepted(runId?: string): Response {
  return new Response(JSON.stringify({ payload: { state: {
    activeRunId: runId, inputs: [{ id: 'input-a', clientMessageId: 'message-a' }],
  } } }), { status: 202 });
}

describe('AgentMessageSender voice message', () => {
  beforeEach(() => {
    testState.memory.clear();
    testState.gatewayId = 'computer-a';
    testState.generation = 1;
    testState.apiFetch.mockReset();
    testState.apiUploadFile.mockReset();
    testState.language = 'zh';
    vi.mocked(readUriAsBase64).mockReset();
    clearMobileEndpointTurnClaim();
  });

  afterEach(() => {
    clearMobileEndpointTurnClaim();
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
      await new AgentMessageSender().sendMessage(submission({ content: '', attachments: [{
        type: 'voice', localUri: 'file:///documents/voice.m4a',
        durationSeconds: 1.25, mimeType: 'audio/mp4',
      }] }));
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

  it('submits frozen note context references', async () => {
    publishMobileEndpointTurnClaim('mobile-test', 'test-turn-token');
    testState.apiFetch.mockResolvedValue(accepted());

    await new AgentMessageSender().sendMessage(submission({
      contextRefs: [{ kind: 'note', sourceId: 'note-1', expectedVersion: '42' }],
    }));

    const body = JSON.parse(String(testState.apiFetch.mock.calls[0]?.[1]?.body));
    expect(body.contextRefs).toEqual([{ kind: 'note', sourceId: 'note-1', expectedVersion: '42' }]);
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
      parameters: { language: 'zh' },
      timeoutMs: 60_000,
      recoverRouteOnNetworkError: true,
    });
  });

  it('normalizes a caller locale override to an STT language code', async () => {
    testState.apiUploadFile.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      payload: { text: 'hello', refinementAvailable: false },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await transcribeVoice('file:///documents/voice.m4a', 'audio/mp4', { language: 'en-US' });

    expect(testState.apiUploadFile).toHaveBeenCalledWith(
      '/api/voice/transcriptions',
      expect.objectContaining({ parameters: { language: 'en' } }),
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
      expect.objectContaining({ parameters: { language: 'en' } }),
    );
  });

  it.each([
    [' zh-CN ', 'zh'],
    ['EN_us', 'en'],
    ['ja-JP', 'ja'],
    ['auto', 'auto'],
    ['', 'zh'],
  ])('uses a provider language code for %j', async (locale, language) => {
    testState.apiUploadFile.mockResolvedValue(new Response(JSON.stringify({
      ok: true, payload: { text: 'hello', refinementAvailable: false },
    }), { status: 200 }));

    await transcribeVoice('file:///documents/voice.m4a', 'audio/mp4', { language: locale });

    expect(testState.apiUploadFile).toHaveBeenCalledWith(
      '/api/voice/transcriptions',
      expect.objectContaining({ parameters: { language } }),
    );
  });

  it('preserves gateway transcription error details for the recording UI', async () => {
    testState.apiUploadFile.mockResolvedValue(new Response(JSON.stringify({
      ok: false, error: { message: 'STT is not configured' },
    }), { status: 503, statusText: 'Service Unavailable' }));

    await expect(transcribeVoice('file:///documents/voice.m4a', 'audio/mp4'))
      .rejects.toThrow('503 Service Unavailable: STT is not configured');
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
    testState.gatewayId = 'computer-a';
    testState.generation = 1;
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
    const sender = new AgentMessageSender();
    const pending = sender.resume('run-123', 'session-a');

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
    testState.apiFetch.mockResolvedValue(accepted());

    const sender = new AgentMessageSender();
    const pending = sender.sendMessage(submission());

    await vi.waitFor(() => expect(testState.reconnect).toHaveBeenCalledOnce());
    publishMobileEndpointTurnClaim('mobile-test', 'replacement-turn-token');

    await expect(pending).resolves.toEqual({ runId: undefined });
  });

  it('submits task chat messages through the bound task endpoint', async () => {
    testState.apiFetch.mockResolvedValue(accepted());

    await new AgentMessageSender().sendMessage(submission({ taskId: 'task/1' }));

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

  it('returns on acceptance without subscribing to or waiting for the AI run', async () => {
    testState.apiFetch.mockResolvedValue(accepted('run-a'));
    await expect(new AgentMessageSender().sendMessage(submission())).resolves.toEqual({ runId: 'run-a' });
    expect(testState.realtimeListener).toBeUndefined();
  });

  it('does not automatically retry network failures and preserves the id for manual retry', async () => {
    const input = submission();
    testState.apiFetch.mockRejectedValueOnce(new Error('Network request failed'));
    await expect(new AgentMessageSender().sendMessage(input)).rejects.toThrow('Network request failed');
    expect(testState.apiFetch).toHaveBeenCalledTimes(1);
    testState.apiFetch.mockResolvedValueOnce(accepted());
    await new AgentMessageSender().sendMessage(input);
    const bodies = testState.apiFetch.mock.calls.map(([, init]) => JSON.parse(String(init.body)));
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[1].clientMessageId).toBe('message-a');
  });

  it('does not automatically retry a rejected HTTP request', async () => {
    testState.apiFetch.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Busy' } }), { status: 503 }));
    await expect(new AgentMessageSender().sendMessage(submission())).rejects.toThrow('Busy');
    expect(testState.apiFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a truncated or malformed acknowledgement', async () => {
    testState.apiFetch.mockResolvedValueOnce(new Response('not-json', { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ payload: { state: {
        inputs: null,
      } } }), { status: 202 }));
    const input = submission();
    await expect(new AgentMessageSender().sendMessage(input)).rejects.toThrow('Network response was invalid');
    await expect(new AgentMessageSender().sendMessage(input)).rejects.toThrow('Network response was invalid');
    expect(input.clientMessageId).toBe('message-a');
  });

  it('accepts a manual retry after the original run has already completed', async () => {
    testState.apiFetch.mockResolvedValue(new Response(JSON.stringify({
      payload: { state: { inputs: [] } },
    }), { status: 202 }));
    await expect(new AgentMessageSender().sendMessage(submission())).resolves.toEqual({ runId: undefined });
    expect(testState.apiFetch).toHaveBeenCalledTimes(1);
    expect(testState.realtimeListener).toBeUndefined();
  });

  it('keeps uploaded voice references for manual retry after an ambiguous submission', async () => {
    testState.apiUploadFile.mockReset();
    testState.apiUploadFile.mockResolvedValue(new Response(JSON.stringify({ ok: true, payload: {
      uri: 'media://voice.m4a', name: 'voice.m4a', mimeType: 'audio/mp4', size: 100,
    } }), { status: 201 }));
    testState.apiFetch.mockRejectedValueOnce(new Error('Network request failed')).mockResolvedValueOnce(accepted());
    const input = submission({ attachments: [{ type: 'voice', localUri: 'file:///voice.m4a', durationSeconds: 1.25 }] });
    await expect(new AgentMessageSender().sendMessage(input)).rejects.toThrow('Network request failed');
    await new AgentMessageSender().sendMessage(input);
    expect(testState.apiUploadFile).toHaveBeenCalledTimes(1);
    const bodies = testState.apiFetch.mock.calls.map(([, init]) => JSON.parse(String(init.body)));
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[1].attachments[0]).toMatchObject({ uri: 'media://voice.m4a', durationSeconds: 1.25 });
  });

  it('resolves missing session identity before sending and keeps it on the message', async () => {
    testState.apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      session: { key: 'session-a', sessionId: 'resolved-instance', messages: [] },
    }), { status: 200 })).mockResolvedValueOnce(accepted());
    const input = submission({ expectedSessionId: undefined });
    await new AgentMessageSender().sendMessage(input);
    expect(input.expectedSessionId).toBe('resolved-instance');
    expect(JSON.parse(String(testState.apiFetch.mock.calls[1][1].body)).expectedSessionId).toBe('resolved-instance');
  });

  it('does not submit to another connection after uploading media', async () => {
    testState.apiUploadFile.mockReset();
    testState.apiUploadFile.mockImplementationOnce(async () => {
      testState.generation++;
      return new Response(JSON.stringify({ ok: true, payload: {
        uri: 'media://voice.m4a', name: 'voice.m4a', mimeType: 'audio/mp4', size: 100,
      } }), { status: 201 });
    });
    await expect(new AgentMessageSender().sendMessage(submission({ attachments: [
      { type: 'voice', localUri: 'file:///voice.m4a' },
    ] }))).rejects.toThrow('Active work computer changed');
    expect(testState.apiFetch).not.toHaveBeenCalled();
  });

  it('rejects submissions after switching computers', async () => {
    const input = submission({ gatewayId: 'another-computer' });
    await expect(new AgentMessageSender().sendMessage(input)).rejects.toThrow('Active work computer changed');
    expect(testState.apiFetch).not.toHaveBeenCalled();
  });

  it('preserves the original session identity on retry after a reset', async () => {
    const input = submission();
    testState.apiFetch.mockImplementation(async () => new Response(JSON.stringify({ error: { message: 'Session changed' } }), { status: 409 }));
    await expect(new AgentMessageSender().sendMessage(input)).rejects.toThrow('Session changed');
    await expect(new AgentMessageSender().sendMessage(input)).rejects.toThrow('Session changed');
    for (const [, init] of testState.apiFetch.mock.calls) {
      expect(JSON.parse(String(init.body)).expectedSessionId).toBe('instance-a');
    }
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
