// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import type { SessionManager } from '@/features/chat/session/session-manager';
import { useChatSessionInit } from '@/features/chat/session/use-chat-session-init';

const sessionKey = 'agent:main:webchat:default:direct:chat_new';

describe('useChatSessionInit', () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    useChatSessionStore.setState({ sessions: {} });
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
