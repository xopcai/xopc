import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();

vi.mock('../../../storage/mmkv', () => ({
  storage: {
    getString: (key: string) => memory.get(key),
    set: (key: string, value: string) => {
      memory.set(key, String(value));
    },
    delete: (key: string) => {
      memory.delete(key);
    },
  },
}));

import {
  clearFollowUpQueueSnapshot,
  readFollowUpQueueSnapshot,
  sanitizeFollowUpQueueSnapshot,
  writeFollowUpQueueSnapshot,
} from '../follow-up-queue-storage';

describe('follow-up-queue-storage', () => {
  beforeEach(() => {
    memory.clear();
  });

  it('roundtrips pending rows and editing id', () => {
    writeFollowUpQueueSnapshot('session-a', {
      pending: [{ id: 'row-1', text: 'queued text', thinkingLevel: 'off' }],
      editingId: 'row-1',
    });
    expect(readFollowUpQueueSnapshot('session-a')).toEqual({
      pending: [{ id: 'row-1', text: 'queued text', thinkingLevel: 'off' }],
      editingId: 'row-1',
    });
  });

  it('isolates keys per session', () => {
    writeFollowUpQueueSnapshot('a', {
      pending: [{ id: '1', text: 'a' }],
      editingId: null,
    });
    writeFollowUpQueueSnapshot('b', {
      pending: [{ id: '2', text: 'b' }],
      editingId: null,
    });
    expect(readFollowUpQueueSnapshot('a')?.pending[0]?.text).toBe('a');
    expect(readFollowUpQueueSnapshot('b')?.pending[0]?.text).toBe('b');
  });

  it('clears storage when queue is empty', () => {
    writeFollowUpQueueSnapshot('x', {
      pending: [{ id: '1', text: 't' }],
      editingId: null,
    });
    writeFollowUpQueueSnapshot('x', {
      pending: [],
      editingId: null,
    });
    expect(readFollowUpQueueSnapshot('x')).toBeNull();
  });

  it('clearFollowUpQueueSnapshot removes key', () => {
    writeFollowUpQueueSnapshot('z', {
      pending: [{ id: '1', text: 't' }],
      editingId: null,
    });
    clearFollowUpQueueSnapshot('z');
    expect(readFollowUpQueueSnapshot('z')).toBeNull();
  });

  it('sanitize strips attachment data', () => {
    const snap = sanitizeFollowUpQueueSnapshot({
      pending: [
        {
          id: '1',
          text: 'x',
          attachments: [
            {
              type: 'image',
              name: 'a.png',
              data: 'data:image/png;base64,AAAA',
              workspaceRelativePath: 'inbound/foo.png',
            },
          ],
        },
      ],
      editingId: null,
    });
    expect(snap.pending[0]?.attachments?.[0]).not.toHaveProperty('data');
    expect(snap.pending[0]?.attachments?.[0]?.workspaceRelativePath).toBe('inbound/foo.png');
  });

  it('reads legacy snapshots with extra chip fields', () => {
    memory.set(
      'xopc.chat.followUpQueue:v1:z',
      JSON.stringify({
        v: 2,
        pending: [{ id: '1', text: 't' }],
        suggestions: ['what_next'],
        editingId: null,
        recentPickedIds: ['code_explain'],
      }),
    );
    expect(readFollowUpQueueSnapshot('z')).toEqual({
      pending: [{ id: '1', text: 't' }],
      editingId: null,
    });
  });
});
