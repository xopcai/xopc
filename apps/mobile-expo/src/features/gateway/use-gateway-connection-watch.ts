import { useEffect } from 'react';

import { useGatewayStore } from '../../stores/gateway-store';

import { syncGatewayAfterConnectivityChange } from './gateway-connection-sync';
import { subscribeNetworkChange } from './network-info';
import { getSharedGatewayRealtimeClient } from './use-gateway-realtime';
import {
  runProbeRound,
  subscribeProbeTask,
} from './probe-coordinator';

/**
 * Drive route refresh + sse reconnect off the shared probe coordinator.
 * Replaces the old foreground/interval/network-change-loops that each
 * triggered their own /health probe.
 */
export function useGatewayConnectionWatch(enabled: boolean): void {
  const baseUrl = useGatewayStore((s) => s.baseUrl);
  const lanUrl = useGatewayStore((s) => s.lanUrl);

  useEffect(() => {
    if (!enabled || !baseUrl) return;

    let prevUrl = useGatewayStore.getState().activeBaseUrl;

    void runProbeRound('initial');

    const unsubProbe = subscribeProbeTask((task) => {
      const winnerUrl = task.result.url;
      if (
        winnerUrl &&
        (task.result.winner === 'lan' || task.result.winner === 'tunnel') &&
        winnerUrl !== prevUrl
      ) {
        useGatewayStore.setState({ activeBaseUrl: winnerUrl });
        if (prevUrl) syncGatewayAfterConnectivityChange({ immediate: true });
        prevUrl = winnerUrl;
      }
    });

    let lastSeenNetKey = '';
    const unsubNetwork = subscribeNetworkChange((snap) => {
      if (!lastSeenNetKey) {
        lastSeenNetKey = snap.key;
        return;
      }
      if (snap.key === lastSeenNetKey) return;
      lastSeenNetKey = snap.key;
      if (!snap.online) {
        getSharedGatewayRealtimeClient()?.disconnect();
        return;
      }
      const urlBeforeProbe = useGatewayStore.getState().activeBaseUrl;
      void runProbeRound('network-change', { force: true }).then(() => {
        if (useGatewayStore.getState().activeBaseUrl === urlBeforeProbe) {
          syncGatewayAfterConnectivityChange({ immediate: true });
        }
      });
    });

    return () => {
      unsubProbe();
      unsubNetwork();
    };
  }, [enabled, baseUrl, lanUrl]);
}

/** @internal test helper */
export function resetGatewayConnectionWatchStateForTests(): void {
  /* coordinator owns its state now */
}
