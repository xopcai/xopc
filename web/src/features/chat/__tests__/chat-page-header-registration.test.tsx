// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatPageHeaderRegistration } from '@/features/chat/chat-page-header-registration';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { useTerminalPanelStore } from '@/stores/terminal-panel-store';
import { useWorkspacePanelStore } from '@/stores/workspace-panel-store';

vi.mock('@/features/chat/context/use-session-context', () => ({
  useSessionContext: (conversationId: string) => ({
    data: { conversationId, work: {}, sources: [], unavailableSections: [], environment: { kind: 'local_checkout', rootPath: '/Users/example/projects/xopc', available: true } },
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
    useTerminalPanelStore.setState({
      openByConversationId: {},
      tabsByConversationId: {},
      activeTabKeyByConversationId: {},
      height: 300,
    });
    useWorkspacePanelStore.setState({ open: false, conversationIdOverride: null });
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    usePageHeaderStore.setState(emptyHeader);
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });
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

  it('keeps one context and files control through repeated session switches', () => {
    for (const conversationId of ['session-1', 'session-2', 'session-3', 'session-1']) {
      act(() => {
        root.render(
          <MemoryRouter>
            <ChatPageHeaderRegistration
              chatHeadline={conversationId}
              chatAgents={[]}
              showChatAgentSelector={false}
              chatAgentId="main"
              onChatAgentChange={() => {}}
              chatAgentDisabled={false}
              conversationId={conversationId}
              workspacePath="/Users/example/projects/xopc"
              onWorkspaceChange={async () => {}}
            />
            <HeaderEnd />
          </MemoryRouter>,
        );
      });

      expect(container.querySelectorAll('[aria-label="Session context"]')).toHaveLength(1);
      expect(container.querySelectorAll('[aria-label="Project Files: xopc"]')).toHaveLength(1);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      act(() => container.querySelector<HTMLButtonElement>('[aria-label="Project Files: xopc"]')!.click());
      expect(useWorkspacePanelStore.getState().conversationIdOverride).toBe(conversationId);
      act(() => container.querySelector<HTMLButtonElement>('[aria-label="Session context"]')!.click());
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    }
  });

  it('opens project files directly and keeps directory selection separate for a new conversation', () => {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/chat/session-1']}>
          <Routes>
            <Route
              path="/chat/:conversationId"
              element={(
                <>
                  <ChatPageHeaderRegistration
                    chatHeadline="Project planning"
                    chatAgents={[]}
                    showChatAgentSelector={false}
                    chatAgentId="main"
                    onChatAgentChange={() => {}}
                    chatAgentDisabled={false}
                    conversationId="session-1"
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

    expect(container.querySelector('[aria-label="Project Files: xopc"]')).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
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
      conversationIdOverride: 'session-1',
    });
  });

  it('opens project files before a session is created', () => {
    useWorkspacePanelStore.setState({ conversationIdOverride: 'previous-session' });
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/chat/new?projectId=project-1']}>
          <Routes>
            <Route path="/chat/:conversationId" element={(
              <>
                <ChatPageHeaderRegistration
                  chatHeadline="New chat"
                  chatAgents={[]}
                  showChatAgentSelector={false}
                  chatAgentId="main"
                  onChatAgentChange={() => {}}
                  chatAgentDisabled={false}
                  projectId="project-1"
                  context={{ project: { id: 'project-1', name: 'Project', workspaceRoot: '/repo/project' } }}
                  onWorkspaceChange={async () => {}}
                />
                <HeaderEnd />
              </>
            )} />
          </Routes>
        </MemoryRouter>,
      );
    });
    const button = container.querySelector<HTMLButtonElement>('[aria-label="Project Files: project"]');
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(false);
    expect(button?.title).toContain('/repo/project');
    act(() => button!.click());
    expect(useWorkspacePanelStore.getState()).toMatchObject({ open: true, conversationIdOverride: null });
  });

  it('prepares and opens a terminal before the first project message', async () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { platform: 'darwin', terminal: {} },
    });
    const prepareTerminalSession = vi.fn(async () => 'created-session');
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/chat/new?projectId=project-1']}>
          <Routes>
            <Route path="/chat/:conversationId" element={(
              <>
                <ChatPageHeaderRegistration
                  chatHeadline="New code chat"
                  chatAgents={[]}
                  showChatAgentSelector={false}
                  chatAgentId="coder"
                  onChatAgentChange={() => {}}
                  chatAgentDisabled={false}
                  projectId="project-1"
                  prepareTerminalSession={prepareTerminalSession}
                />
                <HeaderEnd />
              </>
            )} />
          </Routes>
        </MemoryRouter>,
      );
    });

    const terminalButton = container.querySelector<HTMLButtonElement>('[aria-label="Open terminal"]');
    expect(terminalButton).not.toBeNull();
    await act(async () => terminalButton!.click());

    expect(prepareTerminalSession).toHaveBeenCalledOnce();
    expect(useTerminalPanelStore.getState().openByConversationId['created-session']).toBe(true);
    expect(useTerminalPanelStore.getState().tabsByConversationId['created-session']).toHaveLength(1);
  });

  it('keeps project files available while directory selection is locked', () => {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/chat/session-1']}>
          <Routes>
            <Route
              path="/chat/:conversationId"
              element={(
                <>
                  <ChatPageHeaderRegistration
                    chatHeadline="Project planning"
                    chatAgents={[]}
                    showChatAgentSelector={false}
                    chatAgentId="main"
                    onChatAgentChange={() => {}}
                    chatAgentDisabled={false}
                    conversationId="session-1"
                    workspacePath="/Users/example/projects/xopc"
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

    const projectFilesButton = document.querySelector<HTMLButtonElement>(
      '[aria-label="Project Files: xopc"]',
    );
    expect(projectFilesButton).not.toBeNull();
    expect(projectFilesButton?.disabled).toBe(false);
    expect(document.querySelector('[aria-label="Choose folder…"]')).toBeNull();

    act(() => projectFilesButton?.click());
    expect(useWorkspacePanelStore.getState()).toMatchObject({
      open: true,
      conversationIdOverride: 'session-1',
    });
  });
});
