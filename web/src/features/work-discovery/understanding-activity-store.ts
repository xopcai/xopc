import { create } from 'zustand';

import type { ElectronUnderstandingSourceCollectionResult } from '@/types/electron';
import { updateUnderstanding, updateUserFocus, type UserFocus } from '@/features/user-context/user-context-api';

import {
  fetchWorkDiscoveryRun,
  importUnderstandingSources,
  reviewUnderstandingSourceProfile,
  type WorkDiscoveryProfileCandidate,
  type WorkDiscoveryRun,
  type WorkUnderstandingThread,
} from './api';

type ActivityStatus = 'idle' | 'running' | 'review_ready' | 'completed' | 'partial';
type SourceStatus = 'idle' | 'running' | 'completed' | 'partial' | 'denied' | 'failed' | 'skipped';

type UnderstandingActivityState = {
  status: ActivityStatus;
  drawerOpen: boolean;
  directoryStatus: SourceStatus;
  directoryRun: WorkDiscoveryRun | null;
  sources: Record<string, SourceStatus>;
  itemCounts: Record<string, number>;
  memories: WorkDiscoveryProfileCandidate[];
  threads: WorkUnderstandingThread[];
  focuses: UserFocus[];
  error?: string;
  setDrawerOpen: (open: boolean) => void;
  finish: () => void;
  updateDirectoryRun: (run: WorkDiscoveryRun) => void;
  collectSources: (workDiscoveryRunId: string | undefined, selectedSources: string[]) => Promise<void>;
  reviewMemory: (understandingId: string, accepted: boolean, statement?: string) => Promise<void>;
  reviewFocus: (focusId: string, accepted: boolean) => Promise<void>;
};

function selectedMap(sourceIds: string[], status: SourceStatus): Record<string, SourceStatus> {
  return Object.fromEntries(sourceIds.map((sourceId) => [sourceId, status]));
}

function sourceMap(results: ElectronUnderstandingSourceCollectionResult[], selectedSources: string[]): Record<string, SourceStatus> {
  const next = selectedMap(selectedSources, 'running');
  for (const result of results) next[result.sourceId] = result.status;
  return next;
}

async function waitForDirectoryUnderstanding(runId?: string): Promise<void> {
  if (!runId) return;
  const deadline = Date.now() + 75_000;
  while (Date.now() < deadline) {
    try {
      const run = await fetchWorkDiscoveryRun(runId);
      useUnderstandingActivityStore.getState().updateDirectoryRun(run);
      if (run.status === 'completed' || run.status === 'failed' || run.status === 'canceled') return;
    } catch {
      // Realtime or the next poll can recover after a transient gateway restart.
    }
    await new Promise((resolve) => window.setTimeout(resolve, 800));
  }
}

