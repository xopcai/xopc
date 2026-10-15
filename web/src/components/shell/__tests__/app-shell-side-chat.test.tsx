// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppShell } from '@/components/shell/app-shell';
import { ChatPageHeaderRegistration } from '@/features/chat/chat-page-header-registration';
import { TaskChatPage } from '@/features/chat/task/task-chat-page';
import { fetchTask, type TaskDetail } from '@/features/tasks/home-api';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
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
  SideChatColumn: ({ parentConversationId }: { parentConversationId: string }) => (
    <aside id="app-side-chat-panel" data-parent={parentConversationId} />
  ),
}));
vi.mock('@/features/chat/context/use-session-context', () => ({ useSessionContext: () => ({ mutate: vi.fn() }) }));
vi.mock('@/features/shares/session-share-button', () => ({ SessionShareButton: () => null }));
vi.mock('@/features/voice/realtime/voice-call-provider', () => ({ VoiceCallProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/features/voice/read-aloud-dock', () => ({ ReadAloudDockProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/features/updater/use-update-reminder', () => ({ useUpdateReminder: () => null }));
vi.mock('@/components/shell/workspace-column', () => ({ WorkspaceColumn: () => <aside data-workspace /> }));
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
    const element = [...container.querySelectorAll<HTMLElement>('button, a')]
      .find((node) => node.getAttribute('aria-label') === label || node.textContent === label);
    expect(element, label).toBeDefined();
    await act(async () => element!.click());
  }

  it('opens and collapses the panel using the task conversation, then isolates another task', async () => {
    await render();
    await click('Open side chat');
    expect(container.querySelector('#app-side-chat-panel')?.getAttribute('data-parent')).toBe('conversation-task-1');
    expect(container.querySelector('[aria-expanded="true"]')).not.toBeNull();
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
    <ChatPageHeaderRegistration conversationId="ordinary" hasMessages chatHeadline="Chat"
      chatAgents={[]} showChatAgentSelector={false} chatAgentId="main"
      onChatAgentChange={() => {}} chatAgentDisabled />
    <Link to="/chat/new">New chat</Link><Link to="/tasks">Tasks</Link>
  </>;
}
