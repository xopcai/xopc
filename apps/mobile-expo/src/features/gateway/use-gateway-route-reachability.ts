/**
 * Reachability hook for the settings UI. Subscribes to the shared probe
 * coordinator instead of running its own race so all UI surfaces see the
 * same numbers without sending duplicate /health pings.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { useGatewayStore } from '../../stores/gateway-store';

import {
  type GatewayRouteReachability,
  type RouteReachabilityInfo,
} from './check-gateway-routes';
import {
  getLastProbeOutcome,
  runProbeRound,
  subscribeProbeOutcome,
  type ProbeOutcome,
} from './probe-coordinator';

function notConfigured(): RouteReachabilityInfo {
  return { status: 'not_configured' };
}

function checking(): RouteReachabilityInfo {
  return { status: 'checking' };
}

function unreachable(): RouteReachabilityInfo {
  return { status: 'unreachable' };
}

function fromOutcome(
  outcome: ProbeOutcome | null,
  hasLan: boolean,
  hasTunnel: boolean,
): GatewayRouteReachability {
  if (!outcome) {
    return {
      lan: hasLan ? checking() : notConfigured(),
      tunnel: hasTunnel ? checking() : { status: 'unreachable', reason: 'invalid_url' },
    };
  }
  const lanProbe = outcome.result.lan;
  const tunnelProbe = outcome.result.tunnel;
  return {
    lan: hasLan
      ? lanProbe
        ? lanProbe.reachable
          ? { status: 'reachable', latencyMs: lanProbe.latencyMs }
          : {
              status: 'unreachable',
              reason: lanProbe.reason,
              httpStatus: lanProbe.httpStatus,
              detail: lanProbe.errorMessage,
              latencyMs: lanProbe.latencyMs,
            }
        : unreachable()
      : notConfigured(),
    tunnel: hasTunnel
      ? tunnelProbe
        ? tunnelProbe.reachable
          ? { status: 'reachable', latencyMs: tunnelProbe.latencyMs }
          : {
              status: 'unreachable',
              reason: tunnelProbe.reason,
              httpStatus: tunnelProbe.httpStatus,
              detail: tunnelProbe.errorMessage,
              latencyMs: tunnelProbe.latencyMs,
            }
        : unreachable()
      : { status: 'unreachable', reason: 'invalid_url' },
  };
}

export function useGatewayRouteReachability(enabled: boolean): {
  reachability: GatewayRouteReachability;
  checking: boolean;
  recheck: () => Promise<void>;
} {
  const baseUrl = useGatewayStore((s) => s.baseUrl);
  const lanUrl = useGatewayStore((s) => s.lanUrl);
  const hasTunnel = enabled && Boolean(baseUrl.trim());
  const hasLan = Boolean(lanUrl?.trim());

  const [outcome, setOutcome] = useState<ProbeOutcome | null>(() => getLastProbeOutcome());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!enabled || !baseUrl.trim()) return;
    const unsub = subscribeProbeOutcome((next) => setOutcome(next));
    void runProbeRound('initial');
    return unsub;
  }, [enabled, baseUrl]);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      void runProbeRound('foreground');
    }, [enabled]),
  );

  const recheck = useCallback(async () => {
    setBusy(true);
    try {
      await runProbeRound('manual', { force: true });
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    reachability: fromOutcome(outcome, hasLan, hasTunnel),
    checking: busy,
    recheck,
  };
}
