import { afterEach, describe, expect, it, vi } from 'vitest';

import { coalesceThinkingDeltas } from '../thinking-delta-coalescer.js';
import type { AssistantDeltaEvent, ChatStreamEvent, ThinkingDeltaEvent } from '../protocol.js';

function thinking(delta: string, messageId = 'message-1'): ThinkingDeltaEvent {
  return {
    type: 'thinking_delta',
    runId: 'run-1',
    sessionKey: 'session-1',
    timestamp: 1,
    payload: { messageId, delta },
  };
}

function assistant(delta: string): AssistantDeltaEvent {
  return {
    type: 'assistant_delta',
    runId: 'run-1',
    sessionKey: 'session-1',
    timestamp: 1,
    payload: { messageId: 'message-1', delta },
  };
}

async function collect(source: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const item of source) events.push(item);
  return events;
}

describe('coalesceThinkingDeltas', () => {
  afterEach(() => vi.useRealTimers());

  it('combines a synchronous provider burst before a boundary event', async () => {
    async function* source() {
      yield thinking(' ');
      yield thinking('30');
      yield thinking('-minute');
      yield thinking(' plan');
      yield thinking('.');
      yield assistant('Done');
    }

    const output = await collect(coalesceThinkingDeltas(source()));

    expect(output.map((item) => item.type)).toEqual(['thinking_delta', 'assistant_delta']);
    expect(output[0]).toMatchObject({ payload: { delta: ' 30-minute plan.' } });
  });

  it('flushes when the character limit is reached', async () => {
    async function* source() {
      yield thinking('abc');
      yield thinking('def');
      yield thinking('g');
    }

    const output = await collect(coalesceThinkingDeltas(source(), { maxChars: 5 }));

    expect(output.map((item) => item.payload)).toEqual([
      { messageId: 'message-1', delta: 'abcdef' },
      { messageId: 'message-1', delta: 'g' },
    ]);
  });

  it('flushes the active stream before a different message starts', async () => {
    async function* source() {
      yield thinking('first', 'message-1');
      yield thinking('second', 'message-2');
    }

    const output = await collect(coalesceThinkingDeltas(source()));

    expect(output.map((item) => item.payload)).toEqual([
      { messageId: 'message-1', delta: 'first' },
      { messageId: 'message-2', delta: 'second' },
    ]);
  });

  it('flushes on the time window while the provider is idle', async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    async function* source() {
      yield thinking('visible');
      await new Promise<void>((resolve) => { release = resolve; });
    }
    const iterator = coalesceThinkingDeltas(source(), { windowMs: 24 })[Symbol.asyncIterator]();
    const first = iterator.next();

    await vi.advanceTimersByTimeAsync(24);
    await expect(first).resolves.toMatchObject({
      done: false,
      value: { type: 'thinking_delta', payload: { delta: 'visible' } },
    });

    release?.();
    await iterator.return?.();
  });

  it('flushes pending thinking before propagating a provider error', async () => {
    async function* source() {
      yield thinking('preserved');
      throw new Error('provider failed');
    }
    const iterator = coalesceThinkingDeltas(source())[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'thinking_delta', payload: { delta: 'preserved' } },
    });
    await expect(iterator.next()).rejects.toThrow('provider failed');
  });
  it('handles a rejected prefetched event after the consumer interrupts', async () => {
    let reject!: (error: Error) => void;
    const pending = new Promise<void>((_resolve, fail) => { reject = fail; });
    let cleaned = false;
    async function* source() {
      try { yield assistant('Hello'); await pending; }
      finally { cleaned = true; }
    }
    const iterator = coalesceThinkingDeltas(source());
    await iterator.next();
    reject(new DOMException('Interrupted', 'AbortError'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    await iterator.return();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(cleaned).toBe(true);
  });

});
