import { useEffect } from 'react';

import { UnderstandingRefreshCoordinator } from './understanding-refresh-coordinator';
import {
  fetchDeepUnderstandingRun,
  fetchLatestDeepUnderstandingRun,
  fetchWorkDiscoveryOnboarding,
  fetchWorkDiscoveryRun,
  type DeepUnderstandingRun,
} from './api';
import { useUnderstandingActivityStore } from './understanding-activity-store';

const ACTIVE_STATUSES = new Set(['queued', 'probing', 'analyzing']);
const WORK_DISCOVERY_EVENTS = [
  'work-discovery-progress',
  'work-discovery-completed',
  'work-discovery-failed',
  'work-discovery-canceled',
] as const;
const DEEP_UNDERSTANDING_EVENTS = [
  'understanding-progress',
  'understanding-completed',
  'understanding-failed',
  'understanding-canceled',
] as const;

export function UnderstandingActivityCoordinator() {
  const runId = useUnderstandingActivityStore((state) => state.directoryRun?.id);
  const runStatus = useUnderstandingActivityStore((state) => state.directoryRun?.status);
  const deepRunId = useUnderstandingActivityStore((state) => state.deepRun?.id);
  const deepRunStatus = useUnderstandingActivityStore((state) => state.deepRun?.status);

  useEffect(() => {
    let cancelled = false;
    void fetchWorkDiscoveryOnboarding()
      .then(async ({ state }) => {
        if (state.status !== 'in_progress' || !state.activeRunId) return;
        const run = await fetchWorkDiscoveryRun(state.activeRunId);
        if (!cancelled) useUnderstandingActivityStore.getState().updateDirectoryRun(run);
      })
      .catch(() => undefined);
    void fetchLatestDeepUnderstandingRun()
      .then((run) => {
        if (!cancelled && run && run.status === 'running') {
          useUnderstandingActivityStore.getState().updateDeepRun(run);
        }
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
        // Recover on next poll or realtime event.
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
    if (!deepRunId || deepRunStatus !== 'running') return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const run = await fetchDeepUnderstandingRun(deepRunId);
        if (!cancelled) useUnderstandingActivityStore.getState().updateDeepRun(run);
      } catch {
        // Recover on next poll or realtime event.
      }
    };
    const timer = window.setInterval(() => void refresh(), 1_200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [deepRunId, deepRunStatus]);

  useEffect(() => {
    const onWorkEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ runId?: string }>).detail;
      const nextRunId = detail?.runId;
      if (!nextRunId) return;
      void fetchWorkDiscoveryRun(nextRunId)
        .then((run) => useUnderstandingActivityStore.getState().updateDirectoryRun(run))
        .catch(() => undefined);
    };
    const onDeepEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ runId?: string; run?: DeepUnderstandingRun }>).detail;
      if (detail?.run) {
        useUnderstandingActivityStore.getState().updateDeepRun(detail.run);
        return;
      }
      if (!detail?.runId) return;
      void fetchDeepUnderstandingRun(detail.runId)
        .then((run) => useUnderstandingActivityStore.getState().updateDeepRun(run))
        .catch(() => undefined);
    };
    for (const name of WORK_DISCOVERY_EVENTS) window.addEventListener(name, onWorkEvent);
    for (const name of DEEP_UNDERSTANDING_EVENTS) window.addEventListener(name, onDeepEvent);
    return () => {
      for (const name of WORK_DISCOVERY_EVENTS) window.removeEventListener(name, onWorkEvent);
      for (const name of DEEP_UNDERSTANDING_EVENTS) window.removeEventListener(name, onDeepEvent);
    };
  }, []);

  return <UnderstandingRefreshCoordinator />;
}
