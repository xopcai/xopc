/**
 * Single source of truth for "is the gateway reachable, and on which route?".
 *
 * Replaces three independently-firing systems that used to probe /health on
 * their own schedules:
 *   - GatewayHealthMonitor (30s polling)
 *   - useGatewayConnectionWatch (foreground race)
 *   - useGatewayRouteReachability (settings page status indicators)
 *
 * The coordinator runs ONE race at a time, dedupes concurrent callers within
 * a small window, and broadcasts the structured result to anyone who
 * subscribes (UI, SSE swap, online/offline state). The probe is paused while
 * the app is in the background to save battery and respects a configurable
 * cool-down so back-to-back triggers (foreground + network change + focus)
 * collapse to a single round-trip.
 */
import { recordConnectionEvent } from './connection-log';
import {
  getNetworkSnapshot,
  isLikelyLanReachable,
} from './network-info';
import { PROBE_TIMING } from './probe-timing';
import {
  probeGatewayRouteReachability,
  raceGatewayRoutes,
  type RouteRaceResult,
} from '../../api/connection-strategy';
import {
  readLastGoodRoute,
  writeLastGoodRoute,
} from './last-good-route';
import { readRouteOverride } from './route-override';
import { useGatewayStore } from '../../stores/gateway-store';
import { ensureGatewayUrlScheme } from '../../stores/gateway-types';

export type ProbeOutcome = {
  /** Wall-clock when the round completed. */
  at: number;
  result: RouteRaceResult;
  /** True if any route was reachable. Drives the global online/offline. */
  online: boolean;
};

export type ProbeReason =
  | 'initial'
  | 'foreground'
  | 'network-change'
  | 'sse-degraded'
  | 'manual'
  | 'settings-saved'
  | 'tunnel-qr-sync'
  | 'periodic';

const FRESH_TTL_MS = 5_000;

let last: ProbeOutcome | null = null;
let inFlight: Promise<ProbeOutcome> | null = null;
let lastFiredAt = 0;

const listeners = new Set<(outcome: ProbeOutcome) => void>();

function emit(outcome: ProbeOutcome): void {
  for (const cb of listeners) cb(outcome);
}

export function getLastProbeOutcome(): ProbeOutcome | null {
  return last;
}

export function subscribeProbeOutcome(cb: (outcome: ProbeOutcome) => void): () => void {
  listeners.add(cb);
  if (last) cb(last);
  return () => {
    listeners.delete(cb);
  };
}

export type RunProbeOptions = {
  /** Skip the cooldown — the user explicitly asked for a recheck. */
  force?: boolean;
};

/**
 * Run a race (or return the in-flight one). Within FRESH_TTL_MS of a recent
 * outcome we skip the network entirely unless `force` is set.
 */
export async function runProbeRound(
  reason: ProbeReason,
  options: RunProbeOptions = {},
): Promise<ProbeOutcome> {
  const now = Date.now();
  if (!options.force && last && now - last.at < FRESH_TTL_MS) return last;
  if (inFlight) return inFlight;
  if (!options.force && now - lastFiredAt < PROBE_TIMING.RECHECK_COOLDOWN_MS && last) {
    return last;
  }

  const { baseUrl, lanUrl, token, activeGatewayId } = useGatewayStore.getState();
  if (!baseUrl.trim() && !lanUrl?.trim()) {
    const offline: ProbeOutcome = {
      at: now,
      result: { winner: 'none', url: '', lan: null, tunnel: null },
      online: false,
    };
    last = offline;
    emit(offline);
    return offline;
  }

  lastFiredAt = now;
  inFlight = (async (): Promise<ProbeOutcome> => {
    try {
      // Manual override: probe ONLY the chosen route. The other side might
      // be misbehaving (split DNS, captive portal) and the user has told us
      // explicitly to ignore it.
      const override = readRouteOverride(activeGatewayId);
      let result: RouteRaceResult;
      if (override === 'lan' && lanUrl?.trim()) {
        const lan = ensureGatewayUrlScheme(lanUrl.trim());
        const probe = await probeGatewayRouteReachability(lan, {
          token,
          timeoutMs: PROBE_TIMING.TIMEOUT_LAN_MS,
        });
        result = {
          winner: probe.reachable ? 'lan' : 'none',
          url: probe.reachable ? lan : '',
          latencyMs: probe.latencyMs,
          lan: probe,
          tunnel: null,
        };
      } else if (override === 'tunnel' && baseUrl.trim()) {
        const tunnel = ensureGatewayUrlScheme(baseUrl.trim());
        const probe = await probeGatewayRouteReachability(tunnel, {
          token,
          timeoutMs: PROBE_TIMING.TIMEOUT_TUNNEL_MS,
        });
        result = {
          winner: probe.reachable ? 'tunnel' : 'none',
          url: probe.reachable ? tunnel : '',
          latencyMs: probe.latencyMs,
          lan: null,
          tunnel: probe,
        };
      } else {
        result = await raceGatewayRoutes(baseUrl, lanUrl ?? undefined, { token });
      }
      const outcome: ProbeOutcome = {
        at: Date.now(),
        result,
        online: result.winner !== 'none',
      };
      last = outcome;

      if (
        activeGatewayId &&
        (result.winner === 'lan' || result.winner === 'tunnel') &&
        result.url
      ) {
        const networkKey = getNetworkSnapshot().key;
        writeLastGoodRoute(activeGatewayId, networkKey, {
          url: result.url,
          kind: result.winner,
          latencyMs: result.latencyMs,
        });
      }

      recordConnectionEvent({
        kind: 'race',
        ok: outcome.online,
        url: result.url || undefined,
        route: result.winner === 'none' ? undefined : result.winner,
        reason,
        latencyMs: result.latencyMs,
        network: getNetworkSnapshot().key,
      });

      emit(outcome);
      return outcome;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Pop the cached "last good" route for the current network — used by callers
 * who want to render an optimistic state without firing a probe. */
export function readCachedRouteForCurrentNetwork(): {
  url: string;
  kind: 'lan' | 'tunnel';
  latencyMs?: number;
} | null {
  const { activeGatewayId } = useGatewayStore.getState();
  if (!activeGatewayId) return null;
  const snap = getNetworkSnapshot();
  if (snap.kind === 'unknown' || snap.kind === 'offline') return null;
  const entry = readLastGoodRoute(activeGatewayId, snap.key);
  if (!entry) return null;
  return { url: entry.url, kind: entry.kind, latencyMs: entry.latencyMs };
}

/** Remove the LAN cached entry for the current network — used after we
 * decide LAN is unreachable to avoid using it on the next cold start. */
export function isCurrentNetworkLanCellular(): boolean {
  return !isLikelyLanReachable();
}

/** @internal test helper */
export function __resetProbeCoordinatorForTests(): void {
  last = null;
  inFlight = null;
  lastFiredAt = 0;
  listeners.clear();
}
