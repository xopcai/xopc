// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';

vi.mock('../../../stores/gateway-store', () => ({
  useGatewayStore: (select: (state: { activeGatewayId: string }) => unknown) => select({ activeGatewayId: 'gateway' }),
}));
vi.mock('../../../query/sessions', () => ({ useGatewayConfigured: () => true, fetchSessionMessagePage: vi.fn() }));
vi.mock('../session-history-prefetch', () => ({ loadSessionHistoryHead: vi.fn(async () => { throw new Error('offline'); }) }));
vi.mock('../session-history-cache', () => ({ readCachedSessionHistoryHead: vi.fn(), writeCachedSessionHistoryHead: vi.fn() }));

import { useSessionHistory } from '../use-session-history';
import { readCachedSessionHistoryHead, writeCachedSessionHistoryHead } from '../session-history-cache';

const { createRoot } = createRequire(import.meta.url)('react-dom/client') as {
  createRoot: (container: HTMLElement) => { render: (node: ReactNode) => void; unmount: () => void };
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('renders cached history on the first frame and retains it after a failed background refresh', async () => {
  const cached = {
    session: { key: 'saved', messages: [{ role: 'user', content: 'Cached message' }] },
    pagination: { total: 1, limit: 50, offset: 0, hasMore: false },
  };
  vi.mocked(readCachedSessionHistoryHead).mockReturnValue(cached);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const root = createRoot(document.createElement('div'));
  const snapshots: Array<ReturnType<typeof useSessionHistory>['sessionHistoryQuery']> = [];
  function Harness() { snapshots.push(useSessionHistory('saved').sessionHistoryQuery); return null; }
  try {
    await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Harness))));
    expect(snapshots[0].data?.pages[0]).toEqual(cached);
    expect(snapshots[0].dataUpdatedAt).toBe(0);
    await vi.waitFor(async () => {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
      expect(snapshots.at(-1)?.isError).toBe(true);
    });
    expect(snapshots.at(-1)?.data?.pages[0]).toEqual(cached);
    expect(writeCachedSessionHistoryHead).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); client.clear(); }
});
