// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, expect, it, vi } from 'vitest';

import type { Project } from '@/features/projects/api';
import { allProjectOptions } from '@/features/sessions/session-filter-projects';

import { SidebarTaskList } from '../sidebar-task-list';
import { fetchSidebarChatList, listSessions } from '@/features/sessions/session-api';
import { automationApi, type AutomationRun } from '@/features/automations/automation-api';
import type { SessionMetadata } from '@/features/sessions/session.types';

vi.mock('@/features/automations/automation-api', () => ({ automationApi: { runs: vi.fn(), getRun: vi.fn() } }));

vi.mock('@/stores/gateway-store', () => ({ useGatewayStore: (select: (state: unknown) => unknown) => select({ baseUrl: 'http://test', conversationId: 'token' }) }));
vi.mock('@/stores/locale-store', () => ({ useLocaleStore: (select: (state: unknown) => unknown) => select({ language: 'en' }) }));
vi.mock('@/features/chat/agent-selection/chat-agents-api', () => ({ fetchChatAgents: async () => ({ items: [], defaultId: 'main' }) }));
vi.mock('@/features/chat/session/use-sidebar-session-agent-run', () => ({ useSidebarSessionAgentRun: () => false }));
vi.mock('@/features/fs/working-directory-picker-modal', () => ({ WorkingDirectoryPickerModal: () => null }));
vi.mock('@/features/sessions/session-filter-projects', () => ({ allProjectOptions: vi.fn(async () => []) }));
vi.mock('@/features/sessions/session-api', () => ({
  fetchSidebarChatList: vi.fn(), listSessions: vi.fn(), deleteSession: vi.fn(), pinSession: vi.fn(),
  renameSession: vi.fn(), saveSidebarLayout: vi.fn(), unpinSession: vi.fn(),
}));

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); localStorage.clear(); vi.clearAllMocks(); });

it('marks configuration chats with an icon in the existing list without a duplicate group', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const session = (key: string, name: string) => ({ key, name, sourceChannel: 'webchat', updatedAt: new Date().toISOString(), status: 'active', customData: {} }) as SessionMetadata;
  const chat = session('chat', 'Ordinary chat');
  const config = { ...session('config', 'Daily news setup'), customData: { automationSetup: { automationId: 'news' } } };
  const draft = { ...session('draft', 'Draft automation'), customData: { automationSetup: {} } };
  const run = { ...session('run', 'Automatic execution'), sourceChannel: 'automation' };
  // Mixed responses also cover cached sidebar data from a gateway predating the filter.
  vi.mocked(fetchSidebarChatList).mockResolvedValue({ ok: true, projects: { items: [], total: 0, limit: 12, offset: 0, hasMore: false },
    inbox: { items: [chat, config, draft, run], total: 4, limit: 20, offset: 0, hasMore: false }, pinned: [], layouts: {}, childrenByConversationId: {} });
  vi.mocked(listSessions).mockResolvedValue({ items: [chat, config, draft, run], total: 4, limit: 20, offset: 0, hasMore: false });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0 }}>
    <MemoryRouter><SidebarTaskList /></MemoryRouter>
  </SWRConfig>));
  expect(container.querySelector('section[aria-label="Automations"]')).toBeNull();
  const chats = container.querySelector('section[aria-label="Today"]')!;
  expect(chats.textContent).toContain('Ordinary chat');
  expect(chats.textContent).toContain('Daily news setup');
  expect(chats.textContent).toContain('Draft automation');
  expect(chats.textContent).not.toContain('Automatic execution');
  expect(container.querySelectorAll('a[href="/chat/config"]')).toHaveLength(1);
  expect(chats.querySelectorAll('[title="Automation setup"] svg')).toHaveLength(2);
  expect(listSessions).toHaveBeenCalledWith(expect.objectContaining({ excludeAutomationRuns: true, rootConversationsOnly: true }));
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

