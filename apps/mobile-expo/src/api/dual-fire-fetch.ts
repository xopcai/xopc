/**
 * Dual-fire fetch — sends an idempotent request to LAN and tunnel in parallel,
 * accepts the first 2xx, aborts the loser, records the winner so subsequent
 * business calls go straight to the right route, and throws a structured
 * `GatewayConnectivityError` describing exactly which routes failed and why
 * if neither succeeds.
 *
 * Used as a confidence-aware bootstrap: when we don't have a network-scoped
 * cached winner, we don't trust `activeBaseUrl` and dual-fire the request.
 * After the first success the cache + active URL are correct and the rest of
 * the session uses single-route apiFetch.
 *
 * SAFETY: only safe for idempotent reads.
 */
import { recordConnectionEvent } from '../features/gateway/connection-log';
import {
  readLastGoodRoute,
  writeLastGoodRoute,
} from '../features/gateway/last-good-route';
import { getNetworkSnapshot, isLikelyLanReachable } from '../features/gateway/network-info';
import { PROBE_TIMING } from '../features/gateway/probe-timing';
import { readRouteOverride } from '../features/gateway/route-override';
import { useGatewayStore } from '../stores/gateway-store';
import {
  ensureGatewayUrlScheme,
  normalizeGatewayBaseUrl,
} from '../stores/gateway-types';

import { GatewayConnectivityError } from './gateway-error';
import { notifyUnauthorizedIfNeeded } from './notify-unauthorized';

export type DualFireOptions = {
  token?: string;
  raceTimeoutMs?: number;
};

