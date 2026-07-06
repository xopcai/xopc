/**
 * Pick the best gateway base URL: LAN-preferred Happy Eyeballs race.
 *
 * Why race instead of LAN-then-fallback?
 *   The previous LAN-first sequential probe waited up to its full timeout
 *   (5s) before considering the tunnel even when the tunnel was reachable
 *   in 200ms. Racing both probes in parallel and giving LAN a small
 *   head-start window gives users the lower-latency LAN path when it
 *   works and the tunnel quickly when it doesn't.
 *
 * Cellular detection: when the device is on cellular or offline, LAN
 * addresses can't be reached — we skip the LAN probe entirely.
 */
import {
  getNetworkSnapshot,
  isLikelyLanReachable,
} from '../features/gateway/network-info';
import { ensureGatewayUrlScheme } from '../stores/gateway-types';
import {
  PROBE_TIMING,
  type ProbeTiming,
} from '../features/gateway/probe-timing';

export type ResolvePreferredBaseUrlOptions = {
  token?: string;
  /** Override LAN probe timeout. */
  timeoutMs?: number;
  /** Override the full race timing (test hook). */
  timing?: Partial<ProbeTiming>;
};

export type GatewayRouteProbeReason =
  | 'timeout'
  | 'network_error'
  | 'invalid_url'
  | 'http_error';

export type GatewayRouteProbeResult = {
  reachable: boolean;
  reason?: GatewayRouteProbeReason;
  httpStatus?: number;
  latencyMs?: number;
  errorMessage?: string;
};

export type RouteRaceWinner = 'lan' | 'tunnel' | 'none';

export type RouteRaceResult = {
  winner: RouteRaceWinner;
  url: string;
  latencyMs?: number;
  lan: GatewayRouteProbeResult | null;
  tunnel: GatewayRouteProbeResult | null;
};

function gatewayHealthUrl(baseUrl: string): string {
  return `${ensureGatewayUrlScheme(baseUrl)}/health`;
}

function buildHealthHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const trimmed = token?.trim();
  if (trimmed) headers.Authorization = `Bearer ${trimmed}`;
  return headers;
}

function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return true;
    if (error.message.toLowerCase().includes('abort')) return true;
  }
  return false;
}

function nowMs(): number {
  return Date.now();
}

export async function probeGatewayRouteReachability(
  baseUrl: string,
  options?: ResolvePreferredBaseUrlOptions,
): Promise<GatewayRouteProbeResult> {
  if (!baseUrl.trim()) {
    return { reachable: false, reason: 'invalid_url' };
  }

  let fetchUrl: string;
  try {
    fetchUrl = gatewayHealthUrl(baseUrl);
    void new URL(fetchUrl);
  } catch {
    return { reachable: false, reason: 'invalid_url' };
  }

  const timeoutMs = options?.timeoutMs ?? PROBE_TIMING.TIMEOUT_TUNNEL_MS;
  const startedAt = nowMs();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(fetchUrl, {
      signal: controller.signal,
      headers: buildHealthHeaders(options?.token),
    });
    clearTimeout(timeout);
    void res.body?.cancel?.();
    return { reachable: true, latencyMs: nowMs() - startedAt };
  } catch (error) {
    if (isAbortError(error)) {
      return { reachable: false, reason: 'timeout', latencyMs: nowMs() - startedAt };
    }
    const errorMessage = error instanceof Error ? error.message.trim() : String(error).trim();
    return {
      reachable: false,
      reason: 'network_error',
      latencyMs: nowMs() - startedAt,
      errorMessage: errorMessage || undefined,
    };
  }
}

function effectiveTiming(override?: Partial<ProbeTiming>): ProbeTiming {
  if (!override) return PROBE_TIMING;
  return { ...PROBE_TIMING, ...override };
}

/**
 * Race LAN and tunnel probes with LAN preferred when both succeed within the
 * head-start window.
 */
