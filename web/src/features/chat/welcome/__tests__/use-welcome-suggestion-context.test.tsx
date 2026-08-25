// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionManager } from '@/features/chat/session/session-manager';
import {
  useWelcomeSuggestionContext,
  type WelcomeSuggestionContextState,
} from '@/features/chat/welcome/use-welcome-suggestion-context';

const { getSessionDetail, fetchProject, fetchProjectOperatingView, inferProjectDefaults } = vi.hoisted(() => ({
  getSessionDetail: vi.fn(),
  fetchProject: vi.fn(),
  fetchProjectOperatingView: vi.fn(),
  inferProjectDefaults: vi.fn(),
}));

vi.mock('@/features/sessions/session-api', () => ({ getSessionDetail }));
vi.mock('@/features/projects/api', () => ({ fetchProject, fetchProjectOperatingView, inferProjectDefaults }));

function Probe({
  sessionKey = 'agent:main:webchat:test',
  effectiveWorkspacePath,
  workingDirectoryLocked = false,
  sessionManager,
  onState,
}: {
  sessionKey?: string;
  effectiveWorkspacePath?: string | null;
  workingDirectoryLocked?: boolean;
  sessionManager: SessionManager;
  onState: (state: WelcomeSuggestionContextState) => void;
}) {
  const state = useWelcomeSuggestionContext({
    enabled: true,
    sessionKey,
    effectiveWorkspacePath,
    workingDirectoryLocked,
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
    inferProjectDefaults.mockResolvedValue({ inference: { kind: 'general' } });
    fetchProjectOperatingView.mockResolvedValue({
      blockers: [],
      recentResults: [],
      digest: { health: 'healthy', summary: 'On track' },
    });
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

  it('adds the project blocker and recommended action to the resolved context', async () => {
    getSessionDetail.mockResolvedValue({ projectId: 'p1' });
    fetchProject.mockResolvedValue({ id: 'p1', name: 'xopc', kind: 'coding' });
    fetchProjectOperatingView.mockResolvedValue({
      blockers: [{ title: 'Release blocked', detail: 'CI is failing' }],
      recentResults: [],
      digest: { health: 'attention', summary: 'Needs attention', recommendedAction: 'Fix CI' },
    });
    const sessionManager = { loadSessionAgentConfig: vi.fn() } as unknown as SessionManager;
    let latest!: WelcomeSuggestionContextState;

    await act(async () => {
      root.render(<Probe sessionManager={sessionManager} onState={(state) => { latest = state; }} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(latest.context).toMatchObject({
      kind: 'codingProject',
      blockedReason: 'CI is failing',
      recommendedAction: 'Fix CI',
    });
  });

  it('keeps an unclassified workspace non-code without entering loading', async () => {
    const sessionManager = {
      loadSessionAgentConfig: vi.fn(),
    } as unknown as SessionManager;

    await act(async () => {
      root.render(
        <Probe
          effectiveWorkspacePath="/repo/xopc"
          workingDirectoryLocked
          sessionManager={sessionManager}
          onState={() => {}}
        />,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toBe('ready:workingDirectory');
    expect(sessionManager.loadSessionAgentConfig).not.toHaveBeenCalled();
  });

  it('uses code suggestions only after workspace detection confirms a code project', async () => {
    inferProjectDefaults.mockResolvedValue({ inference: { kind: 'coding' } });
    const sessionManager = { loadSessionAgentConfig: vi.fn() } as unknown as SessionManager;

    await act(async () => {
      root.render(
        <Probe
          effectiveWorkspacePath="/repo/xopc"
          workingDirectoryLocked
          sessionManager={sessionManager}
          onState={() => {}}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toBe('ready:codingWorkspace');
    expect(inferProjectDefaults).toHaveBeenCalledWith({ workspaceRoot: '/repo/xopc' });
  });

  it('treats the inherited default workspace as no welcome context', () => {
    const sessionManager = { loadSessionAgentConfig: vi.fn() } as unknown as SessionManager;

    act(() => {
      root.render(
        <Probe
          sessionKey=""
          effectiveWorkspacePath="/Users/example/.xopc/workspace"
          sessionManager={sessionManager}
          onState={() => {}}
        />,
      );
    });

    expect(container.textContent).toBe('ready:empty');
    expect(inferProjectDefaults).not.toHaveBeenCalled();
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
