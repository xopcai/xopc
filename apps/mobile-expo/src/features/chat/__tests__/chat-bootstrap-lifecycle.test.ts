// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, useEffect, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({ default: { executionEnvironment: 'storeClient' }, ExecutionEnvironment: { StoreClient: 'storeClient' } }));
const environment = vi.hoisted(() => ({ gatewayId: 'a', focused: true, router: {} }));
vi.mock('expo-router', () => ({
  useRouter: () => environment.router,
  useFocusEffect: (callback: () => void | (() => void)) => useEffect(() => environment.focused ? callback() : undefined, [callback, environment.focused]),
}));
vi.mock('../../../lib/navigation', () => ({ openChat: vi.fn() }));
vi.mock('../../../stores/gateway-store', () => ({ useGatewayStore: { getState: () => ({ activeGatewayId: environment.gatewayId }) } }));
vi.mock('../../../query/sessions', () => ({ fetchSessionResumeStatus: vi.fn(), fetchSessionsList: vi.fn() }));
vi.mock('../session-prefetch', () => ({ takeNewChatConversationId: vi.fn() }));

import { fetchSessionResumeStatus, fetchSessionsList, type SessionsPage } from '../../../query/sessions';
import { KEYS, storage } from '../../../storage/mmkv';
import { useChatSelectionStore } from '../chat-selection-store';
import { useChatPageBootstrap, type ChatBootstrapDeps } from '../use-chat-page-bootstrap';
import { takeNewChatConversationId } from '../session-prefetch';
import { openChat } from '../../../lib/navigation';