export async function raceGatewayRoutes(
  tunnelUrl: string,
  lanUrl: string | undefined,
  options?: ResolvePreferredBaseUrlOptions,
): Promise<RouteRaceResult> {
  const timing = effectiveTiming(options?.timing);
  const tunnel = tunnelUrl.trim()
    ? ensureGatewayUrlScheme(tunnelUrl.trim().replace(/\/+$/, ''))
    : '';
  const lan = lanUrl?.trim() ? ensureGatewayUrlScheme(lanUrl.trim().replace(/\/+$/, '')) : '';

  if (!tunnel && !lan) {
    return { winner: 'none', url: '', lan: null, tunnel: null };
  }
  if (!tunnel) {
    const probe = await probeGatewayRouteReachability(lan, {
      ...options,
      timeoutMs: options?.timeoutMs ?? timing.TIMEOUT_LAN_MS,
    });
    return {
      winner: probe.reachable ? 'lan' : 'none',
      url: probe.reachable ? lan : '',
      latencyMs: probe.latencyMs,
      lan: probe,
      tunnel: null,
    };
  }
  if (!lan) {
    const probe = await probeGatewayRouteReachability(tunnel, {
      ...options,
      timeoutMs: options?.timeoutMs ?? timing.TIMEOUT_TUNNEL_MS,
    });
    return {
      winner: probe.reachable ? 'tunnel' : 'none',
      url: probe.reachable ? tunnel : '',
      latencyMs: probe.latencyMs,
      lan: null,
      tunnel: probe,
    };
  }

  // Cellular / offline: LAN address can't be reachable, so skip the LAN probe.
  if (!isLikelyLanReachable() && getNetworkSnapshot().kind !== 'unknown') {
    const probe = await probeGatewayRouteReachability(tunnel, {
      ...options,
      timeoutMs: options?.timeoutMs ?? timing.TIMEOUT_TUNNEL_MS,
    });
    return {
      winner: probe.reachable ? 'tunnel' : 'none',
      url: probe.reachable ? tunnel : '',
      latencyMs: probe.latencyMs,
      lan: null,
      tunnel: probe,
    };
  }

  return runHappyEyeballs(lan, tunnel, options ?? {}, timing);
}

function runHappyEyeballs(
  lan: string,
  tunnel: string,
  options: ResolvePreferredBaseUrlOptions,
  timing: ProbeTiming,
): Promise<RouteRaceResult> {
  return new Promise((resolve) => {
    let lanResult: GatewayRouteProbeResult | null = null;
    let tunnelResult: GatewayRouteProbeResult | null = null;
    let resolved = false;
    let headStartTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (winner: RouteRaceWinner) => {
      if (resolved) return;
      resolved = true;
      if (headStartTimer) {
        clearTimeout(headStartTimer);
        headStartTimer = null;
      }
      let url = '';
      let latencyMs: number | undefined;
      if (winner === 'lan') {
        url = lan;
        latencyMs = lanResult?.latencyMs;
      } else if (winner === 'tunnel') {
        url = tunnel;
        latencyMs = tunnelResult?.latencyMs;
      }
      resolve({ winner, url, latencyMs, lan: lanResult, tunnel: tunnelResult });
    };

    const startedAt = nowMs();

    void probeGatewayRouteReachability(lan, {
      ...options,
      timeoutMs: timing.TIMEOUT_LAN_MS,
    }).then((result) => {
      lanResult = result;
      if (result.reachable) {
        finish('lan');
        return;
      }
      // LAN failed: if tunnel already won, accept it now. Otherwise wait.
      if (tunnelResult?.reachable) finish('tunnel');
      else if (tunnelResult && !tunnelResult.reachable) finish('none');
    });

    void probeGatewayRouteReachability(tunnel, {
      ...options,
      timeoutMs: timing.TIMEOUT_TUNNEL_MS,
    }).then((result) => {
      tunnelResult = result;
      if (!result.reachable) {
        if (lanResult && !lanResult.reachable) finish('none');
        return;
      }
      // Tunnel succeeded. Give LAN a grace period unless LAN already failed.
      if (lanResult?.reachable) {
        // LAN already won.
        return;
      }
      if (lanResult && !lanResult.reachable) {
        finish('tunnel');
        return;
      }
      const remaining = Math.max(0, timing.LAN_HEAD_START_MS - (nowMs() - startedAt));
      if (headStartTimer) clearTimeout(headStartTimer);
      headStartTimer = setTimeout(() => {
        headStartTimer = null;
        if (resolved) return;
        if (lanResult?.reachable) finish('lan');
        else finish('tunnel');
      }, remaining);
    });

    // Hard race timeout — never hang the caller.
    setTimeout(() => {
      if (resolved) return;
      if (lanResult?.reachable) finish('lan');
      else if (tunnelResult?.reachable) finish('tunnel');
      else finish('none');
    }, timing.RACE_HARD_TIMEOUT_MS);
  });
}

/**
 * @returns the URL to use as gateway base, or '' if neither configured
 *   (caller falls back to its own best guess).
 */
export async function resolvePreferredBaseUrl(
  tunnelUrl: string,
  lanUrl: string | undefined,
  options?: ResolvePreferredBaseUrlOptions,
): Promise<string> {
  const result = await raceGatewayRoutes(tunnelUrl, lanUrl, options);
  if (result.winner === 'lan' || result.winner === 'tunnel') return result.url;

  // Both unreachable (or nothing configured): keep the caller's best guess.
  const tunnel = tunnelUrl.trim()
    ? ensureGatewayUrlScheme(tunnelUrl.trim().replace(/\/+$/, ''))
    : '';
  const lan = lanUrl?.trim() ? ensureGatewayUrlScheme(lanUrl.trim().replace(/\/+$/, '')) : '';
  return lan || tunnel;
}
