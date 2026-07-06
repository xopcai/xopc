import { useEffect } from 'react';

import { useGatewayStore } from '../../stores/gateway-store';

import { syncGatewayAfterConnectivityChange } from './gateway-connection-sync';
import { subscribeNetworkChange } from './network-info';
import {
  runProbeRound,
  subscribeProbeOutcome,
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

    const unsubProbe = subscribeProbeOutcome((outcome) => {
      const winnerUrl = outcome.result.url;
      if (
        winnerUrl &&
        (outcome.result.winner === 'lan' || outcome.result.winner === 'tunnel') &&
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
      void runProbeRound('network-change', { force: true });
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
