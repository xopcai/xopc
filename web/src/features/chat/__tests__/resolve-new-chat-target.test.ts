import { describe, expect, it, beforeEach, vi } from 'vitest';

import type { SessionInfo } from '@/features/chat/chat.types';
import { resolveNewChatTarget } from '@/features/chat/session/resolve-new-chat-target';
import type { SessionManager } from '@/features/chat/session/session-manager';
import {
  addWebchatEmptyShellToCache,
  invalidateWebchatEmptyShellCache,
  resetWebchatEmptyShellCacheForTests,
} from '@/features/chat/session/webchat-empty-shell-cache';

const emptyA: SessionInfo = {
  key: 'agent:main:webchat:default:direct:chat_a',
  updatedAt: '2026-06-14T12:00:00.000Z',
  messageCount: 0,
  sourceChannel: 'webchat',
  routing: { agentId: 'main' },
};

const emptyB: SessionInfo = {
  key: 'agent:main:webchat:default:direct:chat_b',
  updatedAt: '2026-06-14T11:00:00.000Z',
  messageCount: 0,
  sourceChannel: 'webchat',
  routing: { agentId: 'main' },
};

function mockSessionMgr(sessions: SessionInfo[]): SessionManager {
  const created: SessionInfo = {
    key: 'agent:main:webchat:default:direct:chat_new',
    updatedAt: '',
    messageCount: 0,
  };
  return {
    loadSessions: vi.fn(async () => sessions),
    createSession: vi.fn(async () => created),
  } as unknown as SessionManager;
}

describe('resolveNewChatTarget', () => {
  beforeEach(() => {
    resetWebchatEmptyShellCacheForTests();
    invalidateWebchatEmptyShellCache();
  });

  it('forceNew always creates a server session', async () => {
    const mgr = mockSessionMgr([emptyA]);
    const result = await resolveNewChatTarget({
      sessionMgr: mgr,
      agentId: 'main',
      forceNew: true,
    });
    expect(result.kind).toBe('create');
    expect(mgr.createSession).toHaveBeenCalledWith({ agentId: 'main' });
  });

  it('noop when current session is already an empty shell', async () => {
    const mgr = mockSessionMgr([emptyA]);
    const result = await resolveNewChatTarget({
      sessionMgr: mgr,
      agentId: 'main',
      currentSessionKey: emptyA.key,
    });
    expect(result).toEqual({ kind: 'noop', sessionKey: emptyA.key });
    expect(mgr.loadSessions).toHaveBeenCalled();
  });

  it('reuses another empty shell when current is not empty', async () => {
    const mgr = mockSessionMgr([emptyA, emptyB]);
    const result = await resolveNewChatTarget({
      sessionMgr: mgr,
      agentId: 'main',
      currentSessionKey: 'agent:main:webchat:default:direct:chat_busy',
    });
    expect(result.kind).toBe('reuse');
    if (result.kind === 'reuse') {
      expect(result.sessionKey).toBe(emptyA.key);
    }
    expect(mgr.loadSessions).toHaveBeenCalled();
  });

  it('creates when no reusable empty shell exists', async () => {
    const mgr = mockSessionMgr([]);
    const result = await resolveNewChatTarget({
      sessionMgr: mgr,
      agentId: 'main',
    });
    expect(result.kind).toBe('create');
    expect(mgr.createSession).toHaveBeenCalled();
  });

  it('merges created empty shells from cache when server list lags', async () => {
    const created: SessionInfo = {
      key: 'agent:main:webchat:default:direct:chat_created',
      updatedAt: '2026-06-14T13:00:00.000Z',
      messageCount: 0,
      sourceChannel: 'webchat',
      routing: { agentId: 'main' },
    };
    addWebchatEmptyShellToCache(created);
    const mgr = mockSessionMgr([]);
    const result = await resolveNewChatTarget({
      sessionMgr: mgr,
      agentId: 'main',
    });
    expect(result.kind).toBe('reuse');
    if (result.kind === 'reuse') {
      expect(result.sessionKey).toBe(created.key);
    }
  });
});
