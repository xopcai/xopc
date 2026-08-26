import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';

import type { ServerRealtimeMessage } from '@xopcai/realtime-protocol';

import { RealtimeSocketWriter } from '../writer.js';

describe('RealtimeSocketWriter', () => {
  it('closes the connection when an event cannot be serialized', () => {
    const socket = {
      readyState: 1,
      bufferedAmount: 0,
      close: vi.fn(),
      send: vi.fn(),
    } as unknown as WebSocket;
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const message = {
      kind: 'realtime.event',
      messageId: 'message-1',
      sentAt: Date.now(),
      protocolVersion: 1,
      payload: { topic: 'gateway', seq: 1, event: 'test', data: circular },
    } as ServerRealtimeMessage;

    const writer = new RealtimeSocketWriter(socket);

    expect(writer.enqueue(message)).toBe(false);
    expect(socket.close).toHaveBeenCalledWith(1011, 'Realtime message serialization failed');
    expect(socket.send).not.toHaveBeenCalled();
  });

  it('rejects a single event that exceeds the delivery limit', () => {
    const socket = {
      readyState: 1,
      bufferedAmount: 0,
      close: vi.fn(),
      send: vi.fn(),
    } as unknown as WebSocket;
    const message = {
      kind: 'realtime.event',
      messageId: 'message-large',
      sentAt: Date.now(),
      protocolVersion: 1,
      payload: {
        topic: 'run:large',
        seq: 1,
        event: 'tool_end',
        data: { result: 'x'.repeat(2 * 1024 * 1024) },
      },
    } as ServerRealtimeMessage;

    const writer = new RealtimeSocketWriter(socket);

    expect(writer.enqueue(message)).toBe(false);
    expect(socket.close).toHaveBeenCalledWith(1009, 'Realtime event exceeds delivery limit');
    expect(socket.send).not.toHaveBeenCalled();
  });
});
