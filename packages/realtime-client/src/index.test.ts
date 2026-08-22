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
  closeCode?: number;
  closeReason?: string;
  send(data: string): void { this.sent.push(data); }
  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.closeCode = code;
    this.closeReason = reason;
  }
  open(): void { this.readyState = 1; this.onopen?.({}); }
}

function serverMessage(kind: string, payload: object): string {
  return JSON.stringify({
    protocolVersion: REALTIME_PROTOCOL_VERSION,
    messageId: crypto.randomUUID(),
    kind,
    sentAt: Date.now(),
    payload,
  });
}

function readyPayload() {
  return {
    connectionId: crypto.randomUUID(),
    heartbeatIntervalMs: 15_000,
    heartbeatTimeoutMs: 45_000,
  };
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

  it('reconnects from the last acknowledged topic cursor', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const sockets: FakeSocket[] = [];
    const client = new RealtimeClient({
      clientId: 'c1',
      clientKind: 'web',
      createMessageId: () => crypto.randomUUID(),
      getWebSocketUrl: () => 'ws://gateway/realtime',
      issueTicket: async () => 'x'.repeat(32),
      createWebSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    client.subscribe('run:r1', 0);
    client.connect();
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0]!.open();
    sockets[0]!.onmessage?.({ data: serverMessage('realtime.ready', readyPayload()) });
    sockets[0]!.onmessage?.({ data: serverMessage('realtime.subscribed', { topic: 'run:r1', cursor: 0 }) });
    sockets[0]!.onmessage?.({
      data: serverMessage('realtime.event', { topic: 'run:r1', seq: 1, event: 'run.start', data: {} }),
    });
    sockets[0]!.onclose?.({ code: 1006, reason: 'network changed' });

    await vi.advanceTimersByTimeAsync(500);
    expect(sockets).toHaveLength(2);
    sockets[1]!.open();
    expect(JSON.parse(sockets[1]!.sent[0]!)).toMatchObject({
      kind: 'realtime.hello',
      payload: { subscriptions: [{ topic: 'run:r1', afterSeq: 1 }] },
    });
    client.disconnect();
    vi.useRealTimers();
  });

  it('closes a half-open socket when server heartbeats stop', async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const client = new RealtimeClient({
      clientId: 'c1',
      clientKind: 'mobile',
      createMessageId: () => crypto.randomUUID(),
      getWebSocketUrl: () => 'ws://gateway/realtime',
      issueTicket: async () => 'x'.repeat(32),
      createWebSocket: () => socket,
    });
    client.connect();
    await vi.waitFor(() => expect(socket.onopen).not.toBeNull());
    socket.open();
    socket.onmessage?.({ data: serverMessage('realtime.ready', readyPayload()) });

    await vi.advanceTimersByTimeAsync(45_000);

    expect(socket.closeCode).toBe(1000);
    expect(socket.closeReason).toBe('Client reconnecting');
    client.disconnect();
    vi.useRealTimers();
  });

  it('aborts a connection attempt that never receives a ticket', async () => {
    vi.useFakeTimers();
    let ticketSignal: AbortSignal | undefined;
    const client = new RealtimeClient({
      clientId: 'c1',
      clientKind: 'web',
      getWebSocketUrl: () => 'ws://gateway/realtime',
      issueTicket: async (signal) => {
        ticketSignal = signal;
        return new Promise<string>(() => {});
      },
      createWebSocket: () => new FakeSocket(),
      connectionTimeoutMs: 2_000,
    });
    client.connect();

    await vi.advanceTimersByTimeAsync(2_000);

    expect(ticketSignal?.aborted).toBe(true);
    client.disconnect();
    vi.useRealTimers();
  });

  it('ignores a ticket that resolves after the connection deadline', async () => {
    vi.useFakeTimers();
    let resolveTicket: ((ticket: string) => void) | undefined;
    const createWebSocket = vi.fn(() => new FakeSocket());
    const client = new RealtimeClient({
      clientId: 'c1',
      clientKind: 'web',
      getWebSocketUrl: () => 'ws://gateway/realtime',
      issueTicket: () => new Promise<string>((resolve) => {
        resolveTicket = resolve;
      }),
      createWebSocket,
      connectionTimeoutMs: 2_000,
      maxReconnectAttempts: 0,
    });
    client.connect();

    await vi.advanceTimersByTimeAsync(2_000);
    resolveTicket?.('x'.repeat(32));
    await Promise.resolve();

    expect(createWebSocket).not.toHaveBeenCalled();
    client.disconnect();
    vi.useRealTimers();
  });

  it('waits for gap reconciliation before delivering retained events', async () => {
    const socket = new FakeSocket();
    const onEvent = vi.fn();
    let finishReconciliation: (() => void) | undefined;
    const client = new RealtimeClient({
      clientId: 'c1',
      clientKind: 'web',
      createMessageId: () => crypto.randomUUID(),
      getWebSocketUrl: () => 'ws://gateway/realtime',
      issueTicket: async () => 'x'.repeat(32),
      createWebSocket: () => socket,
      onGap: () => new Promise<void>((resolve) => {
        finishReconciliation = resolve;
      }),
      onEvent,
    });
    client.subscribe('run:r1', 0);
    client.connect();
    await vi.waitFor(() => expect(socket.onopen).not.toBeNull());
    socket.open();
    socket.onmessage?.({ data: serverMessage('realtime.ready', readyPayload()) });
    socket.onmessage?.({
      data: serverMessage('realtime.gap', {
        topic: 'run:r1', requestedSeq: 0, earliestSeq: 4, recoverable: true,
      }),
    });
    socket.onmessage?.({
      data: serverMessage('realtime.event', {
        topic: 'run:r1', seq: 4, event: 'assistant.delta', data: { delta: 'after gap' },
      }),
    });

    expect(onEvent).not.toHaveBeenCalled();
    finishReconciliation?.();
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledOnce());
    client.disconnect();
  });

  it('does not deliver a replayed event twice', async () => {
    const socket = new FakeSocket();
    const onEvent = vi.fn();
    const client = new RealtimeClient({
      clientId: 'c1',
      clientKind: 'web',
      createMessageId: () => crypto.randomUUID(),
      getWebSocketUrl: () => 'ws://gateway/realtime',
      issueTicket: async () => 'x'.repeat(32),
      createWebSocket: () => socket,
      onEvent,
    });
    client.subscribe('run:r1', 0);
    client.connect();
    await vi.waitFor(() => expect(socket.onopen).not.toBeNull());
    socket.open();
    socket.onmessage?.({ data: serverMessage('realtime.ready', readyPayload()) });
    const event = serverMessage('realtime.event', {
      topic: 'run:r1', seq: 1, event: 'assistant.delta', data: { delta: 'hello' },
    });
    socket.onmessage?.({ data: event });
    socket.onmessage?.({ data: event });

    expect(onEvent).toHaveBeenCalledOnce();
    client.disconnect();
  });
});
