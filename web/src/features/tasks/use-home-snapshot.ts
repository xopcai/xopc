import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchHome, type HomeResponse } from './home-api';

export function useHomeSnapshot(language: 'en' | 'zh', navigationKey: string) {
  const [home, setHome] = useState<HomeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoadError(null);
    try {
      const snapshot = await fetchHome(language);
      if (version === requestVersion.current) setHome(snapshot);
    } catch (error) {
      if (version === requestVersion.current) {
        setLoadError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [language]);

  useEffect(() => {
    // Task details are an overlay: returning to the workbench does not remount it.
    void load();
    return () => { requestVersion.current++; };
  }, [load, navigationKey]);

  useEffect(() => {
    let refreshTimer: number | undefined;
    let refreshAt = Infinity;
    const scheduleRefresh = (delayMs: number) => {
      const nextRefreshAt = Date.now() + delayMs;
      if (nextRefreshAt >= refreshAt) return;
      window.clearTimeout(refreshTimer);
      refreshAt = nextRefreshAt;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined;
        refreshAt = Infinity;
        void load();
      }, delayMs);
    };
    const refreshSoon = () => scheduleRefresh(100);
    const refreshAfterSessionSettles = () => scheduleRefresh(750);
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshSoon();
    };
    const immediateEvents = [
      'task-changed-v2', 'task-updated',
      'session-created', 'agent-run-started', 'agent-run-ended',
      'automation-run-completed', 'workflow-run-updated', 'workflow-run-error',
      'home-advisor-updated', 'gateway-realtime-connected', 'realtime-gap', 'focus',
    ];
    const noisySessionEvents = ['session-updated', 'session-transcript-updated'];
    immediateEvents.forEach((name) => window.addEventListener(name, refreshSoon));
    noisySessionEvents.forEach((name) => window.addEventListener(name, refreshAfterSessionSettles));
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      immediateEvents.forEach((name) => window.removeEventListener(name, refreshSoon));
      noisySessionEvents.forEach((name) => window.removeEventListener(name, refreshAfterSessionSettles));
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.clearTimeout(refreshTimer);
    };
  }, [load]);

  return { home, loading, loadError, setLoadError, load };
}
