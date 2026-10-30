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

it('contains synchronous socket send failures, including retry timers', () => {
  vi.useFakeTimers();
  try {
    const socket = {
      readyState: 1, bufferedAmount: 600 * 1024,
      close: vi.fn(), send: vi.fn(() => { throw new Error('socket closed during send'); }),
    } as unknown as WebSocket;
    const writer = new RealtimeSocketWriter(socket);
    const message = {
      protocolVersion: 1, messageId: 'retry', sentAt: Date.now(),
      kind: 'realtime.pong', payload: {},
    } as ServerRealtimeMessage;
    writer.enqueue(message);
    Object.assign(socket, { bufferedAmount: 0 });
    expect(() => vi.runAllTimers()).not.toThrow();
    expect(socket.close).toHaveBeenCalledWith(1011, 'Realtime delivery failed');
    expect(writer.enqueue(message)).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

function event(seq: number, size = 64 * 1024): ServerRealtimeMessage {
  return {
    protocolVersion: 1, messageId: `event-${seq}`, sentAt: Date.now(), kind: 'realtime.event',
    payload: { topic: 'run:burst', seq, event: 'assistant_delta', data: { delta: 'x'.repeat(size) } },
  };
}

it('streams replay larger than the queue limit lazily and keeps live events in order', () => {
  const callbacks: Array<(error?: Error) => void> = [];
  const socket = { readyState: 1, bufferedAmount: 0, close: vi.fn(),
    send: vi.fn((_data, callback) => callbacks.push(callback)) } as unknown as WebSocket;
  const writer = new RealtimeSocketWriter(socket);
  let produced = 0;
  writer.enqueueReplay((function* () {
    for (let i = 1; i <= 300; i++) { produced++; yield event(i); }
  })());
  expect(produced).toBe(1);
  writer.enqueue(event(301));
  while (callbacks.length) callbacks.shift()!();
  expect(produced).toBe(300);
  expect(vi.mocked(socket.send).mock.calls.map(([data]) => JSON.parse(String(data)).payload.seq))
    .toEqual(Array.from({ length: 301 }, (_, index) => index + 1));
  expect(socket.close).not.toHaveBeenCalled();
  writer.close();
});

it('cancels unsent replay on unsubscribe without blocking later live events', () => {
  const callbacks: Array<() => void> = [];
  const socket = { readyState: 1, bufferedAmount: 0, close: vi.fn(),
    send: vi.fn((_data, callback) => callbacks.push(callback)) } as unknown as WebSocket;
  const writer = new RealtimeSocketWriter(socket);
  const cancel = writer.enqueueReplay([event(1), event(2), event(3)]);
  writer.enqueue(event(4));
  cancel();
  while (callbacks.length) callbacks.shift()!();
  expect(vi.mocked(socket.send).mock.calls.map(([data]) => JSON.parse(String(data)).payload.seq)).toEqual([1, 4]);
  writer.close();
});

it('allows a live burst over 2 MiB to drain without disconnecting', () => {
  const callbacks: Array<() => void> = [];
  const socket = { readyState: 1, bufferedAmount: 0, close: vi.fn(),
    send: vi.fn((_data, callback) => callbacks.push(callback)) } as unknown as WebSocket;
  const writer = new RealtimeSocketWriter(socket);
  for (let i = 1; i <= 64; i++) expect(writer.enqueue(event(i))).toBe(true);
  while (callbacks.length) callbacks.shift()!();
  expect(socket.send).toHaveBeenCalledTimes(64);
  expect(socket.close).not.toHaveBeenCalled();
  writer.close();
});

it.each(['send', 'buffer'])('disconnects a genuinely stalled %s after a bounded wait', mode => {
  vi.useFakeTimers();
  try {
    const socket = { readyState: 1, bufferedAmount: mode === 'buffer' ? 600 * 1024 : 0,
      close: vi.fn(), send: vi.fn() } as unknown as WebSocket;
    const writer = new RealtimeSocketWriter(socket);
    writer.enqueue(event(1));
    vi.advanceTimersByTime(14_999);
    expect(socket.close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(socket.close).toHaveBeenCalledWith(4413, 'Realtime delivery stalled');
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

it('bounds memory even if live events keep arriving while delivery is blocked', () => {
  const socket = { readyState: 1, bufferedAmount: 0, close: vi.fn(), send: vi.fn() } as unknown as WebSocket;
  const writer = new RealtimeSocketWriter(socket);
  for (let i = 0; i < 300; i++) writer.enqueue(event(i));
  expect(socket.close).toHaveBeenCalledTimes(1);
  expect(socket.close).toHaveBeenCalledWith(4413, 'Realtime delivery queue limit exceeded');
});

it('renews the stall deadline on progress and clears it when delivery finishes', () => {
  vi.useFakeTimers();
  try {
    const callbacks: Array<() => void> = [];
    const socket = { readyState: 1, bufferedAmount: 0, close: vi.fn(),
      send: vi.fn((_data, callback) => callbacks.push(callback)) } as unknown as WebSocket;
    const writer = new RealtimeSocketWriter(socket);
    writer.enqueueReplay([event(1), event(2), event(3)]);
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(10_000);
      callbacks.shift()!();
    }
    vi.advanceTimersByTime(30_000);
    expect(socket.send).toHaveBeenCalledTimes(3);
    expect(socket.close).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    writer.close();
  } finally { vi.useRealTimers(); }
});

it('lets control messages pass replay without reordering replay events', () => {
  const callbacks: Array<() => void> = [];
  const socket = { readyState: 1, bufferedAmount: 0, close: vi.fn(),
    send: vi.fn((_data, callback) => callbacks.push(callback)) } as unknown as WebSocket;
  const writer = new RealtimeSocketWriter(socket);
  writer.enqueueReplay([event(1), event(2), event(3)]);
  writer.enqueue({ protocolVersion: 1, messageId: 'pong', sentAt: Date.now(), kind: 'realtime.pong', payload: {} }, 'critical');
  while (callbacks.length) callbacks.shift()!();
  expect(vi.mocked(socket.send).mock.calls.map(([data]) => JSON.parse(String(data)).messageId))
    .toEqual(['event-1', 'pong', 'event-2', 'event-3']);
  writer.close();
});
