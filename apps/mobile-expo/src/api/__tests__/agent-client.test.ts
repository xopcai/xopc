import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  memory: new Map<string, string>(),
  apiFetch: vi.fn(),
  reconnect: vi.fn(),
  unsubscribe: vi.fn(),
  realtimeListener: undefined as undefined | { onGap?: () => void },
}));

vi.mock('../client', () => ({
  apiFetch: testState.apiFetch,
  formatApiHttpError: vi.fn((status: number, statusText: string, message?: string) =>
    message ? `${status} ${statusText}: ${message}` : `${status} ${statusText}`,
  ),
  notifyUnauthorizedIfNeeded: vi.fn(),
}));

vi.mock('../../features/gateway/use-gateway-realtime', () => ({
  requestMobileRealtimeReconnect: testState.reconnect,
  subscribeMobileRealtimeTopic: vi.fn((_topic: string, listener: { onGap?: () => void }) => {
    testState.realtimeListener = listener;
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

import { AgentMessageSender } from '../agent-client';
import {
  clearMobileEndpointTurnClaim,
  publishMobileEndpointTurnClaim,
} from '../../features/endpoint-tools/turn-claim';

describe('AgentMessageSender local detach', () => {
  beforeEach(() => {
    testState.memory.clear();
    testState.apiFetch.mockReset();
    testState.reconnect.mockReset();
    testState.unsubscribe.mockReset();
    testState.realtimeListener = undefined;
    publishMobileEndpointTurnClaim('mobile-test', 'test-turn-token');
  });

  afterEach(() => {
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
      expect(testState.memory.get('pending:session-a')).toBe(JSON.stringify({ runId: 'run-123' }));
    });

    sender.detachLocalStream();

    await expect(pending).resolves.toBeUndefined();
    expect(testState.apiFetch).not.toHaveBeenCalledWith(
      '/api/agent/abort',
      expect.anything(),
    );
    expect(testState.memory.get('pending:session-a')).toBe(JSON.stringify({ runId: 'run-123' }));
  });

  it('clears an expired run after a replay gap', async () => {
    const sender = new AgentMessageSender();
    const pending = sender.resume('run-expired', 'session-a');

    await vi.waitFor(() => expect(testState.realtimeListener).toBeDefined());
    testState.realtimeListener?.onGap?.();

    await expect(pending).rejects.toThrow('realtime replay expired');
    expect(testState.memory.get('pending:session-a')).toBeUndefined();
  });

  it('requests an immediate realtime reconnect while waiting for the endpoint claim', async () => {
    clearMobileEndpointTurnClaim();
    testState.apiFetch.mockResolvedValue(new Response(JSON.stringify({
      payload: { state: { inputs: [] } },
    }), { status: 202, headers: { 'Content-Type': 'application/json' } }));

    const sender = new AgentMessageSender();
    const pending = sender.sendMessage('hello', 'session-a');

    expect(testState.reconnect).toHaveBeenCalledOnce();
    publishMobileEndpointTurnClaim('mobile-test', 'replacement-turn-token');

    await expect(pending).resolves.toBeUndefined();
  });
});
