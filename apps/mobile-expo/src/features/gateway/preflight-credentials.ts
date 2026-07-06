/**
 * Pre-persistence reachability check for newly-paired credentials. Runs a
 * Happy-Eyeballs race against both routes WITHOUT touching the gateway store
 * so we can refuse a known-bad pairing before the user is left staring at
 * a blank chat.
 *
 * Returns either the reachable URL (for the toast) or a `GatewayConnectivityError`
 * the caller can map to UI copy.
 */
import { raceGatewayRoutes } from '../../api/connection-strategy';
import { GatewayConnectivityError } from '../../api/gateway-error';

import { recordConnectionEvent } from './connection-log';
import { getNetworkSnapshot } from './network-info';

export type PreflightInput = {
  baseUrl: string;
  lanUrl: string | null;
  token: string;
};

export type PreflightResult =
  | {
      ok: true;
      winner: 'lan' | 'tunnel';
      url: string;
      latencyMs?: number;
    }
  | {
      ok: false;
      error: GatewayConnectivityError;
    };

export async function preflightGatewayCredentials(input: PreflightInput): Promise<PreflightResult> {
  if (!input.baseUrl.trim() && !input.lanUrl?.trim()) {
    return {
      ok: false,
      error: new GatewayConnectivityError('misconfigured', 'Pairing did not return a usable URL'),
    };
  }

  const race = await raceGatewayRoutes(input.baseUrl, input.lanUrl ?? undefined, {
    token: input.token,
  });

  recordConnectionEvent({
    kind: 'race',
    ok: race.winner !== 'none',
    url: race.url || undefined,
    route: race.winner === 'none' ? undefined : race.winner,
    reason: 'manual',
    latencyMs: race.latencyMs,
    network: getNetworkSnapshot().key,
    message: 'preflight',
  });

  if (race.winner === 'lan' || race.winner === 'tunnel') {
    return { ok: true, winner: race.winner, url: race.url, latencyMs: race.latencyMs };
  }

  const tunnelStatus = race.tunnel?.httpStatus;
  if (tunnelStatus === 401 || race.lan?.httpStatus === 401) {
    return {
      ok: false,
      error: new GatewayConnectivityError('token-invalid', 'Token rejected by gateway', {
        httpStatus: 401,
      }),
    };
  }
  if (tunnelStatus && tunnelStatus >= 500) {
    return {
      ok: false,
      error: new GatewayConnectivityError('server-error', `Gateway returned ${tunnelStatus}`, {
        httpStatus: tunnelStatus,
      }),
    };
  }
  if (getNetworkSnapshot().kind === 'offline') {
    return {
      ok: false,
      error: new GatewayConnectivityError('offline-network', 'No internet connection'),
    };
  }
  // When baseUrl is HTTPS on a non-FRP hostname, the user has a self-deployed
  // reverse proxy (or any HTTPS-terminated gateway). Surface a targeted error
  // so the UI can hint "check your nginx/Caddy config" instead of the generic
  // "no-route" message.
  if (looksLikeReverseProxyOrigin(input.baseUrl)) {
    return {
      ok: false,
      error: new GatewayConnectivityError(
        'reverse-proxy-unreachable',
        'Reverse-proxy URL did not respond. Check TLS certificate, DNS, and that /health is reachable through the proxy.',
        {
          tunnelFailed: !race.tunnel?.reachable,
          lanFailed: !race.lan?.reachable,
        },
      ),
    };
  }
  return {
    ok: false,
    error: new GatewayConnectivityError('no-route', 'Could not reach the gateway on either route', {
      lanFailed: !race.lan?.reachable,
      tunnelFailed: !race.tunnel?.reachable,
    }),
  };
}

function looksLikeReverseProxyOrigin(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    return !/\.frp\.xopc\.ai$/i.test(u.hostname);
  } catch {
    return false;
  }
}
