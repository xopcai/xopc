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
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); localStorage.clear(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('marks configuration chats with an icon in the existing list without a duplicate group', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const session = (key: string, name: string) => ({ key, name, sourceChannel: 'webchat', updatedAt: new Date().toISOString(), status: 'active', customData: {} }) as SessionMetadata;
  const chat = session('chat', 'Ordinary chat');
  const config = { ...session('config', 'Daily news setup'), customData: { automationSetup: { automationId: 'news' } } };
  const draft = { ...session('draft', 'Draft automation'), customData: { automationSetup: {} } };
  const run = { ...session('run', 'Automatic execution'), sourceChannel: 'automation' };
  vi.mocked(automationApi.runs).mockResolvedValue({ runs: [], hasMore: false });
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
  expect(chats.querySelector('button[aria-label="Expand execution history"]')).toBeNull();
  expect(listSessions).toHaveBeenCalledWith(expect.objectContaining({ excludeAutomationRuns: true, rootConversationsOnly: true }));
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function mockSidebarScroll(control: HTMLButtonElement) {
  const scrollRegion = container.querySelector<HTMLDivElement>('.app-sidebar-nav-scroll')!;
  Object.defineProperty(scrollRegion, 'clientHeight', { value: 400 });
  vi.spyOn(scrollRegion, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 240, 400));
  const bounds = vi.spyOn(control, 'getBoundingClientRect').mockReturnValue(new DOMRect(16, 380, 80, 24));
  const scrollTo = (scrollTop: number) => {
    scrollRegion.scrollTop = scrollTop;
    scrollRegion.dispatchEvent(new Event('scroll'));
  };
  return { bounds, scrollTo };
}

async function clickSidebarButton(label: string, region: ParentNode = container) {
  const control = [...region.querySelectorAll('button')].find((button) => button.textContent?.trim() === label);
  expect(control).toBeDefined();
  await act(async () => control!.click());
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
  expect(automationApi.runs).toHaveBeenCalledWith(1, 'news', { projectId: 'project-a' });
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


it.each([true, false])('previews four older chats and reveals the rest on demand (first page has enough: %s)', async (hasOlderPreview) => {
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
  const history = Array.from({ length: 7 }, (_, index) => (
    session(`older-${index + 1}`, `Older chat ${index + 1}`, new Date(older.getTime() - index * 60_000))
  ));
  const pinned = { ...session('pinned', 'Pinned project chat', yesterday, 'first-project'), status: 'pinned' } as SessionMetadata;
  const project = { id: 'first-project', name: 'First project' } as Project;
  vi.mocked(allProjectOptions).mockResolvedValue([{ id: 'another-project', name: 'Another project' } as Project]);
  vi.mocked(fetchSidebarChatList).mockResolvedValue({
    ok: true,
    projects: { items: [{ project, sessions: [pinned], sessionTotal: 1, sessionHasMore: false }], total: 1, limit: 12, offset: 0, hasMore: false },
    inbox: { items: [standalone], total: 1, limit: 20, offset: 0, hasMore: false },
    pinned: [pinned], layouts: {}, childrenByConversationId: {},
  });
  const firstPageOlderCount = hasOlderPreview ? 5 : 2;
  const secondPageEnd = hasOlderPreview ? 6 : 4;
  const pages = [
    [standalone, pinned, recentProjectChat, ...history.slice(0, firstPageOlderCount)],
    history.slice(firstPageOlderCount, secondPageEnd),
    history.slice(secondPageEnd),
  ];
  vi.mocked(listSessions).mockImplementation(async (query) => {
    const offset = query?.offset ?? 0;
    return { items: pages[offset / 20] ?? [], total: 41, limit: 20, offset, hasMore: offset < 40 };
  });

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0 }}>
    <MemoryRouter initialEntries={['/chat/latest']}><SidebarTaskList /></MemoryRouter>
  </SWRConfig>));

  const click = clickSidebarButton;
  expect(container.querySelector('button[aria-pressed="true"][title="Recent"]')).not.toBeNull();
  expect(container.querySelector('section[aria-label="Today"] a[aria-current="page"]')?.getAttribute('title')).toContain('Another project');
  expect(container.querySelector('section[aria-label="Yesterday"]')?.textContent).toContain('Standalone chat');
  expect(container.querySelectorAll('a[href="/chat/pinned"]')).toHaveLength(1);
  expect(container.querySelector('section[aria-label="Pinned"] a')?.getAttribute('title')).toContain('First project');
  expect(container.querySelector('input[type="search"]')).toBeNull();

  const olderSection = container.querySelector('section[aria-label="Older"]')!;
  const olderChatLinks = () => [...olderSection.querySelectorAll('a')].map((link) => link.getAttribute('href'));
  const requestsAt = (offset: number) => vi.mocked(listSessions).mock.calls.filter(([query]) => query?.offset === offset);
  expect(olderChatLinks()).toEqual(['/chat/older-1', '/chat/older-2', '/chat/older-3', '/chat/older-4']);
  expect(requestsAt(20)).toHaveLength(hasOlderPreview ? 0 : 1);
  expect(requestsAt(40)).toHaveLength(0);

  if (hasOlderPreview) {
    const control = [...olderSection.querySelectorAll('button')].find((button) => button.textContent === 'View more')!;
    const { scrollTo } = mockSidebarScroll(control);
    await act(async () => scrollTo(300));
    expect(olderChatLinks()).toHaveLength(5);
    expect(requestsAt(20)).toHaveLength(0);
    await click('View more');
    expect(olderChatLinks()).toHaveLength(6);
    expect(requestsAt(40)).toHaveLength(0);
  }
  await click('View more');
  expect(requestsAt(20)).toHaveLength(1);
  expect(requestsAt(40)).toHaveLength(1);
  expect(olderChatLinks()).toEqual(history.map(({ key }) => `/chat/${key}`));
  expect(olderSection.textContent).not.toContain('View more');

  await click('Projects');
  const createProject = container.querySelector('button[aria-label="Create project"]');
  expect(createProject?.parentElement?.querySelector('h2')?.textContent).toBe('Projects');
  expect(createProject?.closest('[aria-label="Conversation view"]')).toBeNull();
  expect(container.querySelector('section[aria-label="First project"]')).not.toBeNull();
  expect(container.querySelector('a[href="/chat/standalone"]')).not.toBeNull();
  expect(container.querySelectorAll('a[href="/chat/pinned"]')).toHaveLength(1);

  await click('Recent');
  expect(container.querySelector('button[aria-label="Create project"]')).toBeNull();
  expect(container.querySelectorAll('section[aria-label="Older"] a')).toHaveLength(4);
  if (hasOlderPreview) {
    await click('View more');
    await click('View more');
  }
  await click('View more');
  expect(requestsAt(40)).toHaveLength(2);
  expect(container.querySelectorAll('section[aria-label="Older"] a')).toHaveLength(history.length);
});

