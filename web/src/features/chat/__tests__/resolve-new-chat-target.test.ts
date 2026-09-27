import { describe, expect, it, vi } from 'vitest';
import { resolveNewChatTarget } from '../session/resolve-new-chat-target';
import type { SessionManager } from '../session/session-manager';

describe('local new conversation resolution', () => {
  it('never lists or reuses server empty shells', async () => {
    const createSession = vi.fn().mockResolvedValue({ key: 'new-id' });
    const loadSessions = vi.fn();
    const sessionMgr = { createSession, loadSessions } as unknown as SessionManager;
    const result = await resolveNewChatTarget({ sessionMgr, agentId: 'main', currentConversationId: 'old-id' });
    expect(result.conversationId).toBe('new-id');
    expect(loadSessions).not.toHaveBeenCalled();
    expect(createSession).toHaveBeenCalledOnce();
  });
});
