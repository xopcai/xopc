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
  it('does not truncate a newer local send when an older run snapshot arrives', () => {
    const oldUser = { ...u1, turnId: 'old-run' };
    const pendingUser: Message = { ...u2, clientSubmissionId: 'new-input' };
    const local = [oldUser, a1, pendingUser];
    expect(mergeMissingUserMessagesFromServer(local, [oldUser, a1], 'old-run')).toBe(local);
  });

  it('keeps displayed replies when a live snapshot omits the preceding assistant', () => {
    const activeUser = { ...u2, turnId: 'run-2' };
    const local = [u1, a1, activeUser];
    expect(mergeMissingUserMessagesFromServer(local, [u1, activeUser], 'run-2')).toBe(local);
  });

  it('keeps loaded history when the live snapshot contains only the latest page', () => {
    const activeUser = { ...u2, turnId: 'run-2' };
    const local = [u1, a1, activeUser];
    expect(mergeMissingUserMessagesFromServer(local, [activeUser], 'run-2')).toBe(local);
  });

  it('hydrates the source of an already visible user row while its reply is running', () => {
    const activeUser: Message = { ...u2, turnId: 'run-2', renderKey: 'stable-user' };
    const origin = { launchId: '988853d5-d93c-4bc7-a060-cd921b56bb0d',
      conversationId: 'e078f1fa-481b-4aa3-a69a-c33f1ecb3604', agentId: 'main' };
    const local = [u1, a1, activeUser];
    const server = [u1, a1, { ...u2, turnId: 'run-2', conversationOrigin: origin }];
    const merged = mergeMissingUserMessagesFromServer(local, server, 'run-2');
    expect(merged[2]).toEqual({ ...activeUser, conversationOrigin: origin });
    expect(merged[0]).toBe(u1);
    expect(merged[1]).toBe(a1);
    expect(mergeMissingUserMessagesFromServer(merged, server, 'run-2')).toBe(merged);
  });

  it('hydrates provenance without a live assistant id and never copies it between different turns', () => {
    const origin = { launchId: '988853d5-d93c-4bc7-a060-cd921b56bb0d',
      conversationId: 'e078f1fa-481b-4aa3-a69a-c33f1ecb3604', agentId: 'main' };
    const local = [{ ...u2, turnId: 'run-2' }];
    const server = [{ ...u2, turnId: 'run-2', conversationOrigin: origin }];
    expect(mergeMissingUserMessagesFromServer(local, server)[0]?.conversationOrigin).toEqual(origin);
    expect(mergeMissingUserMessagesFromServer(local, [{ ...server[0], turnId: 'other' }])).toBe(local);
  });

});
