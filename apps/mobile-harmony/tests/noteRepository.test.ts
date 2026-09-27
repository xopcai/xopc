import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: { request: mocks.request } }));
vi.mock('../entry/src/main/ets/service/transport.ets', () => ({ XopcHttpError: class extends Error {} }));

import { XopcNoteRepository } from '../entry/src/main/ets/repository/noteRepository.ets';

describe('Harmony note conversation repository', () => {
  beforeEach(() => vi.resetAllMocks());

  it('opens the persistent note-bound conversation with an encoded note id', async () => {
    mocks.request.mockResolvedValue(JSON.stringify({
      conversationId: 'chat-1', reused: true,
      sourceBinding: { kind: 'note', sourceId: 'note/1', version: '42', attachedAt: 100 },
    }));
    await expect(new XopcNoteRepository().openConversation('note/1')).resolves.toMatchObject({
      conversationId: 'chat-1', reused: true,
    });
    expect(mocks.request).toHaveBeenCalledWith('/api/notes/note%2F1/chat', 'POST');
  });

  it('rejects a response bound to a different note', async () => {
    mocks.request.mockResolvedValue(JSON.stringify({
      conversationId: 'chat-1', reused: false,
      sourceBinding: { kind: 'note', sourceId: 'other', version: '42', attachedAt: 100 },
    }));
    await expect(new XopcNoteRepository().openConversation('note-1')).rejects.toThrow('INVALID_NOTE_CONVERSATION');
  });
});
