/**
 * Pure derivation of `ConnectionState` from inputs. Split from the hook so
 * unit tests don't need to drag in the React + RN dependency chain.
 */
import type { GatewayConnectionView } from './gateway-connection-view';

export type ConnectionState =
  | { kind: 'unconfigured' }
  | { kind: 'token-invalid' }
  | { kind: 'initializing' }
  | { kind: 'ok-lan'; latencyMs?: number }
  | { kind: 'ok-tunnel'; latencyMs?: number }
  | { kind: 'ok-direct'; latencyMs?: number }
  | { kind: 'degraded-tunnel-only'; tunnelLatencyMs?: number }
  | { kind: 'offline-network' }
  | { kind: 'offline-device'; httpStatus?: number }
  | { kind: 'no-route' };

export type ConnectionSeverity = 'ok' | 'warn' | 'error' | 'pending' | 'idle';

export function severityForConnectionState(state: ConnectionState): ConnectionSeverity {
  switch (state.kind) {
    case 'ok-lan':
    case 'ok-tunnel':
    case 'ok-direct':
      return 'ok';
    case 'degraded-tunnel-only':
      return 'warn';
    case 'token-invalid':
    case 'offline-network':
    case 'offline-device':
    case 'no-route':
      return 'error';
    case 'initializing':
      return 'pending';
    case 'unconfigured':
      return 'idle';
  }
}

export type RouteReachabilityForState = {
  status: 'reachable' | 'unreachable' | 'checking' | 'not_configured';
  reason?: string;
  httpStatus?: number;
  latencyMs?: number;
};

export type DeriveConnectionStateInput = {
  configured: boolean;
  unauthorized: boolean;
  gatewayOnline: boolean;
  view: GatewayConnectionView;
  reachability: { lan: RouteReachabilityForState; tunnel: RouteReachabilityForState };
  reachabilityChecking: boolean;
  networkOffline: boolean;
};

export function deriveConnectionState(input: DeriveConnectionStateInput): ConnectionState {
  if (!input.configured) return { kind: 'unconfigured' };
  if (input.unauthorized) return { kind: 'token-invalid' };

  const lan = input.reachability.lan;
  const tunnel = input.reachability.tunnel;
  const lanOk = lan.status === 'reachable';
  const tunnelOk = tunnel.status === 'reachable';
  const lanDown = lan.status === 'unreachable';
  const tunnelDown = tunnel.status === 'unreachable';
  const probing =
    lan.status === 'checking' || tunnel.status === 'checking' || input.reachabilityChecking;

  if (lanOk && input.view.connectionKind === 'lan') {
    return { kind: 'ok-lan', latencyMs: lan.latencyMs };
  }
  // Degraded supersedes ok-tunnel: LAN was supposed to work here but doesn't,
  // so we surface the downgrade even though tunnel is fine. Without this the
  // user would silently accept higher latency every time they're on a network
  // where their gateway used to be reachable.
  if (tunnelOk && lanDown && input.view.hasLanFallback) {
    return { kind: 'degraded-tunnel-only', tunnelLatencyMs: tunnel.latencyMs };
  }
  if (tunnelOk && input.view.connectionKind === 'tunnel') {
    return { kind: 'ok-tunnel', latencyMs: tunnel.latencyMs };
  }
  if (input.view.connectionKind === 'direct' && (lanOk || tunnelOk)) {
    return { kind: 'ok-direct', latencyMs: tunnel.latencyMs ?? lan.latencyMs };
  }

  if (
    input.gatewayOnline &&
    (input.view.connectionKind === 'lan' || input.view.connectionKind === 'tunnel')
  ) {
    if (input.view.connectionKind === 'lan') return { kind: 'ok-lan' };
    if (input.view.connectionKind === 'tunnel') return { kind: 'ok-tunnel' };
  }

  if (probing) return { kind: 'initializing' };

  if (input.networkOffline) return { kind: 'offline-network' };

  if (
    lanDown &&
    tunnel.status === 'unreachable' &&
    typeof tunnel.httpStatus === 'number' &&
    tunnel.httpStatus >= 502
  ) {
    return { kind: 'offline-device', httpStatus: tunnel.httpStatus };
  }
  if (lanDown && tunnelDown) return { kind: 'no-route' };

  return { kind: 'initializing' };
}
