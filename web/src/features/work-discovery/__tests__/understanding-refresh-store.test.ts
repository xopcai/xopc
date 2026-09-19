// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchJson, mutate } = vi.hoisted(() => ({ fetchJson: vi.fn(), mutate: vi.fn() }));
vi.mock('@/lib/fetch', () => ({ fetchJson }));
vi.mock('@/lib/url', () => ({ apiUrl: (path: string) => path }));
vi.mock('swr', () => ({ mutate }));
import { useUnderstandingRefreshStore, type UnderstandingRefreshSource } from '../understanding-refresh-store';

const run: UnderstandingRefreshSource = { id: 'run-1', grantId: 'grant-1', adapterId: 'apple-notes', displayName: 'Notes',
  status: 'running', startedAt: 1, itemsSeen: 0, metadata: { phase: 'waiting_desktop' } };

describe('understanding refresh client', () => {
  beforeEach(() => { vi.clearAllMocks(); useUnderstandingRefreshStore.setState({ sources: [], starting: false, error: undefined }); });
  afterEach(() => { delete window.electronAPI; });

  it('restores an active desktop request from the server and submits its collection once', async () => {
    const collect = vi.fn(async () => [{ sourceId: 'apple-notes', status: 'completed', items: [] }]);
    window.electronAPI = { understandingSources: { collect } } as never;
    let submitted = false;
    fetchJson.mockImplementation(async (_url, options) => {
      if (options?.method === 'POST') { submitted = true; return { ok: true }; }
      return { sources: [{ ...run, status: submitted ? 'completed' : 'running' }] };
    });
    await useUnderstandingRefreshStore.getState().poll();
    await vi.waitFor(() => expect(submitted).toBe(true));
    await useUnderstandingRefreshStore.getState().poll();
    expect(collect).toHaveBeenCalledExactlyOnceWith(['apple-notes']);
    expect(useUnderstandingRefreshStore.getState().sources[0].status).toBe('completed');
    expect(mutate).toHaveBeenCalledWith('/api/user-model');
  });

  it('sends a specific grant and suppresses repeated clicks while starting', async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    fetchJson.mockImplementation(async (_url, options) => {
      if (options?.method === 'POST') { await barrier; return { batch: { sources: [run] } }; }
      return { sources: [run] };
    });
    const first = useUnderstandingRefreshStore.getState().start('grant-1');
    await useUnderstandingRefreshStore.getState().start('grant-1');
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(fetchJson.mock.calls[0][1].body).toBe(JSON.stringify({ sourceIds: ['grant-1'] }));
    release(); await first;
    expect(useUnderstandingRefreshStore.getState().starting).toBe(false);
  });
});
