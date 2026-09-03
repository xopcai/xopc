// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatPageHeaderRegistration } from '@/features/chat/chat-page-header-registration';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { useWorkspacePanelStore } from '@/stores/workspace-panel-store';

vi.mock('@/features/chat/context/use-session-context', () => ({
  useSessionContext: (sessionKey: string) => ({
    data: { sessionKey, work: {}, sources: [], unavailableSections: [], environment: { kind: 'local_checkout', rootPath: '/Users/example/projects/xopc', available: true } },
    mutate: vi.fn(),
  }),
}));

const emptyHeader = {
  startExtra: null,
  main: null,
  end: null,
};

function HeaderEnd() {
  const end = usePageHeaderStore((state) => state.end);
  return <>{end}</>;
}

describe('ChatPageHeaderRegistration', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.matchMedia ??= () => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
    usePageHeaderStore.setState(emptyHeader);
    useWorkspacePanelStore.setState({ open: false, sessionKeyOverride: null });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    usePageHeaderStore.setState(emptyHeader);
  });

  it('does not clear the shell header while replacing chat session details', () => {
    const states: boolean[] = [];
    const unsubscribe = usePageHeaderStore.subscribe((state) => {
      states.push(state.main === null);
    });

    act(() => {
      root.render(
        <MemoryRouter>
          <ChatPageHeaderRegistration
            chatHeadline="New chat"
            chatAgents={[]}
            showChatAgentSelector={false}
            chatAgentId="main"
            onChatAgentChange={() => {}}
            chatAgentDisabled
          />
        </MemoryRouter>,
      );
    });

    states.length = 0;

    act(() => {
      root.render(
        <MemoryRouter>
          <ChatPageHeaderRegistration
            chatHeadline="Project planning"
            chatAgents={[]}
            showChatAgentSelector={false}
            chatAgentId="main"
            onChatAgentChange={() => {}}
            chatAgentDisabled={false}
          />
        </MemoryRouter>,
      );
    });

    unsubscribe();
    expect(states).toEqual([false]);
  });

  it('opens project files directly and keeps directory selection separate for a new conversation', () => {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/chat/session-1']}>
          <Routes>
            <Route
              path="/chat/:sessionKey"
              element={(
                <>
                  <ChatPageHeaderRegistration
                    chatHeadline="Project planning"
                    chatAgents={[]}
                    showChatAgentSelector={false}
                    chatAgentId="main"
                    onChatAgentChange={() => {}}
                    chatAgentDisabled={false}
                    sessionKey="session-1"
                    canChangeWorkspace
                    onWorkspaceChange={async () => {}}
                  />
                  <HeaderEnd />
                </>
              )}
            />
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('[aria-label="Project Files: xopc"]')).toBeNull();
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Session context"]')?.click());
    const projectFilesButton = document.querySelector<HTMLButtonElement>(
      '[aria-label="Project Files: xopc"]',
    );
    const chooseFolderButton = document.querySelector<HTMLButtonElement>(
      '[aria-label="Choose folder…"]',
    );
    expect(projectFilesButton).not.toBeNull();
    expect(projectFilesButton?.title).toContain('/Users/example/projects/xopc');
    expect(chooseFolderButton).not.toBeNull();

    act(() => projectFilesButton?.click());
    expect(useWorkspacePanelStore.getState()).toMatchObject({
      open: true,
      sessionKeyOverride: 'session-1',
    });
  });

  it('keeps project files available while directory selection is locked', () => {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/chat/session-1']}>
          <Routes>
            <Route
              path="/chat/:sessionKey"
              element={(
                <>
                  <ChatPageHeaderRegistration
                    chatHeadline="Project planning"
                    chatAgents={[]}
                    showChatAgentSelector={false}
                    chatAgentId="main"
                    onChatAgentChange={() => {}}
                    chatAgentDisabled={false}
                    sessionKey="session-1"
                    canChangeWorkspace={false}
                    workspaceDisabled
                    onWorkspaceChange={async () => {}}
                  />
                  <HeaderEnd />
                </>
              )}
            />
          </Routes>
        </MemoryRouter>,
      );
    });

    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Session context"]')?.click());
    const projectFilesButton = document.querySelector<HTMLButtonElement>(
      '[aria-label="Project Files: xopc"]',
    );
    expect(projectFilesButton).not.toBeNull();
    expect(projectFilesButton?.disabled).toBe(false);
    expect(document.querySelector('[aria-label="Choose folder…"]')).toBeNull();

    act(() => projectFilesButton?.click());
    expect(useWorkspacePanelStore.getState()).toMatchObject({
      open: true,
      sessionKeyOverride: 'session-1',
    });
  });
});
