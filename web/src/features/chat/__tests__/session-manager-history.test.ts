// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetchWithStartupRetry } from '@/lib/gateway-startup-retry';
import { SessionManager } from '@/features/chat/session/session-manager';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';

vi.mock('@/lib/gateway-startup-retry', () => ({ apiFetchWithStartupRetry: vi.fn() }));
vi.mock('@/features/chat/session/local-session-drafts', () => ({
  readLocalSessionDraft: vi.fn(), readPendingSessionCommand: vi.fn(), rememberSessionTranscript: vi.fn(),
  saveLocalSessionDraft: vi.fn(), draftAgentConfig: vi.fn(), confirmSessionCommand: vi.fn(),
}));
const id = '5ab440be-b242-454c-9aeb-ebf7c41c64c5';
const fetchPage = vi.mocked(apiFetchWithStartupRetry);
const history = [
  { role: 'user', turnId: 'old', timestamp: 1, content: 'Saved question' },
  { role: 'assistant', turnId: 'old', timestamp: 2, content: 'Saved answer' },
];
function page(messages: unknown[], hasMore: boolean, nextBeforeCursor?: string, total = 102) {
  return new Response(JSON.stringify({ session: { key: id, messages },
    pagination: { total, limit: 50, offset: 0, hasMore, ...(nextBeforeCursor ? { nextBeforeCursor } : {}) } }));
}
const diagnostics = () => Array.from({ length: 50 }, () => ({ role: 'system', kind: 'context', content: 'Diagnostic' }));

describe('SessionManager history backfill', () => {
  beforeEach(() => { fetchPage.mockReset(); useChatSessionStore.setState({ sessions: {} }); });

  it.each([
    ['diagnostics', false], ['tool-results', false],
    ['diagnostics', true], ['tool-results', true],
  ] as const)('does not replace saved replies behind %s, committed new input=%s', async (kind, committedInput) => {
    const store = () => useChatSessionStore.getState();
    store().setCommittedSnapshot(id, { messages: [
      { role: 'user', turnId: 'old', timestamp: 1, content: [{ type: 'text', text: 'Saved question' }] },
      { role: 'assistant', turnId: 'old', timestamp: 2, content: [{ type: 'text', text: 'Saved answer' }] },
      { role: 'user', timestamp: 3, content: [{ type: 'text', text: 'New input' }], clientSubmissionId: 'pending', deliveryStatus: 'accepted' },
    ], hasMore: false });
    // Standalone toolResult rows are omitted by the Gateway projection before reaching the client.
    const invisible = kind === 'diagnostics' ? diagnostics() : [];
    const newest = committedInput ? [{ role: 'user', timestamp: 3, content: 'Committed new input' }] : [];
    fetchPage.mockResolvedValueOnce(page([...invisible, ...newest], true, '52'))
      .mockResolvedValueOnce(page(invisible, true, '2'))
      .mockResolvedValueOnce(page(history, false));
    const loaded = await new SessionManager().loadSession(id);
    store().mergeCommittedFromServer(id, loaded.messages, loaded.hasMore);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage.mock.calls[1][0]).toContain('before=52');
    expect(fetchPage.mock.calls[2][0]).toContain('before=2');
    expect(store().sessions[id].messages.filter(row => row.role === 'assistant').map(row => row.content))
      .toMatchObject([[{ type: 'text', text: 'Saved answer' }]]);
    expect(store().sessions[id].messages.at(-1)?.clientSubmissionId).toBe('pending');
  });

  it('keeps searching an empty visible tail beyond the assistant-fragment backfill budget', async () => {
    fetchPage.mockResolvedValueOnce(page([...diagnostics(), { role: 'user', timestamp: 3, content: 'Committed new input' }], true, '602', 653));
    for (let cursor = 552; cursor >= 2; cursor -= 50) fetchPage.mockResolvedValueOnce(page(diagnostics(), true, String(cursor), 653));
    fetchPage.mockResolvedValueOnce(page(history, false, undefined, 602));
    const loaded = await new SessionManager().loadSession(id);
    expect(loaded.messages.filter(row => row.role === 'assistant')).toHaveLength(1);
    expect(loaded.hasMore).toBe(false);
  });

  it('rejects a non-advancing cursor instead of returning a destructive empty snapshot', async () => {
    fetchPage.mockResolvedValueOnce(page(diagnostics(), true, '52'))
      .mockResolvedValueOnce(page(diagnostics(), true, '52'));
    await expect(new SessionManager().loadSession(id)).rejects.toThrow('History pagination did not advance');
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('keeps a full visible user-only page bounded', async () => {
    const users = Array.from({ length: 50 }, (_, timestamp) => ({ role: 'user', timestamp, content: `Input ${timestamp}` }));
    fetchPage.mockResolvedValueOnce(page(users, true, '52'));
    const loaded = await new SessionManager().loadSession(id);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(loaded.messages).toHaveLength(50);
    expect(loaded.hasMore).toBe(true);
  });
});
