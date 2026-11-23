import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchProactiveDigests,
  fetchProactiveInbox,
  fetchRsiCandidates,
  type ProactiveHubMetrics,
  type ProactiveItem,
  type RsiCapabilityCandidate,
} from './proactive-api';

const EMPTY_METRICS: ProactiveHubMetrics = {
  activeSubscriptions: 0,
  bufferingSignals: 0,
  droppedSignalsTotal: 0,
  inboxPendingCount: 0,
  chatEscalatedCount: 0,
  digestBufferedCount: 0,
  actedCount: 0,
  mutedCount: 0,
};

export function useProactiveInbox() {
  const [items, setItems] = useState<ProactiveItem[]>([]);
  const [digests, setDigests] = useState<ProactiveItem[]>([]);
  const [bufferedCount, setBufferedCount] = useState(0);
  const [rsiCandidates, setRsiCandidates] = useState<RsiCapabilityCandidate[]>([]);
  const [metrics, setMetrics] = useState<ProactiveHubMetrics>(EMPTY_METRICS);
  const [loading, setLoading] = useState(true);
  const versionRef = useRef(0);

  const reload = useCallback(async () => {
    const version = ++versionRef.current;
    try {
      const [inboxData, digestData, candidates] = await Promise.all([
        fetchProactiveInbox(false, 20),
        fetchProactiveDigests(),
        fetchRsiCandidates(20),
      ]);
      if (version !== versionRef.current) return;
      setItems(inboxData.items);
      setMetrics(inboxData.metrics);
      setDigests(digestData.digests);
      setBufferedCount(digestData.bufferedCount);
      setRsiCandidates(candidates);
    } catch {
      // Keep workbench resilient if proactive routes are unmocked or temporarily offline.
      if (version !== versionRef.current) return;
    } finally {
      if (version === versionRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    return () => {
      versionRef.current += 1;
    };
  }, [reload]);

  useEffect(() => {
    let timer: number | undefined;
    const scheduleReload = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void reload();
      }, 120);
    };
    const events = [
      'proactive-inbox-updated',
      'proactive-item-resolved',
      'proactive-digest-created',
      'rsi-candidate-ready',
      'rsi-candidate-adopted',
      'rsi-candidate-rolled-back',
      'gateway-realtime-connected',
      'focus',
    ];
    for (const eventName of events) {
      window.addEventListener(eventName, scheduleReload);
    }
    return () => {
      for (const eventName of events) {
        window.removeEventListener(eventName, scheduleReload);
      }
      window.clearTimeout(timer);
    };
  }, [reload]);

  return {
    items,
    digests,
    bufferedCount,
    rsiCandidates,
    metrics,
    loading,
    reload,
  };
}
