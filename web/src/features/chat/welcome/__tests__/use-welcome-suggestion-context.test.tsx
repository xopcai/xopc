// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionManager } from '@/features/chat/session/session-manager';
import {
  useWelcomeSuggestionContext,
  type WelcomeSuggestionContextState,
} from '@/features/chat/welcome/use-welcome-suggestion-context';

const { getSessionDetail, fetchProject, inferProjectDefaults } = vi.hoisted(() => ({
  getSessionDetail: vi.fn(),
  fetchProject: vi.fn(),
  inferProjectDefaults: vi.fn(),
}));

vi.mock('@/features/sessions/session-api', () => ({ getSessionDetail }));
vi.mock('@/features/projects/api', () => ({ fetchProject, inferProjectDefaults }));

function Probe({
  sessionKey = 'agent:main:webchat:test',
  effectiveWorkspacePath,
  sessionManager,
  onState,
}: {
  sessionKey?: string;
  effectiveWorkspacePath?: string | null;
  sessionManager: SessionManager;
  onState: (state: WelcomeSuggestionContextState) => void;
}) {
  const state = useWelcomeSuggestionContext({
    enabled: true,
    sessionKey,
    effectiveWorkspacePath,
    sessionManager,
  });
  onState(state);
  return <div>{`${state.status}:${state.context.kind}`}</div>;
}

describe('useWelcomeSuggestionContext', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('publishes a stable loading state before the resolved project context', async () => {
    getSessionDetail.mockResolvedValue({ projectId: 'p1' });
    fetchProject.mockResolvedValue({
      id: 'p1',
      name: 'xopc',
      kind: 'coding',
      workspaceRoot: '/repo/xopc',
    });
    const states: string[] = [];
    const sessionManager = {
      loadSessionAgentConfig: vi.fn(),
    } as unknown as SessionManager;

    await act(async () => {
      root.render(
        <Probe
          sessionManager={sessionManager}
          onState={(state) => states.push(`${state.status}:${state.context.kind}`)}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(states).toContain('loading:empty');
    expect(container.textContent).toBe('ready:codingProject');
    expect(sessionManager.loadSessionAgentConfig).not.toHaveBeenCalled();
  });

  it('returns loading immediately when the session key changes', async () => {
    let resolveSecondDetail: ((value: unknown) => void) | null = null;
    getSessionDetail.mockImplementation((sessionKey: string) => {
      if (sessionKey.endsWith(':one')) return Promise.resolve({ projectId: 'p1' });
      return new Promise((resolve) => {
        resolveSecondDetail = resolve;
      });
    });
    fetchProject.mockResolvedValue({
      id: 'p1',
      name: 'xopc',
      kind: 'coding',
      workspaceRoot: '/repo/xopc',
    });
    const sessionManager = {
      loadSessionAgentConfig: vi.fn(),
    } as unknown as SessionManager;

    await act(async () => {
      root.render(
        <Probe
          sessionKey="agent:main:webchat:one"
          sessionManager={sessionManager}
          onState={() => {}}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toBe('ready:codingProject');

    act(() => {
      root.render(
        <Probe
          sessionKey="agent:main:webchat:two"
          sessionManager={sessionManager}
          onState={() => {}}
        />,
      );
    });

    expect(container.textContent).toBe('loading:empty');

    await act(async () => {
      resolveSecondDetail?.({ projectId: null });
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it('uses a resolved workspace path without entering loading', () => {
    const sessionManager = {
      loadSessionAgentConfig: vi.fn(),
    } as unknown as SessionManager;

    act(() => {
      root.render(
        <Probe
          effectiveWorkspacePath="/repo/xopc"
          sessionManager={sessionManager}
          onState={() => {}}
        />,
      );
    });

    expect(container.textContent).toBe('ready:workingDirectory');
    expect(sessionManager.loadSessionAgentConfig).not.toHaveBeenCalled();
  });

  it('degrades to general suggestions and retries failed context reads', async () => {
    getSessionDetail.mockRejectedValue(new Error('offline'));
    const loadSessionAgentConfig = vi.fn().mockRejectedValue(new Error('offline'));
    const sessionManager = { loadSessionAgentConfig } as unknown as SessionManager;
    let latest: WelcomeSuggestionContextState | null = null;

    await act(async () => {
      root.render(<Probe sessionManager={sessionManager} onState={(state) => { latest = state; }} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toBe('degraded:empty');
    expect(getSessionDetail).toHaveBeenCalledTimes(1);

    await act(async () => {
      latest?.retry();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getSessionDetail).toHaveBeenCalledTimes(2);
  });
});
