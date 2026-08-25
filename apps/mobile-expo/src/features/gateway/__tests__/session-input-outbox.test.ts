import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = vi.hoisted(() => new Map<string, string>());

vi.mock('../../../storage/mmkv', () => ({
  storage: {
    getString: (key: string) => memory.get(key),
    set: (key: string, value: string | number | boolean) => memory.set(key, String(value)),
    delete: (key: string) => memory.delete(key),
  },
}));

import {
  completeSessionInput,
  enqueueSessionInput,
  readPendingSessionInput,
} from '../session-input-outbox';

describe('session input outbox', () => {
  beforeEach(() => memory.clear());

  it('persists the message id and attachment URI without base64 data', () => {
    const entry = enqueueSessionInput('session-a', 'hello', [{
      type: 'image',
      name: 'photo.jpg',
      localUri: 'file:///cache/photo.jpg',
      data: 'large-base64-payload',
    }]);

    const restored = readPendingSessionInput('session-a');
    expect(restored?.clientMessageId).toBe(entry.clientMessageId);
    expect(restored?.attachments[0]).toMatchObject({ localUri: 'file:///cache/photo.jpg' });
    expect(restored?.attachments[0]?.data).toBeUndefined();
  });

  it('reuses an identical entry and removes only the acknowledged id', () => {
    const first = enqueueSessionInput('session-a', 'hello');
    expect(enqueueSessionInput('session-a', 'hello').clientMessageId).toBe(first.clientMessageId);

    completeSessionInput('session-a', 'different');
    expect(readPendingSessionInput('session-a')).not.toBeNull();
    completeSessionInput('session-a', first.clientMessageId);
    expect(readPendingSessionInput('session-a')).toBeNull();
  });

  it('does not overwrite a different queued message', () => {
    enqueueSessionInput('session-a', 'first');
    expect(() => enqueueSessionInput('session-a', 'second')).toThrow('already waiting');
  });

  it('persists the task binding for reconnect delivery', () => {
    enqueueSessionInput('session-a', 'task message', [], 'task-1');
    expect(readPendingSessionInput('session-a')?.taskId).toBe('task-1');
  });
});
