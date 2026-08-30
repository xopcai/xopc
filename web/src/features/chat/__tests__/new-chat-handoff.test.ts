// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionInfo } from '@/features/chat/chat.types';
import { openNewChatHandoff, resetNewChatHandoffInflightForTests } from '@/features/chat/session/new-chat-handoff';
import type { SessionManager } from '@/features/chat/session/session-manager';
import { resetWebchatEmptyShellCacheForTests } from '@/features/chat/session/webchat-empty-shell-cache';

const createdSession: SessionInfo = {
  key: 'agent:main:webchat:default:direct:chat_new',
  sessionId: 'session_new',
  updatedAt: '2026-07-14T00:00:00.000Z',
  messageCount: 0,
  sourceChannel: 'webchat',
  routing: { agentId: 'main' },
};

describe('openNewChatHandoff', () => {
  beforeEach(() => {
    resetNewChatHandoffInflightForTests();
    resetWebchatEmptyShellCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not request a sidebar-wide session refresh after creating a chat', async () => {
    const sessionMgr = {
      createSession: vi.fn(async () => createdSession),
    } as unknown as SessionManager;
    const navigateToSession = vi.fn();
    const onOpened = vi.fn();
    const onSessionUpdated = vi.fn();
    window.addEventListener('session-updated', onSessionUpdated);

    try {
      await openNewChatHandoff({
        sessionMgr,
        agentId: 'main',
        forceNew: true,
        navigateToSession,
        onOpened,
      });

      expect(onOpened).toHaveBeenCalledWith(createdSession.key);
      expect(navigateToSession).toHaveBeenCalledWith(createdSession.key, false, undefined);
      expect(onSessionUpdated).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('session-updated', onSessionUpdated);
    }
  });

  it('keeps different project requests independent and only applies the latest navigation', async () => {
    let resolveFirst!: (session: SessionInfo) => void;
    const first = new Promise<SessionInfo>((resolve) => {
      resolveFirst = resolve;
    });
    const secondSession = { ...createdSession, key: `${createdSession.key}_second`, projectId: 'p2' };
    const sessionMgr = {
      createSession: vi.fn(async ({ projectId }: { projectId?: string | null }) =>
        projectId === 'p1' ? first : secondSession),
    } as unknown as SessionManager;
    const navigateToSession = vi.fn();

    const firstOpen = openNewChatHandoff({
      sessionMgr,
      agentId: 'main',
      projectId: 'p1',
      forceNew: true,
      navigateToSession,
      onOpened: vi.fn(),
    });
    const secondOpen = openNewChatHandoff({
      sessionMgr,
      agentId: 'main',
      projectId: 'p2',
      forceNew: true,
      navigateToSession,
      onOpened: vi.fn(),
    });

    await secondOpen;
    resolveFirst({ ...createdSession, projectId: 'p1' });
    await firstOpen;

    expect(sessionMgr.createSession).toHaveBeenCalledTimes(2);
    expect(navigateToSession).toHaveBeenCalledOnce();
    expect(navigateToSession).toHaveBeenCalledWith(secondSession.key, false, undefined);
  });
});
