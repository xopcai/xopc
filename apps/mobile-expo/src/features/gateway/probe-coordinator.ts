/**
 * Single source of truth for "is the gateway reachable, and on which route?".
 *
 * Replaces three independently-firing systems that used to probe /health on
 * their own schedules:
 *   - GatewayHealthMonitor (30s polling)
 *   - useGatewayConnectionWatch (foreground race)
 *   - useGatewayRouteReachability (settings page status indicators)
 *
 * The coordinator runs one race per gateway profile at a time, dedupes
 * concurrent callers within a small window, and broadcasts the active
 * profile's structured result to anyone who
 * subscribes (UI, realtime swap, online/offline state). The probe is paused while
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

export type ProbeTask = {
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
  | 'realtime-degraded'
  | 'manual'
  | 'settings-saved'
  | 'tunnel-qr-sync'
  | 'periodic';

const FRESH_TTL_MS = 5_000;

const lastByGateway = new Map<string, ProbeTask>();
const inFlightByGateway = new Map<string, Promise<ProbeTask>>();
const lastFiredAtByGateway = new Map<string, number>();

const listeners = new Set<(task: ProbeTask) => void>();

type GatewayProbeSnapshot = Pick<
  ReturnType<typeof useGatewayStore.getState>,
  'activeGatewayId' | 'baseUrl' | 'lanUrl' | 'token'
>;

function probeKey(snapshot: GatewayProbeSnapshot): string {
  return [
    snapshot.activeGatewayId ?? '',
    snapshot.baseUrl.trim(),
    snapshot.lanUrl?.trim() ?? '',
    snapshot.token,
  ].join('\n');
}

function currentProbeKey(): string {
  return probeKey(useGatewayStore.getState());
}

function emit(task: ProbeTask): void {
  for (const cb of listeners) cb(task);
}

export function getLastProbeTask(): ProbeTask | null {
  return lastByGateway.get(currentProbeKey()) ?? null;
}

export function subscribeProbeTask(cb: (task: ProbeTask) => void): () => void {
  listeners.add(cb);
  const last = getLastProbeTask();
  if (last) cb(last);
  return () => {
    listeners.delete(cb);
  };
}

/** Publish a route already verified by transactional profile switching. */
export function acceptVerifiedGatewayRoute(input: {
  profileId: string;
  baseUrl: string;
  lanUrl: string | null;
  token: string;
  winner: 'lan' | 'tunnel';
  url: string;
  latencyMs?: number;
}): void {
  const key = probeKey({
    activeGatewayId: input.profileId,
    baseUrl: input.baseUrl,
    lanUrl: input.lanUrl,
    token: input.token,
  });
  const success = { reachable: true as const, latencyMs: input.latencyMs };
  const task: ProbeTask = {
    at: Date.now(),
    online: true,
    result: {
      winner: input.winner,
      url: input.url,
      latencyMs: input.latencyMs,
      lan: input.winner === 'lan' ? success : null,
      tunnel: input.winner === 'tunnel' ? success : null,
    },
  };
  lastByGateway.set(key, task);
  if (currentProbeKey() === key) emit(task);
}

export type RunProbeOptions = {
  /** Skip the cooldown — the user explicitly asked for a recheck. */
  force?: boolean;
};

/**
 * Run a race (or return the in-flight one). Within FRESH_TTL_MS of a recent
 * task we skip the network entirely unless `force` is set.
 */
export async function runProbeRound(
  reason: ProbeReason,
  options: RunProbeOptions = {},
): Promise<ProbeTask> {
  const now = Date.now();
  const snapshot = useGatewayStore.getState();
  const key = probeKey(snapshot);
  const last = lastByGateway.get(key) ?? null;
  const inFlight = inFlightByGateway.get(key);
  const lastFiredAt = lastFiredAtByGateway.get(key) ?? 0;
  if (!options.force && last && now - last.at < FRESH_TTL_MS) return last;
  if (inFlight) return inFlight;
  if (!options.force && now - lastFiredAt < PROBE_TIMING.RECHECK_COOLDOWN_MS && last) {
    return last;
  }

  const { baseUrl, lanUrl, token, activeGatewayId } = snapshot;
  if (!baseUrl.trim() && !lanUrl?.trim()) {
    const offline: ProbeTask = {
      at: now,
      result: { winner: 'none', url: '', lan: null, tunnel: null },
      online: false,
    };
    lastByGateway.set(key, offline);
    if (currentProbeKey() === key) emit(offline);
    return offline;
  }

  lastFiredAtByGateway.set(key, now);
  const taskPromise = (async (): Promise<ProbeTask> => {
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
    const task: ProbeTask = {
      at: Date.now(),
      result,
      online: result.winner !== 'none',
    };
    lastByGateway.set(key, task);

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
      ok: task.online,
      url: result.url || undefined,
      route: result.winner === 'none' ? undefined : result.winner,
      reason,
      latencyMs: result.latencyMs,
      network: getNetworkSnapshot().key,
    });

    // A route race may finish after the user has already selected another
    // profile. Keep its result cached for that profile, but never let it
    // overwrite the active gateway's online/offline state.
    if (currentProbeKey() === key) emit(task);
    return task;
  })();
  inFlightByGateway.set(key, taskPromise);
  const clearInFlight = () => {
    if (inFlightByGateway.get(key) === taskPromise) inFlightByGateway.delete(key);
  };
  void taskPromise.then(clearInFlight, clearInFlight);

  return taskPromise;
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
  lastByGateway.clear();
  inFlightByGateway.clear();
  lastFiredAtByGateway.clear();
  listeners.clear();
}
