import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = vi.hoisted(() => new Map<string, string>());
const active = vi.hoisted(() => ({ id: 'computer-a' }));
vi.mock('../../../stores/gateway-store', () => ({ useGatewayStore: { getState: () => ({ activeGatewayId: active.id }) } }));
vi.mock('../session-detail-cache', () => ({ readCachedSessionDetail: () => ({ sessionId: 'instance-a' }) }));

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
  beforeEach(() => { memory.clear(); active.id = 'computer-a'; });

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
  it('isolates the same session key across computers, including late acknowledgements', () => {
    const a = enqueueSessionInput('same', 'from A');
    active.id = 'computer-b';
    expect(readPendingSessionInput('same')).toBeNull();
    const b = enqueueSessionInput('same', 'from B');
    completeSessionInput('same', a.clientMessageId, a.gatewayId);
    expect(readPendingSessionInput('same')?.clientMessageId).toBe(b.clientMessageId);
    active.id = 'computer-a';
    expect(readPendingSessionInput('same')).toBeNull();
  });
  it('retains expired input for review instead of deleting it', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    enqueueSessionInput('same', 'keep me');
    now.mockReturnValue(1_000_000 + 25 * 60 * 60_000);
    expect(readPendingSessionInput('same')).toMatchObject({ content: 'keep me', needsReview: true });
    now.mockRestore();
  });

});
