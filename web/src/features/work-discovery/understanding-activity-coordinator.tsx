import { useEffect } from 'react';

import { fetchWorkDiscoveryOnboarding, fetchWorkDiscoveryRun } from './api';
import { useUnderstandingActivityStore } from './understanding-activity-store';

const ACTIVE_STATUSES = new Set(['queued', 'probing', 'analyzing']);
const EVENT_NAMES = [
  'work-discovery-progress',
  'work-discovery-completed',
  'work-discovery-failed',
  'work-discovery-canceled',
] as const;

export function UnderstandingActivityCoordinator() {
  const runId = useUnderstandingActivityStore((state) => state.directoryRun?.id);
  const runStatus = useUnderstandingActivityStore((state) => state.directoryRun?.status);

  useEffect(() => {
    let cancelled = false;
    void fetchWorkDiscoveryOnboarding()
      .then(async ({ state }) => {
        if (state.status !== 'in_progress' || !state.activeRunId) return;
        const run = await fetchWorkDiscoveryRun(state.activeRunId);
        if (!cancelled) useUnderstandingActivityStore.getState().updateDirectoryRun(run);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!runId || !runStatus || !ACTIVE_STATUSES.has(runStatus)) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const run = await fetchWorkDiscoveryRun(runId);
        if (!cancelled) useUnderstandingActivityStore.getState().updateDirectoryRun(run);
      } catch {
        // Realtime or the next poll can recover from a transient gateway restart.
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1_200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [runId, runStatus]);

  useEffect(() => {
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ runId?: string }>).detail;
      const nextRunId = detail?.runId;
      if (!nextRunId) return;
      void fetchWorkDiscoveryRun(nextRunId)
        .then((run) => useUnderstandingActivityStore.getState().updateDirectoryRun(run))
        .catch(() => undefined);
    };
    for (const name of EVENT_NAMES) window.addEventListener(name, onEvent);
    return () => {
      for (const name of EVENT_NAMES) window.removeEventListener(name, onEvent);
    };
  }, []);

  return null;
}
