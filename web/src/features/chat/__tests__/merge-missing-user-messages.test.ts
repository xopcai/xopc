import { describe, expect, it } from 'vitest';

import { mergeMissingUserMessagesFromServer } from '@/features/chat/messages/merge-missing-user-messages';
import type { Message } from '@/features/chat/messages/messages.types';

describe('mergeMissingUserMessagesFromServer', () => {
  const u1: Message = { role: 'user', content: [{ type: 'text', text: 'a' }], timestamp: 1 };
  const a1: Message = { role: 'assistant', content: [{ type: 'text', text: 'A' }], timestamp: 2 };
  const u2: Message = { role: 'user', content: [{ type: 'text', text: 'b' }], timestamp: 3 };

  it('returns local when server has no extra user rows', () => {
    const local = [u1, a1];
    const server = [u1, a1];
    expect(mergeMissingUserMessagesFromServer(local, server)).toBe(local);
  });

  it('appends missing user rows from server', () => {
    const local = [u1, a1];
    const server = [u1, a1, u2];
    const out = mergeMissingUserMessagesFromServer(local, server);
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual(u2);
  });

  it('repairs a live prefix when the active user was appended ahead of the prior assistant', () => {
    const activeUser = { ...u2, turnId: 'run-2' };
    const out = mergeMissingUserMessagesFromServer(
      [u1, activeUser],
      [u1, a1, activeUser],
      'run-2',
    );

    expect(out).toEqual([u1, a1, activeUser]);
  });

  it('keeps stable local rows when only client render metadata differs', () => {
    const activeUser = { ...u2, turnId: 'run-2' };
    const local = [
      u1,
      { ...a1, renderKey: 'assistant-stable' },
      { ...u2 },
    ];

    expect(mergeMissingUserMessagesFromServer(
      local,
      [u1, a1, activeUser],
      'run-2',
    )).toBe(local);
  });
});
