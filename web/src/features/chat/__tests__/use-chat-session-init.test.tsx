// @vitest-environment jsdom

import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import type { SessionManager } from '@/features/chat/session/session-manager';
import { useChatSessionInit } from '@/features/chat/session/use-chat-session-init';
import { resetNewChatHandoffInflightForTests } from '@/features/chat/session/new-chat-handoff';

const sessionKey = 'agent:main:webchat:default:direct:chat_new';

describe('useChatSessionInit', () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    useChatSessionStore.setState({ sessions: {} });
    resetNewChatHandoffInflightForTests();
    localStorage.clear();
  });

  it('adopts the created session and loads its model after StrictMode effect replay', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const config = { model: 'test/model', thinkingLevel: 'medium', configVersion: 1 };
    const sessionManager = {
      createSession: vi.fn(async () => ({ key: sessionKey, sessionId: 'new', messageCount: 0 })),
      loadSessionAgentConfig: vi.fn(async () => config),
    } as unknown as SessionManager;
    const navigateToSession = vi.fn();
    const adoptEmptySession = vi.fn();
    const applyAgentConfig = vi.fn();
    function Harness() {
      useChatSessionInit({
        token: 'token', isNewRoute: true, forceNewChat: true, decodedKey: undefined,
        locationKey: 'new-location', locationSearch: '', sessionMgrRef: { current: sessionManager },
        resolveAgentIdForPost: () => 'main', navigateToSession, adoptEmptySession, applyAgentConfig,
        loadSessionById: vi.fn(async () => []), tryResumeAgentRun: vi.fn(async () => {}),
        restoreLiveCacheIfNeeded: vi.fn(() => false), patchInitUi: vi.fn(),
      });
      return null;
    }
    try {
      await act(async () => root.render(<StrictMode><Harness /></StrictMode>));
      expect(sessionManager.createSession).toHaveBeenCalledOnce();
      expect(adoptEmptySession).toHaveBeenCalledWith(sessionKey, null);
      expect(navigateToSession).toHaveBeenCalledOnce();
      expect(applyAgentConfig).toHaveBeenCalledWith(sessionKey, config);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('does not hydrate known-empty history again when runtime callbacks change', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const loadSessionById = vi.fn(async () => []);
    const sessionManager = {
      loadSessionAgentConfig: vi.fn(async () => ({
        model: 'test/model',
        thinkingLevel: 'medium',
        reasoningLevel: 'stream',
        effectiveWorkspacePath: '',
        workingDirectoryLocked: false,
      })),
    } as unknown as SessionManager;
    const stable = {
      navigateToSession: vi.fn(),
      tryResumeAgentRun: vi.fn(async () => {}),
      restoreLiveCacheIfNeeded: vi.fn(() => false),
      adoptEmptySession: vi.fn(),
      applyAgentConfig: vi.fn(),
      patchInitUi: vi.fn(),
    };

    function Harness({ resolveAgentIdForPost }: { resolveAgentIdForPost: () => string }) {
      useChatSessionInit({
        token: 'token',
        isNewRoute: false,
        forceNewChat: false,
        decodedKey: sessionKey,
        locationKey: 'location-1',
        locationSearch: '',
        sessionMgrRef: { current: sessionManager },
        resolveAgentIdForPost,
        loadSessionById,
        ...stable,
      });
      return null;
    }

    useChatSessionStore.getState().setCommittedSnapshot(sessionKey, {
      messages: [],
      hasMore: false,
    });
    await act(async () => {
      root.render(<Harness resolveAgentIdForPost={() => 'main'} />);
      await Promise.resolve();
    });
    expect(loadSessionById).not.toHaveBeenCalled();

    await act(async () => {
      root.render(<Harness resolveAgentIdForPost={() => 'main'} />);
      await Promise.resolve();
    });

    expect(loadSessionById).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });
});
