import { describe, expect, it } from 'vitest';

import { messageKey } from '../message-key';
import type { Message } from '../messages.types';
import { reconcileMessageRows } from '../reconcile-message-rows';
import { mergeStreamingAssistantIntoMessages } from '../session-message-parser';

describe('chat row reconciliation', () => {
  const old: Message = { id: 'old', role: 'user', content: [{ type: 'text', text: 'question' }] };
  const live: Message = { id: 'live', role: 'assistant', content: [{ type: 'text', text: 'answer', segmentId: 's1' }] };
  const stored: Message = { ...live, id: 'stored' };

  it('retains the native row through history refresh, stream cleanup and later refetches', () => {
    const initial = reconcileMessageRows([], [old, live]);
    const refresh = reconcileMessageRows(initial, mergeStreamingAssistantIntoMessages([old, stored], live));
    const complete = reconcileMessageRows(refresh, [old, stored]);
    const refetch = reconcileMessageRows(complete, structuredClone([old, stored]));
    for (const rows of [initial, refresh, complete, refetch]) {
      expect(rows).toHaveLength(2);
      expect(messageKey(rows[1], 1)).toBe('live');
      expect(rows[0]).toBe(initial[0]);
    }
    expect(refetch[1]).toBe(complete[1]);
  });

  it('reuses historical rows while changing only the streaming message', () => {
    const initial = reconcileMessageRows([], [old, live]);
    const next = reconcileMessageRows(initial, [old, { ...live, content: [{ type: 'text', text: 'answer grows' }] }]);
    expect(next[0]).toBe(initial[0]);
    expect(next[1]).not.toBe(initial[1]);
    expect(messageKey(next[1], 1)).toBe(messageKey(initial[1], 1));
  });

  it('keeps keys stable when older history is prepended and does not reuse another turn', () => {
    const initial = reconcileMessageRows([], [old, live]);
    const older: Message = { ...old, id: 'older' };
    const next = reconcileMessageRows(initial, [older, old, live, { ...old, id: 'new-user' }, { ...live, id: 'new-answer' }]);
    expect(next[1]).toBe(initial[0]);
    expect(next[2]).toBe(initial[1]);
    expect(new Set(next.map(messageKey)).size).toBe(5);
  });
});
