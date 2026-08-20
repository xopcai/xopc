import { create } from 'zustand';

import type { ElectronPersonalContextSource, ElectronPersonalContextSourceResult } from '@/types/electron';

import {
  importPersonalContextForWorkDiscovery,
  fetchWorkDiscoveryRun,
  updatePersonalContextWorkDiscoveryProfile,
  type WorkDiscoveryProfileCandidate,
  type WorkDiscoveryRun,
  type WorkUnderstandingThread,
} from './api';

type ActivityStatus = 'idle' | 'running' | 'review_ready' | 'completed' | 'partial';
type SourceStatus = 'idle' | 'running' | 'completed' | 'denied' | 'failed' | 'skipped';

type UnderstandingActivityState = {
  status: ActivityStatus;
  drawerOpen: boolean;
  directoryStatus: SourceStatus;
  sources: Record<ElectronPersonalContextSource, SourceStatus>;
  itemCounts: Record<ElectronPersonalContextSource, number>;
  memories: WorkDiscoveryProfileCandidate[];
  threads: WorkUnderstandingThread[];
  error?: string;
  setDrawerOpen: (open: boolean) => void;
  finish: () => void;
  updateDirectoryRun: (run: WorkDiscoveryRun) => void;
  scanPersonalContext: (runId: string, selectedSources: ElectronPersonalContextSource[]) => Promise<void>;
  reviewMemory: (memoryRecordId: string, accepted: boolean) => Promise<void>;
};

const initialSources = { apple_notes: 'idle', calendar: 'idle', reminders: 'idle' } as const;
const initialCounts = { apple_notes: 0, calendar: 0, reminders: 0 };

function sourceMap(
  results: ElectronPersonalContextSourceResult[],
  selectedSources: ElectronPersonalContextSource[],
): Record<ElectronPersonalContextSource, SourceStatus> {
  const selected = new Set(selectedSources);
  const next: Record<ElectronPersonalContextSource, SourceStatus> = {
    apple_notes: selected.has('apple_notes') ? 'running' : 'skipped',
    calendar: selected.has('calendar') ? 'running' : 'skipped',
    reminders: selected.has('reminders') ? 'running' : 'skipped',
  };
  for (const result of results) next[result.source] = result.status;
  return next;
}

async function waitForDirectoryUnderstanding(runId: string): Promise<void> {
  const deadline = Date.now() + 75_000;
  while (Date.now() < deadline) {
    try {
      const run = await fetchWorkDiscoveryRun(runId);
      useUnderstandingActivityStore.getState().updateDirectoryRun(run);
      if (run.status === 'completed' || run.status === 'failed' || run.status === 'canceled') return;
    } catch {
      // A transient gateway restart should not discard the already-read native context.
    }
    await new Promise((resolve) => window.setTimeout(resolve, 800));
  }
}

export const useUnderstandingActivityStore = create<UnderstandingActivityState>((set, get) => ({
  status: 'idle',
  drawerOpen: false,
  directoryStatus: 'idle',
  sources: { ...initialSources },
  itemCounts: { ...initialCounts },
  memories: [],
  threads: [],
  setDrawerOpen: (drawerOpen) => {
    if (!drawerOpen && get().status === 'completed') {
      set({
        status: 'idle',
        drawerOpen: false,
        directoryStatus: 'idle',
        sources: { ...initialSources },
        itemCounts: { ...initialCounts },
        memories: [],
        threads: [],
        error: undefined,
      });
      return;
    }
    set({ drawerOpen });
  },
  finish: () => set({
    status: 'idle',
    drawerOpen: false,
    directoryStatus: 'idle',
    sources: { ...initialSources },
    itemCounts: { ...initialCounts },
    memories: [],
    threads: [],
    error: undefined,
  }),
  updateDirectoryRun: (run) => {
    const directoryStatus: SourceStatus = run.status === 'completed'
      ? 'completed'
      : run.status === 'failed' || run.status === 'canceled'
        ? 'failed'
        : 'running';
    const personalDone = window.electronAPI?.platform !== 'darwin'
      || Object.values(get().sources).every((status) => status !== 'running' && status !== 'idle');
    const personalFailed = Object.values(get().sources).some((status) => status === 'denied' || status === 'failed');
    const hasPendingMemory = get().memories.some((memory) => memory.status === 'pending');
    set({
      directoryStatus,
      status: directoryStatus === 'completed' && personalDone
        ? hasPendingMemory ? 'review_ready' : personalFailed ? 'partial' : 'completed'
        : directoryStatus === 'failed' && personalDone ? 'partial' : 'running',
    });
  },
  scanPersonalContext: async (runId, selectedSources) => {
    if (window.electronAPI?.platform !== 'darwin') return;
    const scan = window.electronAPI?.personalContext?.scan;
    if (!scan) return;
    const selected = new Set(selectedSources);
    set({
      status: 'running',
      sources: {
        apple_notes: selected.has('apple_notes') ? 'running' : 'skipped',
        calendar: selected.has('calendar') ? 'running' : 'skipped',
        reminders: selected.has('reminders') ? 'running' : 'skipped',
      },
      itemCounts: { ...initialCounts },
      memories: [],
      threads: [],
      error: undefined,
    });
    try {
      const results = await scan(selectedSources);
      const sources = sourceMap(results, selectedSources);
      const itemCounts = { ...initialCounts };
      for (const result of results) itemCounts[result.source] = result.items.length;
      const items = results.flatMap((result) => result.status === 'completed' ? result.items : []);
      if (items.length) await waitForDirectoryUnderstanding(runId);
      const understanding = items.length
        ? await importPersonalContextForWorkDiscovery(items, runId)
        : { profileCandidates: [], workThreads: [] };
      const memories = understanding.profileCandidates;
      const hasFailure = Object.values(sources).some((status) => status === 'denied' || status === 'failed');
      const directoryDone = get().directoryStatus === 'completed';
      set({
        sources,
        itemCounts,
        memories,
        threads: understanding.workThreads,
        status: !directoryDone
          ? 'running'
          : memories.some((memory) => memory.status === 'pending')
          ? 'review_ready'
          : hasFailure ? 'partial' : 'completed',
      });
    } catch (error) {
      set((state) => ({
        status: 'partial',
        sources: Object.fromEntries(Object.entries(state.sources).map(([source, status]) => (
          [source, status === 'running' ? 'failed' : status]
        ))) as Record<ElectronPersonalContextSource, SourceStatus>,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  },
  reviewMemory: async (memoryRecordId, accepted) => {
    try {
      await updatePersonalContextWorkDiscoveryProfile([{
        memoryRecordId,
        status: accepted ? 'accepted' : 'rejected',
      }]);
      set((state) => {
        const memories = state.memories.map((memory) => memory.memoryRecordId === memoryRecordId
          ? { ...memory, status: accepted ? 'accepted' as const : 'rejected' as const }
          : memory);
        return {
          memories,
          status: memories.some((memory) => memory.status === 'pending')
            ? 'review_ready'
            : Object.values(state.sources).some((source) => source === 'denied' || source === 'failed')
              ? 'partial'
              : 'completed',
          error: undefined,
        };
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },
}));