function buildHeaders(init: RequestInit | undefined, token: string | undefined): Headers {
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type') && init?.body != null && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

function joinUrl(base: string, path: string): string {
  const normalizedBase = normalizeGatewayBaseUrl(base);
  if (!normalizedBase) return '';
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

type RouteAttempt = {
  kind: 'lan' | 'tunnel';
  url: string;
  controller: AbortController;
  startedAt: number;
};

/**
 * Returns true when the current network has a cached winner recorded — the
 * caller should skip dual-fire and use plain apiFetch.
 *
 * Strict on purpose: any-network fallback hits do NOT count. Without a
 * network-scoped record we treat the activeBaseUrl as a hint only.
 *
 * Manual override short-circuits this: when the user pinned a route we
 * always trust the active URL and never fan out — sending the other
 * route would defeat the override the user explicitly set.
 */
export function hasCachedRouteWinner(): boolean {
  const { activeGatewayId } = useGatewayStore.getState();
  if (!activeGatewayId) return false;
  if (readRouteOverride(activeGatewayId) !== 'auto') return true;
  const snap = getNetworkSnapshot();
  if (snap.kind === 'unknown' || snap.kind === 'offline') return false;
  return readLastGoodRoute(activeGatewayId, snap.key) !== null;
}

/**
 * Race a GET (or other idempotent request) on both routes. Falls back to a
 * single-route call when only one is configured or only one is plausibly
 * reachable (e.g. LAN on cellular).
 *
 * Throws GatewayConnectivityError with diagnostic info on full failure.
 */
export async function dualFireFetch(
  path: string,
  init: RequestInit = { method: 'GET' },
  options: DualFireOptions = {},
): Promise<Response> {
  const { baseUrl, lanUrl, token: storeToken, activeGatewayId } = useGatewayStore.getState();
  const token = options.token ?? storeToken;
  const tunnel = baseUrl.trim() ? ensureGatewayUrlScheme(baseUrl.trim()) : '';
  const lanCandidate = lanUrl?.trim() ? ensureGatewayUrlScheme(lanUrl.trim()) : '';
  const lan = lanCandidate && isLikelyLanReachable() ? lanCandidate : '';

  if (!tunnel && !lan) {
    throw new GatewayConnectivityError('misconfigured', 'Gateway base URL is not configured');
  }
  if (!tunnel || !lan) {
    return singleFetch(tunnel || lan, path, init, token, activeGatewayId, tunnel ? 'tunnel' : 'lan');
  }

  const headers = buildHeaders(init, token);
  const raceTimeoutMs = options.raceTimeoutMs ?? PROBE_TIMING.RACE_HARD_TIMEOUT_MS;

  const attempts: RouteAttempt[] = [
    { kind: 'lan', url: lan, controller: new AbortController(), startedAt: Date.now() },
    { kind: 'tunnel', url: tunnel, controller: new AbortController(), startedAt: Date.now() },
  ];

  type Outcome =
    | { ok: true; res: Response; attempt: RouteAttempt }
    | { ok: false; err: unknown; attempt: RouteAttempt };

  const fired = attempts.map(
    (attempt) =>
      new Promise<Outcome>((resolve) => {
        fetch(joinUrl(attempt.url, path), {
          ...init,
          headers,
          signal: attempt.controller.signal,
        })
          .then((res) => resolve({ ok: true, res, attempt }))
          .catch((err) => resolve({ ok: false, err, attempt }));
      }),
  );

  return new Promise<Response>((resolveOuter, rejectOuter) => {
    let settled = false;
    const settledOutcomes: Outcome[] = [];
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      attempts.forEach((a) => a.controller.abort());
      rejectOuter(buildFailureError(settledOutcomes, attempts));
    }, raceTimeoutMs);

    const finishLoss = () => {
      if (settled || settledOutcomes.length < attempts.length) return;
      settled = true;
      clearTimeout(timeout);
      const ok2xx = settledOutcomes.find((o) => o.ok && o.res.ok);
      if (ok2xx && ok2xx.ok) {
        recordWinner(activeGatewayId, ok2xx.attempt);
        notifyUnauthorizedIfNeeded(ok2xx.res.status);
        resolveOuter(ok2xx.res);
        return;
      }
      const okNon2xx = settledOutcomes.find((o) => o.ok);
      if (okNon2xx && okNon2xx.ok) {
        // Both reachable but neither 2xx — pick the first; surface 401 / 5xx.
        notifyUnauthorizedIfNeeded(okNon2xx.res.status);
        resolveOuter(okNon2xx.res);
        return;
      }
      rejectOuter(buildFailureError(settledOutcomes, attempts));
    };

    for (const promise of fired) {
      promise.then((outcome) => {
        if (settled) return;
        if (outcome.ok && outcome.res.ok) {
          settled = true;
          clearTimeout(timeout);
          attempts
            .filter((a) => a !== outcome.attempt)
            .forEach((a) => a.controller.abort());
          recordWinner(activeGatewayId, outcome.attempt);
          notifyUnauthorizedIfNeeded(outcome.res.status);
          resolveOuter(outcome.res);
          return;
        }
        settledOutcomes.push(outcome);
        finishLoss();
      });
    }
  });
}

async function singleFetch(
  base: string,
  path: string,
  init: RequestInit,
  token: string | undefined,
  profileId: string | null,
  kind: 'lan' | 'tunnel',
): Promise<Response> {
  const headers = buildHeaders(init, token);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMING.RACE_HARD_TIMEOUT_MS);
  try {
    const res = await fetch(joinUrl(base, path), {
      ...init,
      headers,
      signal: controller.signal,
    });
    notifyUnauthorizedIfNeeded(res.status);
    if (res.ok && profileId) {
      const networkKey = getNetworkSnapshot().key;
      writeLastGoodRoute(profileId, networkKey, {
        url: normalizeGatewayBaseUrl(base),
        kind,
        latencyMs: Date.now() - startedAt,
      });
      recordConnectionEvent({
        kind: 'dualFire',
        ok: true,
        url: base,
        route: kind,
        latencyMs: Date.now() - startedAt,
        network: getNetworkSnapshot().key,
      });
    }
    return res;
  } catch (err) {
    recordConnectionEvent({
      kind: 'dualFire',
      ok: false,
      url: base,
      route: kind,
      reason: 'no-route',
      message: err instanceof Error ? err.message : String(err),
      network: getNetworkSnapshot().key,
    });
    throw new GatewayConnectivityError(
      getNetworkSnapshot().kind === 'offline' ? 'offline-network' : 'no-route',
      'Could not reach gateway',
      { cause: err, lanFailed: kind === 'lan', tunnelFailed: kind === 'tunnel' },
    );
  } finally {
    clearTimeout(timer);
  }
}