const reset = {
  status: 'idle' as const,
  drawerOpen: false,
  directoryStatus: 'idle' as const,
  directoryRun: null,
  sources: {},
  itemCounts: {},
  memories: [],
  threads: [],
  focuses: [],
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
      ? 'completed' : run.status === 'failed' || run.status === 'canceled' ? 'failed' : 'running';
    const sourcesDone = Object.values(get().sources).every((status) => status !== 'running' && status !== 'idle');
    const sourceFailed = Object.values(get().sources).some((status) => status === 'denied' || status === 'failed' || status === 'partial');
    const hasPendingMemory = get().memories.some((memory) => memory.status === 'pending');
    const hasPendingFocus = get().focuses.some((focus) => focus.status === 'candidate');
    set({
      directoryStatus,
      directoryRun: run,
      status: directoryStatus === 'completed' && sourcesDone
        ? !run.feedback?.recognitionDecision || hasPendingMemory || hasPendingFocus
          ? 'review_ready'
          : sourceFailed ? 'partial' : 'completed'
        : directoryStatus === 'failed' && sourcesDone ? 'partial' : 'running',
    });
  },
  collectSources: async (workDiscoveryRunId, selectedSources) => {
    const collect = window.electronAPI?.understandingSources?.collect;
    if (!collect || !selectedSources.length) return;
    set({
      status: 'running',
      sources: selectedMap(selectedSources, 'running'),
      itemCounts: Object.fromEntries(selectedSources.map((sourceId) => [sourceId, 0])),
      memories: [], threads: [], focuses: [], error: undefined,
    });
    try {
      const results = await collect(selectedSources);
      const sources = sourceMap(results, selectedSources);
      const itemCounts = Object.fromEntries(results.map((result) => [result.sourceId, result.items.length]));
      // Collection and model analysis are separate phases. Preserve successful scans if the
      // downstream analysis request fails so the UI does not misreport every source as failed.
      set({ sources, itemCounts });
      const items = results.flatMap((result) => result.status === 'completed' ? result.items : []);
      const sourceCheckpoints = Object.fromEntries(results.flatMap((result) => result.checkpoint
        ? [[result.sourceId, result.checkpoint] as const] : []));
      if (items.length) await waitForDirectoryUnderstanding(workDiscoveryRunId);
      const understanding = items.length
        ? await importUnderstandingSources(items, workDiscoveryRunId, sourceCheckpoints)
        : { profileCandidates: [], workThreads: [], focuses: [], sourceStatuses: [] };
      for (const sourceStatus of understanding.sourceStatuses) {
        sources[sourceStatus.sourceId] = sourceStatus.status;
      }
      const memories = understanding.profileCandidates;
      const focuses = understanding.focuses;
      const hasFailure = Object.values(sources).some((status) => status === 'denied' || status === 'failed' || status === 'partial');
      const analysisErrors = understanding.sourceStatuses.flatMap((item) => item.error ? [item.error] : []);
      const directoryDone = !workDiscoveryRunId || get().directoryStatus === 'completed';
      set({
        sources, itemCounts, memories, threads: understanding.workThreads, focuses,
        ...(analysisErrors.length ? { error: analysisErrors.join('; ') } : {}),
        status: !directoryDone ? 'running'
          : memories.some((memory) => memory.status === 'pending') || focuses.some((focus) => focus.status === 'candidate') ? 'review_ready'
            : hasFailure ? 'partial' : 'completed',
      });
    } catch (error) {
      set((state) => ({
        status: 'partial',
        sources: Object.fromEntries(Object.entries(state.sources).map(([source, status]) => (
          [source, status === 'running' ? 'failed' : status]
        ))),
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  },
  reviewMemory: async (understandingId, accepted, statement) => {
    try {
      if (statement) await updateUnderstanding(understandingId, { statement, status: 'active' });
      else await reviewUnderstandingSourceProfile([{ understandingId, status: accepted ? 'accepted' : 'rejected' }]);
      set((state) => {
        const memories = state.memories.map((memory) => memory.understandingId === understandingId
          ? { ...memory, ...(statement ? { statement } : {}), status: statement ? 'edited' as const : accepted ? 'accepted' as const : 'rejected' as const } : memory);
        return {
          memories,
          status: memories.some((memory) => memory.status === 'pending') || state.focuses.some((focus) => focus.status === 'candidate') ? 'review_ready'
            : Object.values(state.sources).some((source) => source === 'denied' || source === 'failed' || source === 'partial') ? 'partial' : 'completed',
          error: undefined,
        };
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },
  reviewFocus: async (focusId, accepted) => {
    try {
      await updateUserFocus(focusId, { status: accepted ? 'active' : 'rejected' });
      set((state) => {
        const focuses = state.focuses.map((focus) => focus.id === focusId
          ? { ...focus, status: accepted ? 'active' as const : 'rejected' as const } : focus);
        const reviewReady = state.memories.some((memory) => memory.status === 'pending')
          || focuses.some((focus) => focus.status === 'candidate');
        return {
          focuses,
          status: reviewReady ? 'review_ready'
            : Object.values(state.sources).some((source) => source === 'denied' || source === 'failed' || source === 'partial') ? 'partial' : 'completed',
          error: undefined,
        };
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },
}));
