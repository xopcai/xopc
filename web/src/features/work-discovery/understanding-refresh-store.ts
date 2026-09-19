import { create } from 'zustand';
import { mutate } from 'swr';

import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type UnderstandingRefreshSource = {
  id: string; grantId: string; adapterId: string; displayName: string;
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'canceled';
  startedAt: number; completedAt?: number; itemsSeen: number; errorMessage?: string;
  metadata: { phase?: string; added?: number; updated?: number };
};
export type UnderstandingRefreshBatch = {
  id: string; status: 'running' | 'completed' | 'partial' | 'failed';
  sources: UnderstandingRefreshSource[]; createdAt: number;
};

const active = (run: UnderstandingRefreshSource) => run.status === 'queued' || run.status === 'running';
const collecting = new Set<string>();
let polling: Promise<void> | undefined;

export const useUnderstandingRefreshStore = create<{
  sources: UnderstandingRefreshSource[];
  starting: boolean;
  error?: string;
  start(sourceId?: string): Promise<void>;
  poll(): Promise<void>;
}>((set, get) => ({
  sources: [], starting: false,
  async start(sourceId) {
    if (get().starting) return;
    set({ starting: true, error: undefined });
    try {
      await fetchJson<{ batch: UnderstandingRefreshBatch }>(apiUrl('/api/user-model/refresh'), {
        method: 'POST', body: JSON.stringify(sourceId ? { sourceIds: [sourceId] } : {}),
      });
      await get().poll();
    } catch (error) { set({ error: error instanceof Error ? error.message : String(error) }); }
    finally { set({ starting: false }); }
  },
  poll() {
    if (polling) return polling;
    polling = (async () => {
      try {
        const snapshot = await fetchJson<{ sources: UnderstandingRefreshSource[] }>(apiUrl('/api/user-model/refresh'));
        const prior = new Map(get().sources.map((run) => [run.id, run.status]));
        set({ sources: snapshot.sources, error: undefined });
        if (snapshot.sources.some((run) => !active(run) && prior.get(run.id) !== run.status)) {
          void mutate('/api/user-model');
        }
        for (const run of snapshot.sources) {
          if (active(run) && run.metadata.phase === 'waiting_desktop') void collect(run);
        }
      } catch (error) { set({ error: error instanceof Error ? error.message : String(error) }); }
    })().finally(() => { polling = undefined; });
    return polling;
  },
}));

async function collect(run: UnderstandingRefreshSource): Promise<void> {
  const collectSource = window.electronAPI?.understandingSources?.collect;
  if (!collectSource || collecting.size > 0) return;
  collecting.add(run.id);
  try {
    let payload: { items: unknown[]; error?: string };
    try {
      const result = (await collectSource([run.adapterId])).find((item) => item.sourceId === run.adapterId);
      payload = result?.status === 'completed' ? { items: result.items }
        : { items: [], error: result?.error ?? 'Source collection failed. Check its permissions and retry.' };
    } catch {
      payload = { items: [], error: 'Source collection was interrupted. Please retry.' };
    }
    await fetchJson(apiUrl(`/api/user-model/refresh/sources/${encodeURIComponent(run.id)}/collection`), {
      method: 'POST', body: JSON.stringify(payload),
    });
    await useUnderstandingRefreshStore.getState().poll();
  } catch (error) {
    useUnderstandingRefreshStore.setState({ error: error instanceof Error ? error.message : String(error) });
  } finally { collecting.delete(run.id); }
}