it.each(['project', 'inbox'])('loads more %s chats on downward scroll and keeps them visible during refresh', async (scope) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.setItem('xopc-web-sidebar-session-view', 'projects');
  const project = { id: 'first-project', name: 'First project' } as Project;
  const isProject = scope === 'project';
  const chats = Array.from({ length: 7 }, (_, index) => ({
    key: `chat-${index}`,
    name: `Chat ${index}`,
    sourceChannel: 'webchat',
    status: 'active',
    updatedAt: new Date(Date.now() - index * 60_000).toISOString(),
    projectId: isProject ? project.id : undefined,
    customData: {},
  }) as SessionMetadata);
  const page = { items: chats, total: chats.length, limit: 5000, offset: 0, hasMore: false };
  const preview = { ...page, items: chats.slice(0, 5), hasMore: true };
  const empty = { ...page, total: 0, items: [] };
  vi.mocked(fetchSidebarChatList).mockResolvedValue({
    ok: true,
    projects: {
      items: isProject ? [{ project, sessions: preview.items, sessionTotal: chats.length, sessionHasMore: true }] : [],
      total: Number(isProject), limit: 12, offset: 0, hasMore: false,
    },
    inbox: isProject ? empty : preview,
    pinned: [], layouts: {}, childrenByConversationId: {},
  });
  let resolveFirstLoad!: (value: typeof page) => void;
  let resolveRefresh!: (value: typeof page) => void;
  const firstLoad = new Promise<typeof page>((resolve) => { resolveFirstLoad = resolve; });
  const refresh = new Promise<typeof page>((resolve) => { resolveRefresh = resolve; });
  const fetchExpanded = vi.fn().mockReturnValueOnce(firstLoad).mockReturnValueOnce(refresh);
  vi.mocked(listSessions).mockImplementation(async (query) => {
    if (query?.projectId === project.id || query?.unassigned) return fetchExpanded(query);
    return empty;
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0 }}>
    <MemoryRouter><SidebarTaskList /></MemoryRouter>
  </SWRConfig>));

  const section = container.querySelector(`section[aria-label="${isProject ? project.name : 'Standalone conversations'}"]`)!;
  const control = [...section.querySelectorAll('button')].find((button) => button.textContent === 'Show more')!;
  const { bounds, scrollTo } = mockSidebarScroll(control);
  bounds.mockReturnValue(new DOMRect(16, 600, 80, 24));
  await act(async () => scrollTo(100));
  bounds.mockReturnValue(new DOMRect(16, 380, 80, 24));
  await act(async () => scrollTo(95));
  expect(fetchExpanded).not.toHaveBeenCalled();

  await act(async () => { scrollTo(100); scrollTo(105); });
  expect(fetchExpanded).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(
    isProject ? { projectId: project.id } : { unassigned: true },
  ));
  expect(control.disabled).toBe(true);
  await act(async () => resolveFirstLoad(page));
  expect(section.querySelectorAll('a')).toHaveLength(7);

  await act(async () => window.dispatchEvent(new Event('session-updated')));
  expect(fetchExpanded).toHaveBeenCalledTimes(2);
  expect(section.querySelectorAll('a')).toHaveLength(7);
  expect(section.textContent).toContain('Chat 6');

  await act(async () => resolveRefresh({ ...page, items: [...chats.slice(0, -1), { ...chats[6], name: 'Renamed chat' }] }));
  expect(section.querySelectorAll('a')).toHaveLength(7);
  expect(section.textContent).toContain('Renamed chat');

  const toggleSection = section.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
  await act(async () => toggleSection.click());
  await act(async () => toggleSection.click());
  expect(section.querySelectorAll('a')).toHaveLength(5);

  let resolvePendingLoad!: (value: typeof page) => void;
  fetchExpanded.mockReturnValueOnce(new Promise<typeof page>((resolve) => { resolvePendingLoad = resolve; }));
  await clickSidebarButton('Show more', section);
  await act(async () => toggleSection.click());
  await act(async () => toggleSection.click());
  await act(async () => resolvePendingLoad(page));
  expect(section.querySelectorAll('a')).toHaveLength(5);

  fetchExpanded.mockResolvedValueOnce(page);
  await clickSidebarButton('Show more', section);
  expect(section.querySelectorAll('a')).toHaveLength(7);
  await clickSidebarButton('Recent');
  await clickSidebarButton('Projects');
  const returnedSection = container.querySelector(`section[aria-label="${isProject ? project.name : 'Standalone conversations'}"]`)!;
  expect(returnedSection.querySelectorAll('a')).toHaveLength(5);
});

