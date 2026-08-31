// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RealtimeEventPayload } from '@xopcai/realtime-protocol';

const realtimeMock = vi.hoisted(() => ({
  instances: [] as Array<{
    options: Record<string, unknown>;
    subscriptions: Array<{ topic: string; afterSeq?: number }>;
    disconnect: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('@xopcai/realtime-client', () => ({
  RealtimeClient: class MockRealtimeClient {
    readonly subscriptions: Array<{ topic: string; afterSeq?: number }> = [];
    readonly disconnect = vi.fn();

    constructor(readonly options: Record<string, unknown>) {
      realtimeMock.instances.push(this);
    }

    subscribe(topic: string, afterSeq?: number) {
      this.subscriptions.push({ topic, afterSeq });
    }

    unsubscribe() {}
    connect() {}
    reconnect() {}
    setEndpoint() {}
    clearEndpoint() {}
    sendEndpointMessage() {}
  },
}));

import {
  startGatewayRealtime,
  stopGatewayRealtime,
  subscribeRealtimeTopic,
} from '@/features/gateway/gateway-realtime';

function emit(event: RealtimeEventPayload): void {
  const instance = realtimeMock.instances.at(-1);
  const onEvent = instance?.options.onEvent as ((value: RealtimeEventPayload) => void) | undefined;
  onEvent?.(event);
}

function event(seq: number): RealtimeEventPayload {
  return {
    topic: 'run:r1',
    seq,
    event: 'assistant_delta',
    data: { payload: { delta: String(seq) } },
  };
}

describe('gateway realtime topic multiplexing', () => {
  const cleanups: Array<() => void> = [];

  beforeEach(() => {
    realtimeMock.instances.length = 0;
    sessionStorage.clear();
    startGatewayRealtime();
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    stopGatewayRealtime();
    vi.restoreAllMocks();
  });

  it('replays for a late listener without duplicating events for an existing listener', () => {
    const first = vi.fn();
    const second = vi.fn();
    cleanups.push(subscribeRealtimeTopic('run:r1', { onEvent: first }, 0));
    emit(event(1));
    emit(event(2));

    cleanups.push(subscribeRealtimeTopic('run:r1', { onEvent: second }, 0));
    const client = realtimeMock.instances.at(-1);
    expect(client?.subscriptions.filter(({ topic }) => topic === 'run:r1')).toEqual([
      { topic: 'run:r1', afterSeq: 0 },
      { topic: 'run:r1', afterSeq: 0 },
    ]);

    emit(event(1));
    emit(event(2));
    emit(event(3));

    expect(first.mock.calls.map(([value]) => value.seq)).toEqual([1, 2, 3]);
    expect(second.mock.calls.map(([value]) => value.seq)).toEqual([1, 2, 3]);
  });

  it('reuses the latest delivered cursor when the shared client restarts', () => {
    cleanups.push(subscribeRealtimeTopic('run:r1', { onEvent: vi.fn() }, 0));
    emit(event(7));

    startGatewayRealtime();

    const restarted = realtimeMock.instances.at(-1);
    expect(restarted?.subscriptions).toContainEqual({ topic: 'run:r1', afterSeq: 7 });
  });

  it('isolates a failing topic listener from other consumers', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const healthy = vi.fn();
    cleanups.push(subscribeRealtimeTopic('run:r1', {
      onEvent: () => {
        throw new Error('consumer failed');
      },
    }, 0));
    cleanups.push(subscribeRealtimeTopic('run:r1', { onEvent: healthy }, 0));

    expect(() => emit(event(1))).not.toThrow();
    expect(healthy).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
  });
});