type Outcome =
  | { ok: true; res: Response; attempt: RouteAttempt }
  | { ok: false; err: unknown; attempt: RouteAttempt };

function buildFailureError(
  outcomes: Outcome[],
  attempts: RouteAttempt[],
): GatewayConnectivityError {
  const lan = outcomes.find((o) => o.attempt.kind === 'lan');
  const tunnel = outcomes.find((o) => o.attempt.kind === 'tunnel');

  const lanRes = lan?.ok ? lan.res : null;
  const tunnelRes = tunnel?.ok ? tunnel.res : null;

  // Server-error case: at least one route returned 5xx → surface the status.
  if (lanRes && lanRes.status >= 500) {
    notifyUnauthorizedIfNeeded(lanRes.status);
    return new GatewayConnectivityError('server-error', `Gateway returned ${lanRes.status}`, {
      httpStatus: lanRes.status,
    });
  }
  if (tunnelRes && tunnelRes.status >= 500) {
    notifyUnauthorizedIfNeeded(tunnelRes.status);
    return new GatewayConnectivityError('server-error', `Gateway returned ${tunnelRes.status}`, {
      httpStatus: tunnelRes.status,
    });
  }

  // 401 case
  if (lanRes?.status === 401 || tunnelRes?.status === 401) {
    notifyUnauthorizedIfNeeded(401);
    return new GatewayConnectivityError('token-invalid', 'Token expired', {
      httpStatus: 401,
    });
  }

  const lanFailed = !lan || (lan.ok ? !lan.res.ok : true);
  const tunnelFailed = !tunnel || (tunnel.ok ? !tunnel.res.ok : true);

  recordConnectionEvent({
    kind: 'dualFire',
    ok: false,
    url: attempts.map((a) => a.url).join('|'),
    reason: lanFailed && tunnelFailed ? 'no-route' : 'partial',
    network: getNetworkSnapshot().key,
  });

  // Tunnel works at HTTP layer (got SOMETHING) but LAN dead → device-offline
  // pattern is more about LAN refused / connect-refused, but if tunnel
  // returned a non-2xx response while LAN failed at network layer, mark
  // device-offline as well so the UI can suggest "your computer might be off".
  if (lanFailed && tunnelRes) {
    return new GatewayConnectivityError('offline-device', 'Gateway computer may be offline', {
      lanFailed: true,
      tunnelFailed: true,
      httpStatus: tunnelRes.status,
    });
  }

  if (getNetworkSnapshot().kind === 'offline') {
    return new GatewayConnectivityError('offline-network', 'No internet connection', {
      lanFailed,
      tunnelFailed,
    });
  }

  return new GatewayConnectivityError('no-route', 'No route to gateway', {
    lanFailed,
    tunnelFailed,
  });
}

function recordWinner(profileId: string | null, attempt: RouteAttempt): void {
  if (!profileId) return;
  const networkKey = getNetworkSnapshot().key;
  const store = useGatewayStore.getState();
  const winnerUrl = normalizeGatewayBaseUrl(attempt.url);
  if (winnerUrl && store.activeBaseUrl !== winnerUrl) {
    useGatewayStore.setState({ activeBaseUrl: winnerUrl });
  }
  writeLastGoodRoute(profileId, networkKey, {
    url: winnerUrl,
    kind: attempt.kind,
    latencyMs: Date.now() - attempt.startedAt,
  });
  recordConnectionEvent({
    kind: 'dualFire',
    ok: true,
    url: winnerUrl,
    route: attempt.kind,
    latencyMs: Date.now() - attempt.startedAt,
    network: networkKey,
  });
}
