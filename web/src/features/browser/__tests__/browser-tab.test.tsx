// @vitest-environment jsdom
import { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useGatewayStore } from '@/stores/gateway-store';
import { useRightWorkspaceStore } from '@/stores/right-workspace-store';
import { BrowserTabView } from '../browser-tab';
import { useEmbeddedBrowserStore } from '../browser-store';

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement | undefined;
afterEach(() => { if (root) act(() => root!.unmount()); container?.remove(); delete window.electronAPI; vi.unstubAllGlobals(); });
it('keeps the idempotent native instance alive through StrictMode effect replay', async () => {
  const api = { ensure: vi.fn(async () => ({ id: 'native', workspaceTabId: 'browser', scope: 'parent', url: '', title: 'Browser', loading: false, canGoBack: false, canGoForward: false })), close: vi.fn(async () => true), present: vi.fn(async () => {}), navigate: vi.fn(async () => {}) };
  window.electronAPI = { browser: api } as any;
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn());
  useGatewayStore.setState({ conversationId: 'public-test-identity' });
  const tab = { id: 'browser', kind: 'browser' as const, title: 'Browser', visitedAt: 1 };
  useRightWorkspaceStore.setState({ panes: { parent: { open: true, tabs: [tab], activeId: tab.id } } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<StrictMode><BrowserTabView tab={tab} scope="parent" active /></StrictMode>));
  expect(api.ensure).toHaveBeenCalledTimes(2);
  expect(api.close).not.toHaveBeenCalled();
  expect(useEmbeddedBrowserStore.getState().tabs.browser.id).toBe('native');
});
