// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionInfo } from '@/features/chat/chat.types';
import { openNewChatHandoff, resetNewChatHandoffInflightForTests } from '@/features/chat/session/new-chat-handoff';
import type { SessionManager } from '@/features/chat/session/session-manager';
import { resetWebchatEmptyShellCacheForTests } from '@/features/chat/session/webchat-empty-shell-cache';
import { useGatewayStore } from '@/stores/gateway-store';

const createdSession: SessionInfo = {
  key: 'agent:main:webchat:default:direct:chat_new',
  sessionId: 'session_new',
  updatedAt: '2026-07-14T00:00:00.000Z',
  messageCount: 0,
  sourceChannel: 'webchat',
  routing: { agentId: 'main' },
};

describe('openNewChatHandoff', () => {
  it('uses the live caller callbacks when an initialization is replayed', async () => {
    let finish!: (session: SessionInfo) => void;
    const pending = new Promise<SessionInfo>((resolve) => { finish = resolve; });
    const sessionMgr = { createSession: vi.fn(() => pending) } as unknown as SessionManager;
    const cancelled = { navigateToSession: vi.fn(), onOpened: vi.fn() };
    const live = { navigateToSession: vi.fn(), onOpened: vi.fn() };
    const first = openNewChatHandoff({ sessionMgr, agentId: 'main', forceNew: true, ...cancelled });
    const replay = openNewChatHandoff({ sessionMgr, agentId: 'main', forceNew: true, ...live });
    finish(createdSession);
    await Promise.all([first, replay]);
    expect(sessionMgr.createSession).toHaveBeenCalledOnce();
    expect(live.onOpened).toHaveBeenCalledWith(createdSession.key);
    expect(live.navigateToSession).toHaveBeenCalledOnce();
    expect(cancelled.onOpened).not.toHaveBeenCalled();
    expect(cancelled.navigateToSession).not.toHaveBeenCalled();
  });
  it('coalesces repeated creation but keeps execution modes independent', async () => {
    let finish!: (session: SessionInfo) => void;
    const pending = new Promise<SessionInfo>((resolve) => { finish = resolve; });
    const sessionMgr = { createSession: vi.fn(() => pending) } as unknown as SessionManager;
    const opts = { sessionMgr, agentId: 'main', projectId: 'project-a', navigateToSession: vi.fn(), onOpened: vi.fn() };
    const first = openNewChatHandoff({ ...opts, executionMode: 'managed_worktree' });
    const repeated = openNewChatHandoff({ ...opts, executionMode: 'managed_worktree' });
    const local = openNewChatHandoff({ ...opts, executionMode: 'local_checkout' });
    expect(first).toBe(repeated);
    expect(first).not.toBe(local);
    expect(sessionMgr.createSession).toHaveBeenCalledTimes(2);
    finish(createdSession);
    await Promise.all([first, repeated, local]);
  });

  it('keeps the current view on failure and permits an explicit retry', async () => {
    const sessionMgr = { createSession: vi.fn().mockRejectedValueOnce(new Error('Repository has uncommitted changes')).mockResolvedValueOnce(createdSession) } as unknown as SessionManager;
    const opts = { sessionMgr, agentId: 'main', projectId: 'project-a', executionMode: 'managed_worktree' as const, navigateToSession: vi.fn(), onOpened: vi.fn() };
    await expect(openNewChatHandoff(opts)).rejects.toThrow('uncommitted changes');
    expect(opts.navigateToSession).not.toHaveBeenCalled();
    expect(opts.onOpened).not.toHaveBeenCalled();
    await openNewChatHandoff(opts);
    expect(opts.onOpened).toHaveBeenCalledOnce();
  });
  beforeEach(() => {
    useGatewayStore.setState({ token: 'test-token', baseUrl: 'http://gateway-a' });
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

  it('never coalesces creation across gateway credentials', async () => {
    let finish!: (session: SessionInfo) => void;
    const pending = new Promise<SessionInfo>((resolve) => { finish = resolve; });
    const sessionMgr = { createSession: vi.fn(() => pending) } as unknown as SessionManager;
    const opts = { sessionMgr, agentId: 'main', projectId: 'project-a', executionMode: 'managed_worktree' as const, navigateToSession: vi.fn(), onOpened: vi.fn() };
    const first = openNewChatHandoff(opts);
    useGatewayStore.setState({ token: 'different-token' });
    const second = openNewChatHandoff(opts);
    expect(first).not.toBe(second);
    expect(sessionMgr.createSession).toHaveBeenCalledTimes(2);
    finish(createdSession);
    await Promise.all([first, second]);
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