it('expands executions below the configuration chat and opens the selected run', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const timestamp = new Date().toISOString();
  const config: SessionMetadata = { key: 'config', name: 'Daily news', agentId: 'main', sourceChannel: 'webchat',
    sourceChatId: 'automation-configuration', status: 'active', tags: [], createdAt: timestamp, updatedAt: timestamp,
    lastAccessedAt: timestamp, messageCount: 0, estimatedTokens: 0, compactedCount: 0,
    projectId: 'project-a', customData: { automationSetup: { automationId: 'news' } } };
  const execution: AutomationRun = { id: 'execution-1', automationId: 'news', automationName: 'Daily news',
    status: 'failed', createdAtMs: Date.now(), manual: false, triggerSnapshot: { kind: 'manual' },
    actionSnapshot: { kind: 'agent', instruction: 'News' }, conversationId: 'execution-chat' };
  vi.mocked(fetchSidebarChatList).mockResolvedValue({ ok: true,
    projects: { items: [], total: 0, limit: 12, offset: 0, hasMore: false },
    inbox: { items: [config], total: 1, limit: 20, offset: 0, hasMore: false }, pinned: [], layouts: {}, childrenByConversationId: {} });
  vi.mocked(listSessions).mockResolvedValue({ items: [config], total: 1, limit: 20, offset: 0, hasMore: false });
  vi.mocked(automationApi.runs).mockResolvedValue({ runs: [execution], hasMore: false });
  vi.mocked(automationApi.getRun).mockResolvedValue({ run: execution });
  const onNavigate = vi.fn();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0 }}>
    <MemoryRouter><SidebarTaskList onNavigate={onNavigate} /><LocationProbe /></MemoryRouter>
  </SWRConfig>));
  expect(automationApi.runs).not.toHaveBeenCalled();
  expect(container.querySelectorAll('a[href="/chat/config"]')).toHaveLength(1);
  expect(container.querySelector('[aria-label="Execution history"]')).toBeNull();
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Expand execution history"]')!.click());
  expect(automationApi.runs).toHaveBeenCalledWith(20, 'news', { projectId: 'project-a', cursor: undefined });
  const history = container.querySelector('[aria-label="Execution history"]')!;
  expect(history.textContent).toContain('failed');
  await act(async () => history.querySelector<HTMLAnchorElement>('a')!.click());
  expect(container.querySelector('[data-testid="location"]')!.textContent)
    .toBe('/automations?automation=news&view=execution&run=execution-1&projectId=project-a');
  expect(onNavigate).toHaveBeenCalledOnce();
  expect(container.querySelector('[aria-current="true"]')).not.toBeNull();
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Collapse execution history"]')!.click());
  expect(container.querySelector('[aria-label="Execution history"]')).toBeNull();
});


it('keeps the recent timeline independent of project previews and lists pinned chats once in each view', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const older = new Date(today);
  older.setDate(older.getDate() - 2);
  const session = (key: string, name: string, date: Date, projectId?: string) => ({
    key, name, updatedAt: date.toISOString(), status: 'active', sourceChannel: 'webchat', projectId, customData: {},
  }) as SessionMetadata;
  const recentProjectChat = session('latest', 'Latest project chat', today, 'another-project');
  const standalone = session('standalone', 'Standalone chat', yesterday);
  const earlier = session('earlier', 'Earlier chat', older);
  const pinned = { ...session('pinned', 'Pinned project chat', yesterday, 'first-project'), status: 'pinned' } as SessionMetadata;
  const project = { id: 'first-project', name: 'First project' } as Project;
  vi.mocked(allProjectOptions).mockResolvedValue([{ id: 'another-project', name: 'Another project' } as Project]);
  vi.mocked(fetchSidebarChatList).mockResolvedValue({
    ok: true,
    projects: { items: [{ project, sessions: [pinned], sessionTotal: 1, sessionHasMore: false }], total: 1, limit: 12, offset: 0, hasMore: false },
    inbox: { items: [standalone], total: 1, limit: 20, offset: 0, hasMore: false },
    pinned: [pinned], layouts: {}, childrenByConversationId: {},
  });
  vi.mocked(listSessions).mockImplementation(async (query) => query?.offset === 0
    ? { items: [standalone, pinned, recentProjectChat], total: 4, limit: 20, offset: 0, hasMore: true }
    : { items: [earlier], total: 4, limit: 20, offset: 20, hasMore: false });

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0 }}>
    <MemoryRouter initialEntries={['/chat/latest']}><SidebarTaskList /></MemoryRouter>
  </SWRConfig>));

  const click = async (label: string) => {
    const control = [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === label);
    expect(control).toBeDefined();
    await act(async () => control!.click());
  };
  expect(container.querySelector('button[aria-pressed="true"][title="Recent"]')).not.toBeNull();
  expect(container.querySelector('section[aria-label="Today"] a[aria-current="page"]')?.textContent).toContain('Another project');
  expect(container.querySelector('section[aria-label="Yesterday"]')?.textContent).toContain('Standalone chat');
  expect(container.querySelectorAll('a[href="/chat/pinned"]')).toHaveLength(1);
  expect(container.querySelector('section[aria-label="Pinned"]')?.textContent).toContain('First project');
  expect(container.querySelector('input[type="search"]')).toBeNull();

  await click('Load more');
  expect(listSessions).toHaveBeenCalledWith(expect.objectContaining({ offset: 20 }));
  expect(container.querySelector('a[href="/chat/earlier"]')).toBeNull();
  await click('Older');
  expect(container.querySelector('a[href="/chat/earlier"]')).not.toBeNull();

  await click('Projects');
  const createProject = container.querySelector('button[aria-label="Create project"]');
  expect(createProject?.parentElement?.querySelector('h2')?.textContent).toBe('Projects');
  expect(createProject?.closest('[aria-label="Conversation view"]')).toBeNull();
  expect(container.querySelector('section[aria-label="First project"]')).not.toBeNull();
  expect(container.querySelector('a[href="/chat/standalone"]')).not.toBeNull();
  expect(container.querySelectorAll('a[href="/chat/pinned"]')).toHaveLength(1);

  await click('Recent');
  expect(container.querySelector('button[aria-label="Create project"]')).toBeNull();
  expect(container.querySelector('a[href="/chat/earlier"]')).not.toBeNull();
});
