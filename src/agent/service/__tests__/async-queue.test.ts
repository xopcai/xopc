import { describe, expect, it } from 'vitest';

import { AsyncQueue, AsyncQueueOverflowError } from '../async-queue.js';

describe('AsyncQueue', () => {
  it('evicts old lossy events while preserving critical events', async () => {
    const queue = new AsyncQueue<{ type: string; value: number }>({
      maxBuffered: 3,
      isDroppable: (event) => event.type === 'progress',
    });
    queue.push({ type: 'critical', value: 1 });
    queue.push({ type: 'progress', value: 2 });
    queue.push({ type: 'critical', value: 3 });
    queue.push({ type: 'progress', value: 4 });
    queue.close();

    const values: number[] = [];
    for await (const event of queue) values.push(event.value);

    expect(values).toEqual([1, 3, 4]);
    expect(queue.droppedCount).toBe(1);
  });

  it('drops incoming lossy events when only critical events are buffered', async () => {
    const queue = new AsyncQueue<{ type: string; value: number }>({
      maxBuffered: 2,
      isDroppable: (event) => event.type === 'progress',
    });
    queue.push({ type: 'critical', value: 1 });
    queue.push({ type: 'critical', value: 2 });
    expect(queue.push({ type: 'progress', value: 3 })).toBe(false);
    queue.close();

    const values: number[] = [];
    for await (const event of queue) values.push(event.value);
    expect(values).toEqual([1, 2]);
  });

  it('fails instead of exceeding the bound when only critical events are buffered', async () => {
    const queue = new AsyncQueue<{ type: string; value: number }>({
      maxBuffered: 2,
      isDroppable: (event) => event.type === 'progress',
    });
    queue.push({ type: 'critical', value: 1 });
    queue.push({ type: 'critical', value: 2 });

    expect(() => queue.push({ type: 'critical', value: 3 }))
      .toThrow(AsyncQueueOverflowError);
    queue.close();

    const values: number[] = [];
    for await (const event of queue) values.push(event.value);
    expect(values).toEqual([1, 2]);
  });
});
