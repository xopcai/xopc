// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Link, MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  clearChatRunPresence,
  markChatRunCompleted,
  markChatRunFailed,
  markChatRunRunning,
  useChatRunPresenceStore,
} from '@/features/chat/session/chat-run-presence-store';
import { getSessionDetail, listSessions } from '@/features/sessions/session-api';
import type { SessionDetail } from '@/features/sessions/session.types';

import { SidebarExpertList } from '../sidebar-expert-list';

vi.mock('@/stores/gateway-store', () => ({
  useGatewayStore: (select: (state: { conversationId: string }) => unknown) => select({ conversationId: 'gateway' }),
}));
vi.mock('@/stores/locale-store', () => ({
  useLocaleStore: (select: (state: { language: string }) => unknown) => select({ language: 'zh' }),
}));
vi.mock('@/features/chat/session/local-session-drafts', () => ({
  readLocalSessionDraft: async () => undefined,
  findLatestLocalExpertDraft: async () => undefined,
}));
vi.mock('@/features/sessions/session-api', () => ({ getSessionDetail: vi.fn(), listSessions: vi.fn() }));

const agents = [{ id: 'coder' }, { id: 'main' }, { id: 'researcher', name: '调研智能体' }];

function TestSidebar() {
  const { conversationId } = useParams();
  return (
    <>
      <SidebarExpertList agents={agents} defaultAgentId="main" activeConversationId={conversationId} />
      <Link to="/chat/research-chat">切换会话</Link>
    </>
  );
}

function session(key: string, agentId: string, fields: Partial<SessionDetail> = {}): SessionDetail {
  const timestamp = '2026-11-18T00:00:00.000Z';
  return {
    key, agentId, sourceChannel: 'webchat', sourceChatId: key, status: 'active', tags: [],
    createdAt: timestamp, updatedAt: timestamp, lastAccessedAt: timestamp,
    messageCount: 0, estimatedTokens: 0, compactedCount: 0, messages: [],
    ...fields,
  };
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  useChatRunPresenceStore.setState({ runs: {} });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

async function renderSidebar() {
  await act(async () => root.render(
    <SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}>
      <MemoryRouter initialEntries={['/chat/code-chat']}>
        <Routes><Route path="/chat/:conversationId" element={<TestSidebar />} /></Routes>
      </MemoryRouter>
    </SWRConfig>,
  ));
}

function replyingRow() {
  return container.querySelector('[title="回复中"]')?.closest('li');
}

it('lists the general assistant first and reopens its latest conversation', async () => {
  const assistantChat = session('assistant-chat', 'main');
  vi.mocked(getSessionDetail).mockImplementation(async (id) => id === assistantChat.key ? assistantChat : session(id, 'coder'));
  vi.mocked(listSessions).mockResolvedValue({ items: [assistantChat], total: 1, limit: 20, offset: 0, hasMore: false });
  await renderSidebar();

  const assistant = container.querySelector<HTMLButtonElement>('ul > li:first-child button');
  expect(assistant?.textContent).toContain('通用智能体');
  expect(container.querySelector('button[aria-label="与 通用智能体 新建对话"]')).not.toBeNull();

  await act(async () => assistant!.click());
  expect(listSessions).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'main' }));
  expect(assistant?.getAttribute('aria-current')).toBe('page');
});

it('keeps the three dots on the replying expert when navigation selects another expert', async () => {
  vi.mocked(getSessionDetail).mockImplementation(async (id) => session(id, id === 'research-chat' ? 'researcher' : 'coder'));
  await renderSidebar();
  expect(replyingRow()).toBeUndefined();

  await act(async () => markChatRunRunning('code-chat'));
  expect(replyingRow()?.querySelectorAll('.expert-reply-dot')).toHaveLength(3);
  expect(replyingRow()?.querySelector('button[aria-current="page"]')).not.toBeNull();
  expect(replyingRow()?.querySelector('button[aria-label="与 编程智能体 新建对话"]')).not.toBeNull();

  await act(async () => container.querySelector<HTMLAnchorElement>('a')!.click());
  expect(container.querySelector('button[aria-current="page"]')?.textContent).toContain('调研智能体');
  expect(replyingRow()?.textContent).toContain('编程智能体');

  await act(async () => markChatRunCompleted('code-chat', true));
  expect(replyingRow()).toBeUndefined();
});

it('clears an expert only after all its chats stop replying and ignores setup and delegated runs', async () => {
  vi.mocked(getSessionDetail).mockImplementation(async (id) => session(id, 'coder', {
    ...(id === 'setup' ? { customData: { agentSetup: true } } : {}),
    ...(id === 'delegated' ? { parentConversationId: 'code-chat' } : {}),
  }));
  await renderSidebar();

  await act(async () => {
    for (const id of ['code-chat', 'another-chat', 'setup', 'delegated']) markChatRunRunning(id);
  });
  expect(container.querySelectorAll('[title="回复中"]')).toHaveLength(1);

  await act(async () => markChatRunFailed('code-chat', false));
  expect(replyingRow()?.textContent).toContain('编程智能体');

  await act(async () => clearChatRunPresence('another-chat'));
  expect(replyingRow()).toBeUndefined();
});

it('exposes hover overlay buttons for new chat and agent settings on every expert', async () => {
  await act(async () => root.render(
    <SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}>
      <MemoryRouter initialEntries={['/chat/code-chat']}>
        <Routes>
          <Route path="/chat/:conversationId" element={<TestSidebar />} />
          <Route path="/capabilities/agents/:agentId" element={<div data-testid="agent-settings-page">Settings</div>} />
        </Routes>
      </MemoryRouter>
    </SWRConfig>,
  ));

  const settingsButton = container.querySelector<HTMLButtonElement>('button[aria-label="设置 编程智能体"]');
  expect(settingsButton).not.toBeNull();
  expect(container.querySelector('.sidebar-hover-row .sidebar-hover-fade')).not.toBeNull();

  await act(async () => settingsButton!.click());
  expect(container.querySelector('[data-testid="agent-settings-page"]')).not.toBeNull();
});
