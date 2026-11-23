import { create } from 'zustand';

import type {
  DeepUnderstandingRun,
  WorkDiscoveryProfileCandidate,
  WorkDiscoveryRun,
  WorkUnderstandingThread,
  WritingStyleCandidate,
} from './api';

type ActivityStatus = 'idle' | 'running' | 'completed' | 'partial';
type SourceStatus = 'idle' | 'running' | 'completed' | 'partial' | 'denied' | 'failed' | 'skipped';

type UnderstandingActivityState = {
  status: ActivityStatus;
  drawerOpen: boolean;
  directoryStatus: SourceStatus;
  directoryRun: WorkDiscoveryRun | null;
  deepRun: DeepUnderstandingRun | null;
  sources: Record<string, SourceStatus>;
  itemCounts: Record<string, number>;
  memories: WorkDiscoveryProfileCandidate[];
  writingPreferences: WritingStyleCandidate[];
  threads: WorkUnderstandingThread[];
  error?: string;
  setDrawerOpen: (open: boolean) => void;
  finish: () => void;
  updateDirectoryRun: (run: WorkDiscoveryRun) => void;
  updateDeepRun: (run: DeepUnderstandingRun) => void;
};

const reset = {
  status: 'idle' as const,
  drawerOpen: false,
  directoryStatus: 'idle' as const,
  directoryRun: null,
  deepRun: null,
  sources: {},
  itemCounts: {},
  memories: [],
  writingPreferences: [],
  threads: [],
  error: undefined,
};

export const useUnderstandingActivityStore = create<UnderstandingActivityState>((set, get) => ({
  ...reset,
  setDrawerOpen: (drawerOpen) => {
    if (!drawerOpen && get().status === 'completed') set({ ...reset });
    else set({ drawerOpen });
  },
  finish: () => set({ ...reset }),
  updateDirectoryRun: (run) => {
    const directoryStatus: SourceStatus = run.status === 'completed'
      ? 'completed'
      : run.status === 'failed' || run.status === 'canceled'
        ? 'failed'
        : 'running';
    const deepActive = get().deepRun?.status === 'running';
    set({
      directoryStatus,
      directoryRun: run,
      status: directoryStatus === 'running' || deepActive
        ? 'running'
        : directoryStatus === 'failed'
          ? 'partial'
          : 'completed',
    });
  },
  updateDeepRun: (run) => {
    const sources: Record<string, SourceStatus> = {};
    const itemCounts: Record<string, number> = {};
    for (const entry of run.sourceStatuses) {
      sources[entry.sourceId] = entry.status === 'collecting' || entry.status === 'pending'
        ? 'running'
        : entry.status;
      itemCounts[entry.sourceId] = entry.itemCount;
    }
    const hasFailure = Object.values(sources).some((status) => status === 'denied' || status === 'failed' || status === 'partial');
    const nextStatus: ActivityStatus = run.status === 'running'
      ? 'running'
      : run.status === 'completed'
        ? (hasFailure ? 'partial' : 'completed')
        : 'partial';
    set({
      deepRun: run,
      sources,
      itemCounts,
      memories: run.result?.aboutYou ?? [],
      writingPreferences: run.result?.writingPreferences ?? [],
      threads: run.result?.workThreads ?? [],
      error: run.errorMessage,
      status: nextStatus,
    });
  },
}));
