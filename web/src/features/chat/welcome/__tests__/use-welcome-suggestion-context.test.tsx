// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useWelcomeSuggestionContext,
  type WelcomeSuggestionContextState,
} from '@/features/chat/welcome/use-welcome-suggestion-context';

const { getSessionDetail, readLocalSessionDraft, fetchProject, fetchProjectOperatingView } = vi.hoisted(() => ({
  getSessionDetail: vi.fn(),
  readLocalSessionDraft: vi.fn(),
  fetchProject: vi.fn(),
  fetchProjectOperatingView: vi.fn(),
}));

vi.mock('@/features/sessions/session-api', () => ({ getSessionDetail }));
vi.mock('@/features/chat/session/local-session-drafts', () => ({ readLocalSessionDraft }));
vi.mock('@/features/projects/api', () => ({ fetchProject, fetchProjectOperatingView }));

function Probe({
  conversationId = 'agent:main:webchat:test',
  suppressProjectContext = false,
  project,
  onState,
}: {
  conversationId?: string;
  suppressProjectContext?: boolean;
  project?: { id: string; name: string };
  onState: (state: WelcomeSuggestionContextState) => void;
}) {
  const state = useWelcomeSuggestionContext({
    enabled: true,
    conversationId,
    suppressProjectContext,
    project,
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
    readLocalSessionDraft.mockResolvedValue(undefined);
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

  it('publishes loading before the project context is resolved', async () => {
    getSessionDetail.mockResolvedValue({ projectId: 'p1' });
    fetchProject.mockResolvedValue({ id: 'p1', name: 'xopc' });
    const states: string[] = [];

    await act(async () => {
      root.render(<Probe onState={(state) => states.push(`${state.status}:${state.context.kind}`)} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(states).toContain('loading:empty');
    expect(container.textContent).toBe('ready:project');
  });

  it('uses a local draft project without fetching a missing session', async () => {
    readLocalSessionDraft.mockResolvedValue({ creation: { projectId: 'p1' } });
    fetchProject.mockResolvedValue({ id: 'p1', name: 'xopc' });

    await act(async () => {
      root.render(<Probe onState={() => {}} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toBe('ready:project');
    expect(getSessionDetail).not.toHaveBeenCalled();
  });

  it('uses the selected project before a new session exists', () => {
    let latest!: WelcomeSuggestionContextState;

    act(() => {
      root.render(
        <Probe
          conversationId=""
          project={{ id: 'p1', name: 'xopc-plugins' }}
          onState={(state) => { latest = state; }}
        />,
      );
    });

    expect(latest).toEqual({
      context: { kind: 'project', projectId: 'p1', projectName: 'xopc-plugins' },
      status: 'ready',
    });
    expect(readLocalSessionDraft).not.toHaveBeenCalled();
    expect(getSessionDetail).not.toHaveBeenCalled();
  });

  it('enriches a selected project after the session exists', async () => {
    fetchProjectOperatingView.mockResolvedValue({
      blockers: [{ title: 'Release blocked', detail: 'CI is failing' }],
      recentResults: [],
      digest: { health: 'attention', summary: 'Needs attention' },
    });
    let latest!: WelcomeSuggestionContextState;

    await act(async () => {
      root.render(
        <Probe
          project={{ id: 'p1', name: 'xopc-plugins' }}
          onState={(state) => { latest = state; }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(latest.context).toMatchObject({
      kind: 'project',
      projectId: 'p1',
      projectName: 'xopc-plugins',
      blockedReason: 'CI is failing',
    });
    expect(fetchProject).not.toHaveBeenCalled();
    expect(fetchProjectOperatingView).toHaveBeenCalledWith('p1');
  });

  it('publishes only explicit project signals', async () => {
    getSessionDetail.mockResolvedValue({ projectId: 'p1' });
    fetchProject.mockResolvedValue({ id: 'p1', name: 'xopc' });
    fetchProjectOperatingView.mockResolvedValue({
      blockers: [{ title: 'Release blocked', detail: 'CI is failing' }],
      recentResults: [],
      digest: { health: 'attention', summary: 'Needs attention', recommendedAction: 'Fix CI' },
    });
    let latest!: WelcomeSuggestionContextState;

    await act(async () => {
      root.render(<Probe onState={(state) => { latest = state; }} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(latest.context).toMatchObject({
      kind: 'project',
      blockedReason: 'CI is failing',
      recommendedAction: 'Fix CI',
    });
  });

  it('keeps note, file, and workspace launches quiet', () => {
    act(() => {
      root.render(<Probe suppressProjectContext onState={() => {}} />);
    });

    expect(container.textContent).toBe('ready:empty');
    expect(readLocalSessionDraft).not.toHaveBeenCalled();
    expect(getSessionDetail).not.toHaveBeenCalled();
  });

  it('degrades without inventing context when session lookup fails', async () => {
    getSessionDetail.mockRejectedValue(new Error('offline'));

    await act(async () => {
      root.render(<Probe onState={() => {}} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toBe('degraded:empty');
    expect(fetchProject).not.toHaveBeenCalled();
  });
});
