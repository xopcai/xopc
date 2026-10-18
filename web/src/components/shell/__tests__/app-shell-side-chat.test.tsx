// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppShell } from '@/components/shell/app-shell';
import { ChatPageHeaderRegistration } from '@/features/chat/chat-page-header-registration';
import { TaskChatPage } from '@/features/chat/task/task-chat-page';
import { RightWorkspace } from '@/features/right-workspace/right-workspace';
import { fetchTask, type TaskDetail } from '@/features/tasks/home-api';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { useRightWorkspaceStore } from '@/stores/right-workspace-store';
import { useSideChatStore } from '@/stores/side-chat-store';
import { useWorkspacePreviewStore } from '@/stores/workspace-preview-store';

vi.mock('@/features/tasks/home-api', () => ({ fetchTask: vi.fn(), ensureTaskConversation: vi.fn() }));
vi.mock('@/features/chat/chat-page', () => ({
  ChatPage: ({ conversationId }: { conversationId: string }) => <>
    <ChatPageHeaderRegistration
      conversationId={conversationId} hasMessages chatHeadline="Research"
      chatAgents={[]} showChatAgentSelector={false} chatAgentId="main"
      onChatAgentChange={() => {}} chatAgentDisabled
    />
    <p data-chat-message-index="0">Research results for {conversationId}</p>
    <Link to="/chat/task/task-2">Next task</Link>
    <Link to="/chat/ordinary">Ordinary chat</Link>
    <Link to="/chat/new">New chat</Link>
    <Link to="/tasks">Tasks</Link>
  </>,
}));
vi.mock('@/components/shell/primary-app-header', () => ({
  PrimaryAppHeader: () => <header>{usePageHeaderStore((state) => state.end)}</header>,
}));
vi.mock('@/features/side-chat/side-chat-column', () => ({
  SideChatColumn: ({ parentConversationId, visible = true }: { parentConversationId: string; visible?: boolean }) => visible ? (
    <aside id="app-side-chat-panel" data-parent={parentConversationId} />
  ) : null,
}));
vi.mock('@/features/chat/context/use-session-context', () => ({ useSessionContext: () => ({ mutate: vi.fn() }) }));
vi.mock('@/features/shares/session-share-button', () => ({ SessionShareButton: () => null }));
vi.mock('@/features/voice/realtime/voice-call-provider', () => ({ VoiceCallProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/features/voice/read-aloud-dock', () => ({ ReadAloudDockProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/features/updater/use-update-reminder', () => ({ useUpdateReminder: () => null }));
vi.mock('@/features/workspace/workspace-file-preview-dialog', () => ({ WorkspaceFilePreviewPanel: ({ active, filePath }: { active: boolean; filePath: string }) => active ? <div data-file-preview>{filePath}</div> : null }));
vi.mock('@/components/shell/workspace-column', () => ({ WorkspaceColumn: ({ onCloseTree }: { onCloseTree?: () => void }) => <aside data-workspace><button aria-label="Close file tree" onClick={onCloseTree} /></aside> }));
vi.mock('@/components/shell/mobile-primary-nav', () => ({ MobilePrimaryNav: () => null }));
vi.mock('@/components/shell/sidebar-column', () => ({ SidebarColumn: () => null }));
vi.mock('@/components/shell/token-dialog', () => ({ TokenDialog: () => null }));
vi.mock('@/components/shell/windows-titlebar', () => ({ WindowsTitlebar: () => null }));
vi.mock('@/components/shell/onboarding-dialog', () => ({ OnboardingDialog: () => null }));
vi.mock('@/features/electron/electron-gateway-exit-banner', () => ({ ElectronGatewayExitBanner: () => null }));
vi.mock('@/features/endpoint-tools/endpoint-tool-bridge', () => ({ EndpointToolBridge: () => null }));
vi.mock('@/features/electron/electron-menu-listener', () => ({ ElectronMenuListener: () => null }));
vi.mock('@/features/gateway/gateway-restart-banner', () => ({ GatewayRestartBanner: () => null }));
vi.mock('@/features/updater/update-reminder-bar', () => ({ UpdateReminderBar: () => null }));
vi.mock('@/features/search/global-command-palette/global-command-palette-host', () => ({ GlobalCommandPaletteHost: () => null }));
vi.mock('@/features/chat/product-preview/product-preview-modal', () => ({ ProductPreviewModal: () => null }));
vi.mock('@/features/notes/note-preview-modal', () => ({ NotePreviewModal: () => null }));
vi.mock('@/features/notes/global-quick-capture', () => ({ GlobalQuickCaptureHost: () => null }));
vi.mock('@/features/discussions/global-discussion-capture', () => ({ GlobalDiscussionCaptureHost: () => null }));
vi.mock('@/features/gateway/gateway-realtime-bridge', () => ({ GatewayRealtimeBridge: () => null }));
vi.mock('@/features/notifications/product-notification-coordinator', () => ({ ProductNotificationCoordinator: () => null }));
vi.mock('@/features/support/support-report-host', () => ({ SupportReportHost: () => null }));
vi.mock('@/features/voice/global-read-aloud-player', () => ({ GlobalReadAloudPlayer: () => null }));
vi.mock('@/features/voice/global-voice-input-shortcut-host', () => ({ GlobalVoiceInputShortcutHost: () => null }));
vi.mock('@/features/work-discovery/understanding-activity-coordinator', () => ({ UnderstandingActivityCoordinator: () => null }));

function detail(conversationId: string): TaskDetail {
  return { conversation: { activeConversationId: conversationId }, task: { version: 1 }, operationalState: 'idle' } as TaskDetail;
}

describe('AppShell task Sidechat', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.clearAllMocks();
    window.matchMedia ??= () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList;
    useGatewayStore.setState({ conversationId: 'gateway-token' });
    useLocaleStore.setState({ language: 'en' });
    useSideChatStore.getState().reset();
    useWorkspacePreviewStore.setState({ path: null });
    usePageHeaderStore.getState().clearPageHeader();
    vi.mocked(fetchTask).mockImplementation(async (taskId) => detail(`conversation-${taskId}`));
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function render(path = '/chat/task/task-1') {
    await act(async () => root.render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/chat/task/:taskId" element={<TaskChatPage />} />
              <Route path="/chat/:conversationId" element={<OrdinaryChat />} />
              <Route path="/tasks" element={<p>Tasks page</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </SWRConfig>,
    ));
  }

  async function click(label: string) {
    if (label === 'Open side chat' || label === 'Collapse side chat') {
      await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })));
      return;
    }
    const element = [...container.querySelectorAll<HTMLElement>('button, a')]
      .find((node) => node.getAttribute('aria-label') === label || node.textContent === label);
    expect(element, label).toBeDefined();
    await act(async () => element!.click());
  }

  it('opens and collapses the panel using the task conversation, then isolates another task', async () => {
    await render();
    await click('Open side chat');
    expect(container.querySelector('#app-side-chat-panel')?.getAttribute('data-parent')).toBe('conversation-task-1');
    expect(useSideChatStore.getState().panes['conversation-task-1']?.open).toBe(true);
    await click('Collapse side chat');
    expect(container.querySelector('#app-side-chat-panel')).toBeNull();
    await click('Open side chat');
    await click('Next task');
    expect(container.querySelector('#app-side-chat-panel')).toBeNull();
    await click('Open side chat');
    expect(container.querySelector('#app-side-chat-panel')?.getAttribute('data-parent')).toBe('conversation-task-2');
    expect(useSideChatStore.getState().panes['task/task-1']).toBeUndefined();
  });

  it('waits for task detail instead of treating the task route as a conversation ID', async () => {
    let resolve!: (value: TaskDetail) => void;
    vi.mocked(fetchTask).mockReturnValue(new Promise((done) => { resolve = done; }));
    useSideChatStore.getState().setOpen('task/task-1', true);
    await render();
    expect(container.querySelector('#app-side-chat-panel')).toBeNull();
    expect(container.querySelector('[aria-label="Open side chat"]')).toBeNull();
    await act(async () => resolve(detail('real-conversation')));
    await click('Open side chat');
    expect(container.querySelector('#app-side-chat-panel')?.getAttribute('data-parent')).toBe('real-conversation');
  });

  it('follows a refreshed task conversation instead of keeping the old parent', async () => {
    await render();
    await click('Open side chat');
    vi.mocked(fetchTask).mockResolvedValue(detail('replacement-conversation'));
    await act(async () => {
      window.dispatchEvent(new CustomEvent('task-changed-v2', { detail: {
        taskId: 'task-1', version: 2, source: 'agent', changedFields: ['conversation'], occurredAt: 1,
      } }));
      await new Promise((resolve) => window.setTimeout(resolve, 150));
    });
    expect(container.querySelector('#app-side-chat-panel')).toBeNull();
    await click('Open side chat');
    expect(container.querySelector('#app-side-chat-panel')?.getAttribute('data-parent')).toBe('replacement-conversation');
  });

  it('keeps ordinary chats working and hides the panel on new chats and non-chat pages', async () => {
    await render();
    await click('Ordinary chat');
    await click('Open side chat');
    expect(container.querySelector('#app-side-chat-panel')?.getAttribute('data-parent')).toBe('ordinary');
    await click('New chat');
    expect(container.querySelector('#app-side-chat-panel')).toBeNull();
    await click('Tasks');
    expect(container.querySelector('#app-side-chat-panel')).toBeNull();
  });

  it('keeps the main chat mounted with its draft while switching file and side chat tabs', async () => {
    await render('/chat/ordinary');
    const draft = container.querySelector<HTMLInputElement>('[data-main-draft]')!;
    draft.value = 'unsent main draft';
    let file = '';
    await act(async () => { file = useRightWorkspaceStore.getState().openFile({ path: 'report.md', conversationId: 'ordinary' }, 'ordinary'); });
    expect(container.querySelector('[data-file-preview]')?.textContent).toBe('report.md');
    expect(container.querySelector('[data-main-draft]')).toBe(draft);
    await act(async () => useSideChatStore.getState().addTab({ id: 'side-1', title: 'Side chat', parentConversationId: 'ordinary' }));
    expect(container.querySelector('#app-side-chat-panel')).not.toBeNull();
    expect(container.querySelector('[data-main-draft]')).toBe(draft);
    expect(draft.value).toBe('unsent main draft');
    await act(async () => useRightWorkspaceStore.getState().activate(file, 'ordinary'));
    expect(container.querySelector('[data-file-preview]')?.textContent).toBe('report.md');
    await act(async () => useRightWorkspaceStore.getState().setOpen(false, 'ordinary'));
    expect(useRightWorkspaceStore.getState().panes.ordinary.open).toBe(false);
    expect(draft.value).toBe('unsent main draft');
  });

  it('closes the last tool tab without revealing project files and can reopen tools', async () => {
    await render('/chat/ordinary');
    const draft = container.querySelector<HTMLInputElement>('[data-main-draft]')!;
    draft.value = 'keep my draft';
    await act(async () => useRightWorkspaceStore.getState().openTools('ordinary'));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Close New tab"]')!.click());
    const panel = container.querySelector<HTMLElement>('[data-right-workspace]')!;
    expect(panel.getAttribute('aria-hidden')).toBe('true');
    expect(panel.querySelector('[data-workspace-tree]')?.classList.contains('hidden')).toBe(true);
    expect(panel.textContent).not.toContain('Project files');
    expect(container.querySelector('[data-main-draft]')).toBe(draft);
    expect(draft.value).toBe('keep my draft');
    await act(async () => useRightWorkspaceStore.getState().setOpen(true, 'ordinary'));
    expect(panel.getAttribute('aria-hidden')).toBe('false');
    expect(panel.querySelector('[aria-label="Close New tab"]')).not.toBeNull();
  });

  it('closes the files tab from its tree toolbar and returns to another open tab', async () => {
    await render('/chat/ordinary');
    let home = '';
    await act(async () => {
      const s = useRightWorkspaceStore.getState();
      home = s.openTools('ordinary');
      s.openTools('ordinary');
      s.openFiles('ordinary');
    });
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Close file tree"]')!.click());
    expect(useRightWorkspaceStore.getState().panes.ordinary).toMatchObject({ open: true, activeId: home, tabs: [{ id: home, kind: 'home' }] });
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Close New tab"]')!.click());
    expect(container.querySelector('[data-right-workspace]')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('reserves modal space only for a visible docked workspace at its rendered width', async () => {
    const onDockedWidthChange = vi.fn();
    useRightWorkspaceStore.getState().openFiles('ordinary');
    useRightWorkspaceStore.getState().setWidth(900);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1200);
    const renderWorkspace = async (enabled: boolean) => {
      await act(async () => root.render(
        <MemoryRouter><RightWorkspace scope="ordinary" enabled={enabled} onDockedWidthChange={onDockedWidthChange} /></MemoryRouter>,
      ));
    };
    await renderWorkspace(false);
    expect(onDockedWidthChange).toHaveBeenLastCalledWith(0);
    await renderWorkspace(true);
    expect(onDockedWidthChange).toHaveBeenLastCalledWith(820);
    expect(container.querySelector<HTMLElement>('[data-right-workspace]')?.style.width).toBe('820px');
    await act(async () => useRightWorkspaceStore.getState().setWidth(500));
    expect(onDockedWidthChange).toHaveBeenLastCalledWith(500);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Expand workspace"]')!.click());
    expect(onDockedWidthChange).toHaveBeenLastCalledWith(0);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Restore workspace"]')!.click());
    expect(onDockedWidthChange).toHaveBeenLastCalledWith(500);
    await act(async () => useRightWorkspaceStore.getState().setOpen(false, 'ordinary'));
    expect(onDockedWidthChange).toHaveBeenLastCalledWith(0);
    await act(async () => useRightWorkspaceStore.getState().setOpen(true, 'ordinary'));
    expect(onDockedWidthChange).toHaveBeenLastCalledWith(500);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(700);
    await act(async () => window.dispatchEvent(new Event('resize')));
    expect(onDockedWidthChange).toHaveBeenLastCalledWith(0);
  });

  it('creates a side chat from selected task text using the real parent conversation', async () => {
    await render();
    const message = container.querySelector('[data-chat-message-index]')!;
    const range = document.createRange();
    range.selectNodeContents(message);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    Object.defineProperty(range, 'getBoundingClientRect', { value: () => ({ left: 40, top: 80, bottom: 100, width: 120, height: 20 }) });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callback(0); return 1; });
    await act(async () => document.dispatchEvent(new Event('pointerup')));
    const group = container.querySelector('[role="group"]');
    expect(group).not.toBeNull();
    await act(async () => group!.querySelectorAll('button')[1].click());
    expect(useSideChatStore.getState().pendingCreate).toMatchObject({
      parentConversationId: 'conversation-task-1',
      selections: [{ text: message.textContent }],
    });
    expect(container.querySelector('#app-side-chat-panel')?.getAttribute('data-parent')).toBe('conversation-task-1');
  });
});

function OrdinaryChat() {
  return <>
    <input data-main-draft aria-label="Main draft" />
    <ChatPageHeaderRegistration conversationId="ordinary" hasMessages chatHeadline="Chat"
      chatAgents={[]} showChatAgentSelector={false} chatAgentId="main"
      onChatAgentChange={() => {}} chatAgentDisabled />
    <Link to="/chat/new">New chat</Link><Link to="/tasks">Tasks</Link>
  </>;
}
