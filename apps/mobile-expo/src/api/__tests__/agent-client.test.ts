import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  memory: new Map<string, string>(),
  apiFetch: vi.fn(),
  consumeAgentSseXhr: vi.fn(),
}));

vi.mock('@xopcai/gateway-sse-client', () => ({
  consumeAgentSseResponse: vi.fn(),
  consumeAgentSseXhr: testState.consumeAgentSseXhr,
  isEventStreamResponse: vi.fn(() => true),
  shouldUseXhrForAgentSse: vi.fn(() => true),
}));

vi.mock('../client', () => ({
  apiFetch: testState.apiFetch,
  buildAgentSseHeaders: vi.fn(() => ({ Accept: 'text/event-stream' })),
  formatApiHttpError: vi.fn((status: number, statusText: string, message?: string) =>
    message ? `${status} ${statusText}: ${message}` : `${status} ${statusText}`,
  ),
  notifyUnauthorizedIfNeeded: vi.fn(),
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

import { AgentMessageSender } from '../agent-client';

describe('AgentMessageSender local detach', () => {
  beforeEach(() => {
    testState.memory.clear();
    testState.apiFetch.mockReset();
    testState.consumeAgentSseXhr.mockReset();
  });

  it('drops the local SSE transport without server abort and keeps the pending run', async () => {
    testState.consumeAgentSseXhr.mockImplementation((_url, init, _callbacks, opts) => {
      opts.savePendingRunId('session-a', 'run-123');
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    const sender = new AgentMessageSender();
    const pending = sender.sendMessage('hello', 'session-a');

    expect(testState.memory.get('pending:session-a')).toBe(JSON.stringify({ runId: 'run-123' }));

    sender.detachLocalStream();

    await expect(pending).resolves.toBeUndefined();
    expect(testState.apiFetch).not.toHaveBeenCalledWith(
      '/api/agent/abort',
      expect.anything(),
    );
    expect(testState.memory.get('pending:session-a')).toBe(JSON.stringify({ runId: 'run-123' }));
  });
});
