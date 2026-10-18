// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatPageHeaderRegistration } from '@/features/chat/chat-page-header-registration';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { useRightWorkspaceStore } from '@/stores/right-workspace-store';
import { useSideChatStore } from '@/stores/side-chat-store';
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
    useLocaleStore.setState({ language: 'en' });
    useTerminalPanelStore.setState({
      openByConversationId: {},
      tabsByConversationId: {},
      activeTabKeyByConversationId: {},
      height: 300,
    });
    useRightWorkspaceStore.setState({ panes: {}, scope: 'new' });
    useWorkspacePanelStore.setState({ open: false, conversationIdOverride: null });
    useSideChatStore.setState({ panes: {}, tabs: [], pendingCreate: null });
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

  it('keeps one context and workspace control through repeated session switches', () => {
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

      expect(container.querySelectorAll('[aria-label="Session info"]')).toHaveLength(1);
      const alreadyOpen = useRightWorkspaceStore.getState().panes[conversationId]?.open === true;
      expect(container.querySelectorAll('[aria-label="Open workspace tools"]')).toHaveLength(alreadyOpen ? 0 : 1);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      if (!alreadyOpen) act(() => container.querySelector<HTMLButtonElement>('[aria-label="Open workspace tools"]')!.click());
      expect(useRightWorkspaceStore.getState().panes[conversationId]?.open).toBe(true);
      act(() => container.querySelector<HTMLButtonElement>('[aria-label="Session info"]')!.click());
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    }
  });

  it('opens tools and places directory selection inside session info', () => {
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

    expect(container.querySelector('[aria-label="Open workspace tools"]')).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const projectFilesButton = document.querySelector<HTMLButtonElement>(
      '[aria-label="Open workspace tools"]',
    );
    const chooseFolderButton = document.querySelector<HTMLButtonElement>(
      '[aria-label="Choose folder…"]',
    );
    expect(projectFilesButton).not.toBeNull();
    expect(projectFilesButton?.title).toBe('Open workspace tools');
    expect(chooseFolderButton).toBeNull();

    act(() => projectFilesButton?.click());
    expect(useWorkspacePanelStore.getState()).toMatchObject({
      open: true,
      conversationIdOverride: 'session-1',
    });
    expect(useRightWorkspaceStore.getState().panes['session-1'].tabs[0]?.kind).toBe('home');
    expect(container.querySelector('[aria-label="Open workspace tools"]')).toBeNull();
    expect(container.querySelector('[aria-label="Session info"]')).not.toBeNull();
    act(() => useRightWorkspaceStore.getState().setOpen(false, 'session-1'));
    expect(container.querySelector('[aria-label="Open workspace tools"]')).not.toBeNull();
    act(() => useRightWorkspaceStore.getState().openFiles('session-1'));
    expect(container.querySelector('[aria-label="Open workspace tools"]')).toBeNull();

    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Session info"]')!.click());
    expect(document.querySelector('[role="dialog"] [aria-label="Choose folder…"]')).not.toBeNull();
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Session info"]')!.click());
    act(() => { useRightWorkspaceStore.getState().openBrowser('https://example.test', 'session-1'); });
    const activeId = useRightWorkspaceStore.getState().panes['session-1'].activeId;
    expect(container.querySelector('[aria-label="Open workspace tools"]')).toBeNull();
    act(() => useRightWorkspaceStore.getState().setOpen(false, 'session-1'));
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Open workspace tools"]')!.click());
    expect(useRightWorkspaceStore.getState().panes['session-1'].tabs.find(t => t.id === useRightWorkspaceStore.getState().panes['session-1'].activeId)?.kind).toBe('home');
    expect(container.querySelector('[aria-label="Open workspace tools"]')).toBeNull();
    expect(useRightWorkspaceStore.getState().panes['session-1'].open).toBe(true);
    expect(useRightWorkspaceStore.getState().panes['session-1'].tabs.some(t => t.id === activeId)).toBe(true);
    expect(useRightWorkspaceStore.getState().panes['session-1'].tabs.filter(t => t.kind === 'home')).toHaveLength(1);
  });

  it('opens tools before a session is created', () => {
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
    const button = container.querySelector<HTMLButtonElement>('[aria-label="Open workspace tools"]');
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(false);
    expect(button?.title).toBe('Open workspace tools');
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

    expect(container.querySelector('[aria-label="Open terminal"]')).toBeNull();
    await act(async () => window.dispatchEvent(new Event('workspace-open-terminal')));

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
      '[aria-label="Open workspace tools"]',
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

  it('opens conversation search through the menu after it closes', async () => {
    const find = vi.fn();
    await act(async () => root.render(<MemoryRouter>
      <ChatPageHeaderRegistration chatHeadline="Search" chatAgents={[]} showChatAgentSelector={false}
        chatAgentId="main" onChatAgentChange={() => {}} chatAgentDisabled={false}
        conversationId="session-1" hasMessages onFindOpen={find} />
      <HeaderEnd />
    </MemoryRouter>));
    const menu = container.querySelector<HTMLButtonElement>('[aria-label="Chat menu"]')!;
    await act(async () => menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(el => el.textContent?.includes('Find in conversation'))!;
    expect(item).toBeDefined();
    await act(async () => item.click());
    await act(async () => { await vi.waitFor(() => expect(find).toHaveBeenCalledOnce()); });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(menu);
  });

  it('keeps only menu, context and tools while retaining the side chat shortcut', () => {
    const renderHeader = (hasMessages: boolean) => {
      act(() => {
        root.render(
          <MemoryRouter initialEntries={['/chat/session-1']}>
            <ChatPageHeaderRegistration
              chatHeadline="Project planning"
              chatAgents={[]}
              showChatAgentSelector={false}
              chatAgentId="main"
              onChatAgentChange={() => {}}
              chatAgentDisabled={false}
              conversationId="session-1"
              hasMessages={hasMessages}
            />
            <HeaderEnd />
          </MemoryRouter>,
        );
      });
    };

    renderHeader(false);
    expect(container.querySelector('[aria-label="Open side chat"]')).toBeNull();

    renderHeader(true);
    expect(container.querySelector('[aria-label="Open side chat"]')).toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(3);
    expect(container.querySelector('[aria-label="Chat menu"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Session info"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Open workspace tools"]')).not.toBeNull();

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', {
      ctrlKey: true,
      key: 'b',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })));
    expect(useSideChatStore.getState().panes['session-1']?.open).toBe(true);
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: 'b', shiftKey: true, bubbles: true, cancelable: true })));
    expect(useSideChatStore.getState().panes['session-1']?.open).toBe(false);
  });
});
