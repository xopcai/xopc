// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '@/features/chat/messages/messages.types';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import type { SessionManager } from '@/features/chat/session/session-manager';
import { useChatSessionLoad } from '@/features/chat/session/use-chat-session-load';
import { openNewChatHandoff } from '@/features/chat/session/new-chat-handoff';

vi.mock('@/features/chat/session/new-chat-handoff', () => ({
  openNewChatHandoff: vi.fn(async () => 'new-session'),
}));

const conversationId = 'agent:main:webchat:default:direct:chat_auth_error';

describe('useChatSessionLoad', () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    useChatSessionStore.setState({
      focusedConversationId: conversationId,
      initLoading: false,
      loadingMore: false,
      shellError: null,
      sessions: {},
    });
  });

  it('explicitly drops an inherited project when creating an unscoped chat', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    let createNewSession!: ReturnType<typeof useChatSessionLoad>['createNewSession'];
    function Harness() {
      ({ createNewSession } = useChatSessionLoad({
        sessionMgrRef: { current: {} as SessionManager },
        routeConversationIdRef: { current: conversationId },
        sendingRef: { current: false },
        streamingRef: { current: false },
        loadingSessionRef: { current: false },
        messagesLenRef: { current: 0 },
        thinkingSupportGenRef: { current: 0 },
        navigateToSession: vi.fn(),
        resolveAgentIdForPost: () => 'main',
        detachForNewConversation: vi.fn(),
        conversationId,
        sessionAgentId: 'main',
        currentProjectId: 'inherited-project',
        hasMore: false,
      }));
      return null;
    }
    try {
      await act(async () => root.render(<Harness />));
      await act(async () => createNewSession({ forceNew: true, projectId: null }));
      expect(openNewChatHandoff).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: null, forceNew: true }));
      await act(async () => createNewSession({ forceNew: true }));
      expect(openNewChatHandoff).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: 'inherited-project' }));
    } finally {
      act(() => root.unmount());
    }
  });

  it('resets /new in place instead of creating another project session', async () => {
    vi.mocked(openNewChatHandoff).mockClear();
    const container = document.createElement('div');
    const root = createRoot(container);
    const resetSession = vi.fn(async () => ({ ok: true, reset: true }));
    const detachForNewConversation = vi.fn();
    let resetCurrentSession!: ReturnType<typeof useChatSessionLoad>['resetCurrentSession'];

    function Harness() {
      ({ resetCurrentSession } = useChatSessionLoad({
        sessionMgrRef: { current: {
          resetSession,
          loadSessionAgentConfig: vi.fn(async () => { throw new Error('not needed'); }),
        } as unknown as SessionManager },
        routeConversationIdRef: { current: conversationId },
        sendingRef: { current: false },
        streamingRef: { current: false },
        loadingSessionRef: { current: false },
        messagesLenRef: { current: 1 },
        thinkingSupportGenRef: { current: 0 },
        navigateToSession: vi.fn(),
        resolveAgentIdForPost: () => 'main',
        detachForNewConversation,
        conversationId,
        sessionAgentId: 'main',
        currentProjectId: 'project-with-dirty-checkout',
        hasMore: false,
      }));
      return null;
    }

    try {
      useChatSessionStore.getState().setCommittedSnapshot(conversationId, {
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 1 }],
        hasMore: false,
      });
      await act(async () => root.render(<Harness />));
      await act(async () => resetCurrentSession());

      expect(resetSession).toHaveBeenCalledWith(conversationId);
      expect(openNewChatHandoff).not.toHaveBeenCalled();
      expect(detachForNewConversation).toHaveBeenCalledOnce();
      expect(useChatSessionStore.getState().sessions[conversationId]?.messages).toEqual([]);
    } finally {
      act(() => root.unmount());
    }
  });

  it('preserves a run error during a background transcript refresh', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 1 },
    ];
    const sessionManager = {
      loadSession: vi.fn(async () => ({
        messages,
        hasMore: false,
        name: 'Auth failure',
        nextBeforeCursor: null,
      })),
      loadSessionAgentConfig: vi.fn(async () => ({
        model: 'test/model',
        thinkingLevel: 'medium',
        reasoningLevel: 'stream',
        activityDetail: {
          default: 'on',
          override: 'stream',
          effective: 'stream',
          source: 'session' as const,
        },
        effectiveWorkspacePath: '/tmp/test',
        workingDirectoryLocked: false,
        workspaceSource: 'agent_workspace' as const,
      })),
    } as unknown as SessionManager;
    let loadSessionById: ((key: string, offset?: number) => Promise<Message[] | undefined>) | undefined;

    function Harness() {
      ({ loadSessionById } = useChatSessionLoad({
        sessionMgrRef: { current: sessionManager },
        routeConversationIdRef: { current: conversationId },
        sendingRef: { current: false },
        streamingRef: { current: false },
        loadingSessionRef: { current: false },
        messagesLenRef: { current: 0 },
        thinkingSupportGenRef: { current: 0 },
        navigateToSession: vi.fn(),
        resolveAgentIdForPost: () => 'main',
        detachForNewConversation: vi.fn(),
        conversationId,
        sessionAgentId: 'main',
        currentProjectId: null,
        hasMore: false,
      }));
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    useChatSessionStore.getState().setShellError('provider_auth_invalid');

    await act(async () => {
      await loadSessionById?.(conversationId, 0);
    });

    expect(useChatSessionStore.getState().shellError).toBe('provider_auth_invalid');

    act(() => root.unmount());
    container.remove();
  });

  it('reports a missing routed session explicitly', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const sessionManager = {
      loadSession: vi.fn(async () => {
        throw new Error('HTTP 404: Not Found');
      }),
      loadSessions: vi.fn(async () => []),
    } as unknown as SessionManager;
    let loadSessionById: ((key: string, offset?: number) => Promise<Message[] | undefined>) | undefined;

    function Harness() {
      ({ loadSessionById } = useChatSessionLoad({
        sessionMgrRef: { current: sessionManager },
        routeConversationIdRef: { current: conversationId },
        sendingRef: { current: false },
        streamingRef: { current: false },
        loadingSessionRef: { current: false },
        messagesLenRef: { current: 0 },
        thinkingSupportGenRef: { current: 0 },
        navigateToSession: vi.fn(),
        resolveAgentIdForPost: () => 'main',
        detachForNewConversation: vi.fn(),
        conversationId,
        sessionAgentId: 'main',
        currentProjectId: null,
        hasMore: false,
      }));
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await loadSessionById?.(conversationId, 0);
    });

    expect(JSON.parse(useChatSessionStore.getState().shellError ?? '{}')).toMatchObject({
      kind: 'session_not_found',
      code: 'session_not_found',
    });
    expect(sessionManager.loadSessions).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });

  it('applies a workspace override and refreshes the effective workspace', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const sessionManager = {
      patchSessionAgentConfig: vi.fn(async () => {}),
      loadSessionAgentConfig: vi.fn(async () => ({
        model: '',
        thinkingLevel: 'medium',
        reasoningLevel: 'on',
        activityDetail: {
          default: 'on',
          override: null,
          effective: 'on',
          source: 'default' as const,
        },
        effectiveWorkspacePath: '/Users/example/projects/next',
        workingDirectoryLocked: true,
        workspaceSource: 'session_override' as const,
      })),
    } as unknown as SessionManager;
    let onSessionWorkingDirectoryChange: ((path: string) => Promise<void>) | undefined;

    function Harness() {
      ({ onSessionWorkingDirectoryChange } = useChatSessionLoad({
        sessionMgrRef: { current: sessionManager },
        routeConversationIdRef: { current: conversationId },
        sendingRef: { current: false },
        streamingRef: { current: false },
        loadingSessionRef: { current: false },
        messagesLenRef: { current: 0 },
        thinkingSupportGenRef: { current: 0 },
        navigateToSession: vi.fn(),
        resolveAgentIdForPost: () => 'main',
        detachForNewConversation: vi.fn(),
        conversationId,
        sessionAgentId: 'main',
        currentProjectId: null,
        hasMore: false,
      }));
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await onSessionWorkingDirectoryChange?.('  /Users/example/projects/next  ');
    });

    expect(sessionManager.patchSessionAgentConfig).toHaveBeenCalledWith(conversationId, {
      workingDirectory: '/Users/example/projects/next',
    });
    expect(useChatSessionStore.getState().sessions[conversationId]).toMatchObject({
      effectiveWorkspacePath: '/Users/example/projects/next',
      workspaceSource: 'session_override',
    });

    act(() => root.unmount());
    container.remove();
  });
});
