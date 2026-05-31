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
});
