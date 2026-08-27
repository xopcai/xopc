// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ChatPageHeaderRegistration } from '@/features/chat/chat-page-header-registration';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { useWorkspacePanelStore } from '@/stores/workspace-panel-store';

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
                    workspacePath="/Users/example/projects/xopc"
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

    const projectFilesButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Project Files: xopc"]',
    );
    const chooseFolderButton = container.querySelector<HTMLButtonElement>(
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

  it('removes directory selection after the conversation starts', () => {
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
                    workspacePath="/Users/example/projects/xopc"
                    canChangeWorkspace={false}
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

    const projectFilesButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Project Files: xopc"]',
    );
    expect(projectFilesButton).not.toBeNull();
    expect(container.querySelector('[aria-label="Choose folder…"]')).toBeNull();

    act(() => projectFilesButton?.click());
    expect(useWorkspacePanelStore.getState()).toMatchObject({
      open: true,
      sessionKeyOverride: 'session-1',
    });
  });
});
