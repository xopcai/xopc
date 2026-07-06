import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createOfflineQueue } from '../offline-queue';

const memory = new Map<string, string>();

vi.mock('../../storage/mmkv', () => ({
  storage: {
    getString: (key: string) => memory.get(key),
    set: (key: string, value: string | number | boolean) => {
      memory.set(key, String(value));
    },
    delete: (key: string) => {
      memory.delete(key);
    },
  },
}));

describe('createOfflineQueue dead letters', () => {
  beforeEach(() => {
    memory.clear();
    vi.setSystemTime(new Date('2026-06-11T10:00:00Z'));
  });

  it('moves failed operations into dead letters after retry budget is exhausted', async () => {
    const processor = vi.fn().mockRejectedValue(new Error('network failed'));
    const queue = createOfflineQueue<{ text: string }>({
      namespace: 'test:dead-letter',
      processor,
      maxRetries: 2,
    });

    const operationId = queue.enqueue({ text: 'hello' });

    expect(await queue.flush()).toBe(0);
    expect(queue.pendingCount()).toBe(1);
    expect(queue.deadLetterCount()).toBe(0);

    expect(await queue.flush()).toBe(0);

    expect(queue.pendingCount()).toBe(0);
    expect(queue.deadLetterCount()).toBe(1);
    expect(queue.deadLetters()[0]).toMatchObject({
      id: operationId,
      payload: { text: 'hello' },
      retryCount: 2,
      reason: 'network failed',
    });
  });

  it('can retry, remove, and clear dead-letter operations', async () => {
    const processor = vi.fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('remove'))
      .mockRejectedValueOnce(new Error('clear'));
    const queue = createOfflineQueue<{ text: string }>({
      namespace: 'test:retry-dead-letter',
      processor,
      maxRetries: 1,
    });

    const operationId = queue.enqueue({ text: 'retry me' });
    await queue.flush();

    expect(queue.deadLetterCount()).toBe(1);
    expect(queue.retryDeadLetter(operationId)).toBe(true);
    expect(queue.deadLetterCount()).toBe(0);
    expect(queue.pendingCount()).toBe(1);

    expect(await queue.flush()).toBe(1);
    expect(queue.pendingCount()).toBe(0);

    queue.enqueue({ text: 'remove me' });
    await queue.flush();
    expect(queue.deadLetterCount()).toBe(1);
    queue.removeDeadLetter(queue.deadLetters()[0].id);
    expect(queue.deadLetterCount()).toBe(0);

    queue.enqueue({ text: 'clear me' });
    await queue.flush();
    expect(queue.deadLetterCount()).toBe(1);
    queue.clearDeadLetters();
    expect(queue.deadLetterCount()).toBe(0);
  });
});
