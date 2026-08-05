// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '@/features/chat/messages/messages.types';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import type { SessionManager } from '@/features/chat/session/session-manager';
import { useChatSessionLoad } from '@/features/chat/session/use-chat-session-load';

const sessionKey = 'agent:main:webchat:default:direct:chat_auth_error';

describe('useChatSessionLoad', () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    useChatSessionStore.setState({
      focusedSessionKey: sessionKey,
      initLoading: false,
      loadingMore: false,
      shellError: null,
      sessions: {},
    });
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
        effectiveWorkspacePath: '/tmp/test',
        workingDirectoryLocked: false,
        workspaceSource: 'agent_workspace' as const,
      })),
    } as unknown as SessionManager;
    let loadSessionById: ((key: string, offset?: number) => Promise<Message[] | undefined>) | undefined;

    function Harness() {
      ({ loadSessionById } = useChatSessionLoad({
        sessionMgrRef: { current: sessionManager },
        routeSessionKeyRef: { current: sessionKey },
        sendingRef: { current: false },
        streamingRef: { current: false },
        activeStreamSessionKeyRef: { current: null },
        loadingSessionRef: { current: false },
        messagesLenRef: { current: 0 },
        thinkingSupportGenRef: { current: 0 },
        navigateToSession: vi.fn(),
        resolveAgentIdForPost: () => 'main',
        dismissClarifyOnSessionLoad: vi.fn(),
        detachForNewConversation: vi.fn(),
        sessionKey,
        hasMore: false,
      }));
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    useChatSessionStore.getState().setShellError('provider_auth_invalid');

    await act(async () => {
      await loadSessionById?.(sessionKey, 0);
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
        routeSessionKeyRef: { current: sessionKey },
        sendingRef: { current: false },
        streamingRef: { current: false },
        activeStreamSessionKeyRef: { current: null },
        loadingSessionRef: { current: false },
        messagesLenRef: { current: 0 },
        thinkingSupportGenRef: { current: 0 },
        navigateToSession: vi.fn(),
        resolveAgentIdForPost: () => 'main',
        dismissClarifyOnSessionLoad: vi.fn(),
        detachForNewConversation: vi.fn(),
        sessionKey,
        hasMore: false,
      }));
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await loadSessionById?.(sessionKey, 0);
    });

    expect(JSON.parse(useChatSessionStore.getState().shellError ?? '{}')).toMatchObject({
      kind: 'session_not_found',
      code: 'session_not_found',
    });
    expect(sessionManager.loadSessions).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });
});
