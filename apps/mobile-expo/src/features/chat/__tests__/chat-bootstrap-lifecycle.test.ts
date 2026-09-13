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
vi.mock('../session-prefetch', () => ({ takeNewChatSessionKey: vi.fn() }));

import { fetchSessionResumeStatus, fetchSessionsList, type SessionsPage } from '../../../query/sessions';
import { KEYS, storage } from '../../../storage/mmkv';
import { useChatSelectionStore } from '../chat-selection-store';
import { useChatPageBootstrap, type ChatBootstrapDeps } from '../use-chat-page-bootstrap';
import { takeNewChatSessionKey } from '../session-prefetch';
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
  storage.delete(KEYS.lastChatSessionByGateway);
  renderedKeys.length = 0;
  vi.mocked(fetchSessionResumeStatus).mockResolvedValue('available');
  vi.mocked(fetchSessionsList).mockResolvedValue(page('server-latest'));
  vi.mocked(takeNewChatSessionKey).mockResolvedValue('created');
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  root = createRoot(document.createElement('div'));
  props = {
    scopeKey: 'a', urlSessionKey: '', gatewayReady: true, gatewayOnline: true,
    newSessionSpec: { agentId: 'main', projectId: null },
    messages: { sessions: { bootstrapFailed: 'Retry startup' } } as ChatBootstrapDeps['messages'],
    activeSessionKeyRef: { current: '' }, shouldNavigateToRoute: false,
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
    expect(takeNewChatSessionKey).not.toHaveBeenCalled();
  });

  it('waits for a real first lookup instead of using old cached recent sessions', async () => {
    const request = deferred<SessionsPage>();
    client.setQueryData(['sessions', 'recent', 'a'], page('old-cache'));
    vi.mocked(fetchSessionsList).mockReturnValue(request.promise);
    await render();
    expect(result.waitingForResume).toBe(true);
    expect(result.pendingBootstrapKey).toBe('');
    await act(async () => request.resolve(page('latest')));
    await selected('latest');
    expect(renderedKeys).not.toContain('old-cache');
  });

  it('falls back only after the saved chat is confirmed unavailable', async () => {
    useChatSelectionStore.getState().select('a', 'deleted');
    vi.mocked(fetchSessionResumeStatus).mockImplementation(async key => key === 'deleted' ? 'unavailable' : 'available');
    vi.mocked(fetchSessionsList).mockResolvedValue(page('deleted', 'fallback'));
    await render(); await selected('fallback');
    expect(useChatSelectionStore.getState().selections.a.key).toBe('fallback');
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

  it('does not override manual selection with a late first lookup', async () => {
    const request = deferred<SessionsPage>();
    vi.mocked(fetchSessionsList).mockReturnValue(request.promise);
    await render();
    await act(async () => result.setPendingBootstrapKey('chosen'));
    await act(async () => request.resolve(page('server-latest')));
    await tick();
    expect(result.pendingBootstrapKey).toBe('chosen');
  });

  it('ignores late creation after a new user choice and persists successful creation immediately', async () => {
    useChatSelectionStore.getState().select('a', 'saved');
    await render();
    let finish!: (key: string) => boolean;
    await act(async () => { finish = result.beginSessionSelection(); });
    await act(async () => result.setPendingBootstrapKey('chosen'));
    await act(async () => { expect(finish('late-create')).toBe(false); });
    await act(async () => { finish = result.beginSessionSelection(); });
    await act(async () => { expect(finish('new-chat')).toBe(true); });
    expect(JSON.parse(storage.getString(KEYS.lastChatSessionByGateway)!)).toEqual({ a: 'new-chat' });
  });

  it('does not create a session on lookup error, and supports retry', async () => {
    vi.mocked(fetchSessionsList).mockRejectedValue(new Error('offline'));
    await render(); await tick();
    expect(takeNewChatSessionKey).not.toHaveBeenCalled();
    expect(result.bootstrapError).toBe('Retry startup');
    vi.mocked(fetchSessionsList).mockResolvedValue(page());
    await act(async () => result.retryBootstrapSession());
    await selected('created');
    expect(takeNewChatSessionKey).toHaveBeenCalledTimes(1);
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
    await render({ urlSessionKey: 'deep-link', shouldNavigateToRoute: true });
    expect(useChatSelectionStore.getState().selections.a.key).toBe('deep-link');
    expect(fetchSessionsList).not.toHaveBeenCalled();
    expect(fetchSessionResumeStatus).not.toHaveBeenCalled();
    environment.focused = false;
    await render({ urlSessionKey: '' });
    expect(openChat).not.toHaveBeenCalled();
  });

  it('keeps the covered root on its own projection, then restores the foreground choice on focus', async () => {
    useChatSelectionStore.getState().select('a', 'root-chat');
    await render();
    environment.focused = false;
    await render();
    await act(async () => { useChatSelectionStore.getState().select('a', 'detail-chat'); });
    expect(result.pendingBootstrapKey).toBe('root-chat');
    environment.focused = true;
    await render();
    expect(result.pendingBootstrapKey).toBe('detail-chat');
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