it('releases extra project pages when leaving the tab, including a page still loading', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.setItem('xopc-web-sidebar-session-view', 'projects');
  const empty = { items: [], total: 0, limit: 20, offset: 0, hasMore: false };
  const sidebarPage = (name: string, offset: number, hasMore: boolean) => ({
    ok: true as const,
    projects: {
      items: [{ project: { id: name, name } as Project, sessions: [], sessionTotal: 0, sessionHasMore: false }],
      total: 2, limit: 12, offset, hasMore,
    },
    inbox: empty, pinned: [], layouts: {}, childrenByConversationId: {},
  });
  const first = sidebarPage('First project', 0, true);
  const second = sidebarPage('Extra project', 12, false);
  let resolvePendingPage!: (value: typeof second) => void;
  const pendingPage = new Promise<typeof second>((resolve) => { resolvePendingPage = resolve; });
  const fetchExtraPage = vi.fn().mockReturnValueOnce(pendingPage).mockResolvedValue(second);
  vi.mocked(fetchSidebarChatList).mockImplementation(async (query) => query?.projectOffset ? fetchExtraPage() : first);
  vi.mocked(listSessions).mockResolvedValue(empty);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0 }}>
    <MemoryRouter><SidebarTaskList /></MemoryRouter>
  </SWRConfig>));

  const extraProject = () => container.querySelector('section[aria-label="Extra project"]');
  const loadMore = async () => {
    const control = container.querySelector<HTMLButtonElement>('button[data-sidebar-load-more]')!;
    await act(async () => control.click());
  };
  const switchTabs = async () => {
    await clickSidebarButton('Recent');
    await clickSidebarButton('Projects');
  };
  await loadMore();
  expect(fetchExtraPage).toHaveBeenCalledTimes(1);
  await switchTabs();
  await act(async () => resolvePendingPage(second));
  expect(extraProject()).toBeNull();

  await loadMore();
  expect(fetchExtraPage).toHaveBeenCalledTimes(2);
  expect(extraProject()).not.toBeNull();
  await switchTabs();
  expect(extraProject()).toBeNull();
  await loadMore();
  expect(fetchExtraPage).toHaveBeenCalledTimes(3);
  expect(extraProject()).not.toBeNull();
});