const { createRoot } = createRequire(import.meta.url)('react-dom/client') as {
  createRoot: (container: HTMLElement) => { render: (node: ReactNode) => void; unmount: () => void };
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const tick = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
const page = (...keys: string[]): SessionsPage => ({
  items: keys.map(key => ({ key, sourceChannel: 'webchat', messageCount: 1, updatedAt: '2026-09-13T00:00:00Z' })),
  total: keys.length, limit: 6, offset: 0, hasMore: false,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

let client: QueryClient;
let root: ReturnType<typeof createRoot>;
let result: ReturnType<typeof useChatPageBootstrap>;
let props: ChatBootstrapDeps;
const renderedKeys: string[] = [];
function Harness() {
  result = useChatPageBootstrap(props);
  renderedKeys.push(result.pendingBootstrapKey);
  return null;
}
async function render(overrides: Partial<ChatBootstrapDeps> = {}) {
  props = { ...props, ...overrides };
  await act(async () => { root.render(createElement(QueryClientProvider, { client }, createElement(Harness))); });
}
async function selected(key: string) {
  await vi.waitFor(async () => { await tick(); expect(result.pendingBootstrapKey).toBe(key); });
}

beforeEach(() => {
  vi.clearAllMocks();
  environment.gatewayId = 'a';
  environment.focused = true;
  useChatSelectionStore.setState({ selections: {} });
  storage.delete(KEYS.mainChatSessionByGateway);
  renderedKeys.length = 0;
  vi.mocked(fetchSessionResumeStatus).mockResolvedValue('available');
  vi.mocked(fetchSessionsList).mockResolvedValue(page('server-latest'));
  vi.mocked(takeNewChatConversationId).mockResolvedValue('created');
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  root = createRoot(document.createElement('div'));
  props = {
    scopeKey: 'a', urlConversationId: '', gatewayReady: true, gatewayOnline: true,
    newSessionSpec: { agentId: 'main', projectId: null },
    messages: { sessions: { bootstrapFailed: 'Retry startup' } } as ChatBootstrapDeps['messages'],
    activeConversationIdRef: { current: '' }, shouldNavigateToRoute: false,
  };
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); });

describe('chat startup lifecycle', () => {
  it('renders the saved chat before any network response and never waits offline', async () => {
    useChatSelectionStore.getState().select('a', 'saved');
    vi.mocked(fetchSessionResumeStatus).mockReturnValue(new Promise(() => {}));
    await render({ gatewayOnline: false });
    expect(renderedKeys[0]).toBe('saved');
    expect(result.waitingForResume).toBe(false);
    expect(fetchSessionsList).not.toHaveBeenCalled();
    expect(fetchSessionResumeStatus).not.toHaveBeenCalled();
    await render({ gatewayOnline: true });
    expect(result.pendingBootstrapKey).toBe('saved');
    expect(fetchSessionResumeStatus).toHaveBeenCalled();
  });

  it('preserves the saved chat on timeout or authentication failures', async () => {
    useChatSelectionStore.getState().select('a', 'saved');
    vi.mocked(fetchSessionResumeStatus).mockRejectedValue(new Error('Network timeout'));
    await render(); await tick();
    expect(result.pendingBootstrapKey).toBe('saved');
    expect(fetchSessionsList).not.toHaveBeenCalled();
    expect(takeNewChatConversationId).not.toHaveBeenCalled();
  });

  it('creates a main conversation independently of recent sessions', async () => {
    client.setQueryData(['sessions', 'recent', 'a'], page('old-cache'));
    await render(); await selected('created');
    expect(fetchSessionsList).not.toHaveBeenCalled();
    expect(takeNewChatConversationId).toHaveBeenCalledOnce();
    expect(renderedKeys).not.toContain('old-cache');
  });

  it('replaces the main conversation only after confirmed deletion', async () => {
    useChatSelectionStore.getState().select('a', 'deleted');
    vi.mocked(fetchSessionResumeStatus).mockImplementation(async key => key === 'deleted' ? 'unavailable' : 'available');
    await render(); await selected('created');
    expect(fetchSessionsList).not.toHaveBeenCalled();
  });

  it('does not let late validation or list results override a manual selection', async () => {
    useChatSelectionStore.getState().select('a', 'saved');
    const validation = deferred<'available' | 'unavailable'>();
    vi.mocked(fetchSessionResumeStatus).mockImplementation(key => key === 'saved' ? validation.promise : Promise.resolve('available'));
    await render();
    await act(async () => result.setPendingBootstrapKey('chosen'));
    await act(async () => validation.resolve('unavailable'));
    await tick();
    expect(result.pendingBootstrapKey).toBe('chosen');
    expect(fetchSessionsList).not.toHaveBeenCalled();
  });

  it('does not override a selection with a late main conversation creation', async () => {
    const request = deferred<string>();
    vi.mocked(takeNewChatConversationId).mockReturnValue(request.promise);
    await render();
    await act(async () => result.setPendingBootstrapKey('chosen'));
    await act(async () => request.resolve('late'));
    await tick();
    expect(result.pendingBootstrapKey).toBe('chosen');
  });

  it('ignores late creation after a new user choice and opens new chats without replacing the main conversation', async () => {
    useChatSelectionStore.getState().select('a', 'saved');
    await render();
    let finish!: (key: string) => boolean;
    await act(async () => { finish = result.beginSessionSelection(); });
    await act(async () => result.setPendingBootstrapKey('chosen'));
    await act(async () => { expect(finish('late-create')).toBe(false); });
    await act(async () => { finish = result.beginSessionSelection(); });
    await act(async () => { expect(finish('new-chat')).toBe(false); });
    expect(JSON.parse(storage.getString(KEYS.mainChatSessionByGateway)!)).toEqual({ a: 'chosen' });
    expect(openChat).toHaveBeenCalledWith(environment.router, 'new-chat');
  });

  it('shows a failed creation and supports an explicit retry', async () => {
    vi.mocked(takeNewChatConversationId).mockRejectedValue(new Error('offline'));
    await render(); await tick();
    expect(result.bootstrapError).toBe('offline');
    vi.mocked(takeNewChatConversationId).mockResolvedValue('created');
    await act(async () => result.retryBootstrapSession());
    await selected('created');
    expect(takeNewChatConversationId).toHaveBeenCalledTimes(2);
  });

  it('keeps gateway selections isolated and ignores an old gateway response', async () => {
    useChatSelectionStore.getState().select('a', 'saved-a');
    useChatSelectionStore.getState().select('b', 'saved-b');
    const validation = deferred<'unavailable'>();
    vi.mocked(fetchSessionResumeStatus).mockImplementation(key => key === 'saved-a' ? validation.promise : Promise.resolve('available'));
    await render();
    environment.gatewayId = 'b';
    renderedKeys.length = 0;
    await render({ scopeKey: 'b' });
    expect(renderedKeys[0]).toBe('saved-b');
    await act(async () => validation.resolve('unavailable'));
    await tick();
    expect(result.pendingBootstrapKey).toBe('saved-b');
    expect(useChatSelectionStore.getState().selections.a.key).toBe('saved-a');
  });

  it('gives explicit routes priority and does not let the covered root navigate', async () => {
    useChatSelectionStore.getState().select('a', 'saved');
    await render({ urlConversationId: 'deep-link', shouldNavigateToRoute: true });
    expect(result.pendingBootstrapKey).toBe('deep-link');
    expect(useChatSelectionStore.getState().selections.a.key).toBe('saved');
    expect(fetchSessionsList).not.toHaveBeenCalled();
    expect(fetchSessionResumeStatus).not.toHaveBeenCalled();
    environment.focused = false;
    await render({ urlConversationId: '' });
    expect(openChat).not.toHaveBeenCalled();
  });

  it('keeps the covered root on its own projection, and returns to the main conversation on focus', async () => {
    useChatSelectionStore.getState().select('a', 'root-chat');
    await render();
    environment.focused = false;
    await render();
    await act(async () => { useChatSelectionStore.getState().select(JSON.stringify(['a', 'detail-chat']), 'detail-chat'); });
    expect(result.pendingBootstrapKey).toBe('root-chat');
    environment.focused = true;
    await render();
    expect(result.pendingBootstrapKey).toBe('root-chat');
  });

  it('rejects a creation completion from before leaving and re-entering the screen', async () => {
    useChatSelectionStore.getState().select('a', 'saved');
    await render();
    let finish!: (key: string) => boolean;
    await act(async () => { finish = result.beginSessionSelection(); });
    environment.focused = false;
    await render();
    environment.focused = true;
    await render();
    await act(async () => { expect(finish('old-create')).toBe(false); });
    expect(result.pendingBootstrapKey).toBe('saved');
  });
});
