// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';

import {
  clearFollowUpQueueSnapshot,
  readFollowUpQueueSnapshot,
  sanitizeFollowUpQueueSnapshot,
  writeFollowUpQueueSnapshot,
} from '@/features/chat/follow-up-queue-storage';

describe('follow-up-queue-storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('roundtrips pending rows, suggestions, and editing id', () => {
    writeFollowUpQueueSnapshot('session-a', {
      pending: [{ id: 'row-1', text: 'queued text', thinkingLevel: 'off' }],
      suggestions: ['what_next', 'code_explain'],
      editingId: 'row-1',
    });
    expect(readFollowUpQueueSnapshot('session-a')).toEqual({
      pending: [{ id: 'row-1', text: 'queued text', thinkingLevel: 'off' }],
      suggestions: ['what_next', 'code_explain'],
      editingId: 'row-1',
    });
  });

  it('isolates keys per session', () => {
    writeFollowUpQueueSnapshot('a', {
      pending: [{ id: '1', text: 'a' }],
      suggestions: [],
      editingId: null,
    });
    writeFollowUpQueueSnapshot('b', {
      pending: [{ id: '2', text: 'b' }],
      suggestions: [],
      editingId: null,
    });
    expect(readFollowUpQueueSnapshot('a')?.pending[0]?.text).toBe('a');
    expect(readFollowUpQueueSnapshot('b')?.pending[0]?.text).toBe('b');
  });

  it('clears storage when queue is empty', () => {
    writeFollowUpQueueSnapshot('x', {
      pending: [{ id: '1', text: 't' }],
      suggestions: [],
      editingId: null,
    });
    writeFollowUpQueueSnapshot('x', {
      pending: [],
      suggestions: [],
      editingId: null,
    });
    expect(readFollowUpQueueSnapshot('x')).toBeNull();
  });

  it('clearFollowUpQueueSnapshot removes key', () => {
    writeFollowUpQueueSnapshot('z', {
      pending: [{ id: '1', text: 't' }],
      suggestions: [],
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
      suggestions: [],
      editingId: null,
    });
    expect(snap.pending[0]?.attachments?.[0]).not.toHaveProperty('data');
    expect(snap.pending[0]?.attachments?.[0]?.workspaceRelativePath).toBe('inbound/foo.png');
  });

  it('drops unknown suggestion ids on read', () => {
    localStorage.setItem(
      'xopc.chat.followUpQueue:v1:z',
      JSON.stringify({
        v: 1,
        pending: [],
        suggestions: ['what_next', 'not_a_real_id'],
        editingId: null,
      }),
    );
    expect(readFollowUpQueueSnapshot('z')?.suggestions).toEqual(['what_next']);
  });
});
