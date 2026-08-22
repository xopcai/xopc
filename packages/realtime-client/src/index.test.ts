import { describe, expect, it, vi } from 'vitest';

import { REALTIME_PROTOCOL_VERSION } from '@xopcai/realtime-protocol';
import { ENDPOINT_PROTOCOL_VERSION } from '@xopcai/endpoint-tools-protocol';
import { RealtimeClient, type RealtimeWebSocket } from './index.js';

class FakeSocket implements RealtimeWebSocket {
  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
  sent: string[] = [];
  send(data: string): void { this.sent.push(data); }
  close(): void { this.readyState = 3; }
  open(): void { this.readyState = 1; this.onopen?.({}); }
}

describe('RealtimeClient', () => {
  it('opens only one connection when connect is called repeatedly', async () => {
    let resolveTicket: ((ticket: string) => void) | undefined;
    const issueTicket = vi.fn(() => new Promise<string>((resolve) => {
      resolveTicket = resolve;
    }));
    const createWebSocket = vi.fn(() => new FakeSocket());
    const client = new RealtimeClient({
      clientId: 'c1',
      clientKind: 'web',
      getWebSocketUrl: () => 'ws://gateway/realtime',
      issueTicket,
      createWebSocket,
    });

    client.connect();
    client.connect();
    resolveTicket?.('x'.repeat(32));

    await vi.waitFor(() => expect(createWebSocket).toHaveBeenCalledOnce());
    expect(issueTicket).toHaveBeenCalledOnce();
    client.disconnect();
  });

  it('authenticates, subscribes once, and advances cursors', async () => {
    const socket = new FakeSocket();
    const onEvent = vi.fn();
    const client = new RealtimeClient({
      clientId: 'c1',
      clientKind: 'web',
      createMessageId: () => '00000000-0000-4000-8000-000000000001',
      getWebSocketUrl: () => 'ws://gateway/realtime',
      issueTicket: async () => 'x'.repeat(32),
      createWebSocket: () => socket,
      onEvent,
    });
    client.subscribe('run:r1', 0);
    client.connect();
    await vi.waitFor(() => expect(socket.onopen).not.toBeNull());
    socket.open();
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({
      messageId: '00000000-0000-4000-8000-000000000001',
      kind: 'realtime.hello',
      payload: { subscriptions: [{ topic: 'run:r1', afterSeq: 0 }] },
    });
    socket.onmessage?.({ data: JSON.stringify({
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      messageId: crypto.randomUUID(),
      kind: 'realtime.event',
      sentAt: Date.now(),
      payload: { topic: 'run:r1', seq: 1, event: 'run.start', data: {} },
    }) });
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ seq: 1 }));
    client.disconnect();
  });

  it('attaches endpoint identity and routes endpoint messages on the same socket', async () => {
    const socket = new FakeSocket();
    const onReady = vi.fn();
    const onMessage = vi.fn();
    const client = new RealtimeClient({
      clientId: 'c1',
      clientKind: 'web',
      getWebSocketUrl: () => 'ws://gateway/realtime',
      issueTicket: async () => 'x'.repeat(32),
      createWebSocket: () => socket,
    });
    client.setEndpoint({
      createHello: async () => ({
        principalId: 'p1', endpointId: 'e1', connectionInstanceId: crypto.randomUUID(),
        displayName: 'Web', kind: 'web', platform: 'web', appVersion: '1',
        availability: 'foreground', nonce: 'n1', signedAt: Date.now(),
        signature: 'signed-endpoint-payload', tools: [],
      }),
      onReady,
      onMessage,
    });
    client.connect();
    await vi.waitFor(() => expect(socket.onopen).not.toBeNull());
    socket.open();
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({
      kind: 'realtime.hello',
      payload: { endpoint: { endpointId: 'e1', kind: 'web' } },
    });
    socket.onmessage?.({ data: JSON.stringify({
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      messageId: crypto.randomUUID(),
      kind: 'realtime.ready',
      sentAt: Date.now(),
      payload: {
        connectionId: crypto.randomUUID(),
        heartbeatIntervalMs: 15_000,
        heartbeatTimeoutMs: 45_000,
        endpoint: { endpointId: 'e1', turnToken: 't'.repeat(32) },
      },
    }) });
    expect(onReady).toHaveBeenCalledWith({ endpointId: 'e1', turnToken: 't'.repeat(32) });

    const cancel = {
      protocolVersion: ENDPOINT_PROTOCOL_VERSION,
      messageId: crypto.randomUUID(),
      type: 'tool.cancel' as const,
      sentAt: Date.now(),
      payload: { invocationId: crypto.randomUUID(), reason: 'cancelled' },
    };
    socket.onmessage?.({ data: JSON.stringify({
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      messageId: crypto.randomUUID(),
      kind: 'endpoint.message',
      sentAt: Date.now(),
      payload: cancel,
    }) });
    expect(onMessage).toHaveBeenCalledWith(cancel);
    client.disconnect();
  });
});
