import { describe, expect, it, beforeEach, vi } from 'vitest';

import type { SessionInfo } from '@/features/chat/chat.types';
import { resolveNewChatTarget } from '@/features/chat/session/resolve-new-chat-target';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
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

const noteEmpty: SessionInfo = {
  key: 'agent:main:webchat:default:direct:note_abc_1783324340003',
  updatedAt: '2026-06-14T13:00:00.000Z',
  messageCount: 0,
  sourceChannel: 'webchat',
  routing: { agentId: 'main' },
  customData: {
    sourceBinding: { kind: 'note', sourceId: 'abc', version: '1', attachedAt: 1 },
  },
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
    useChatSessionStore.setState({ sessions: {} });
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

  it('temporary always creates a temporary server session instead of reusing an empty shell', async () => {
    const mgr = mockSessionMgr([emptyA]);
    const result = await resolveNewChatTarget({
      sessionMgr: mgr,
      agentId: 'main',
      temporary: true,
    });
    expect(result.kind).toBe('create');
    expect(mgr.loadSessions).not.toHaveBeenCalled();
    expect(mgr.createSession).toHaveBeenCalledWith({ agentId: 'main', temporary: true });
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

  it('creates a new session when the current session has a local user message', async () => {
    useChatSessionStore.getState().setCommittedSnapshot(emptyA.key, {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }], timestamp: 1 }],
      hasMore: false,
    });
    const mgr = mockSessionMgr([emptyA]);

    const result = await resolveNewChatTarget({
      sessionMgr: mgr,
      agentId: 'main',
      currentSessionKey: emptyA.key,
    });

    expect(result.kind).toBe('create');
    expect(mgr.createSession).toHaveBeenCalledWith({ agentId: 'main', projectId: undefined });
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

  it('does not reuse note-scoped empty sessions for generic new chat', async () => {
    const mgr = mockSessionMgr([noteEmpty]);
    const result = await resolveNewChatTarget({
      sessionMgr: mgr,
      agentId: 'main',
    });
    expect(result.kind).toBe('create');
    expect(mgr.createSession).toHaveBeenCalled();
  });

  it('does not reuse project-bound empty sessions for generic new chat', async () => {
    const projectEmpty: SessionInfo = { ...emptyA, projectId: 'project-a' };
    const mgr = mockSessionMgr([projectEmpty]);
    const result = await resolveNewChatTarget({
      sessionMgr: mgr,
      agentId: 'main',
    });
    expect(result.kind).toBe('create');
    expect(mgr.createSession).toHaveBeenCalledWith({ agentId: 'main', projectId: undefined });
  });

  it('reuses only the matching project empty session for project new chat', async () => {
    const projectA: SessionInfo = { ...emptyA, projectId: 'project-a' };
    const projectB: SessionInfo = { ...emptyB, projectId: 'project-b' };
    const mgr = mockSessionMgr([projectB, projectA]);
    const result = await resolveNewChatTarget({
      sessionMgr: mgr,
      agentId: 'main',
      projectId: 'project-a',
    });
    expect(result.kind).toBe('reuse');
    if (result.kind === 'reuse') {
      expect(result.sessionKey).toBe(projectA.key);
    }
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

  it('does not reuse note-scoped empty sessions from cache', async () => {
    addWebchatEmptyShellToCache(noteEmpty);
    const mgr = mockSessionMgr([]);
    const result = await resolveNewChatTarget({
      sessionMgr: mgr,
      agentId: 'main',
    });
    expect(result.kind).toBe('create');
    expect(mgr.createSession).toHaveBeenCalled();
  });

  it('does not reuse project-bound empty sessions from cache for generic new chat', async () => {
    addWebchatEmptyShellToCache({ ...emptyA, projectId: 'project-a' });
    const mgr = mockSessionMgr([]);
    const result = await resolveNewChatTarget({
      sessionMgr: mgr,
      agentId: 'main',
    });
    expect(result.kind).toBe('create');
    expect(mgr.createSession).toHaveBeenCalledWith({ agentId: 'main', projectId: undefined });
  });
});
