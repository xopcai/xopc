/**
 * Hook + copy mapper around the pure `deriveConnectionState`. Single derived
 * value the UI uses to decide what to show. Replaces the four independent
 * flags scattered across hooks (configured / unauthorized / gatewayOnline /
 * fullyUnreachable / connectionView.connectionKind) which each only knew
 * part of the story.
 */
import { useMemo } from 'react';

import { useGatewayStore } from '../../stores/gateway-store';

import {
  deriveConnectionState,
  severityForConnectionState,
  type ConnectionSeverity,
  type ConnectionState,
} from './connection-state-derive';
import { useGatewayConnectionView } from './use-gateway-connection-view';
import { useGatewayHealth } from './use-gateway-health';
import { getNetworkSnapshot } from './network-info';
import { useGatewayRouteReachability } from './use-gateway-route-reachability';

export type { ConnectionSeverity, ConnectionState };
export { deriveConnectionState, severityForConnectionState };

export function useConnectionState(): ConnectionState {
  const configured = useGatewayStore((s) => Boolean(s.baseUrl.trim()));
  const unauthorized = useGatewayStore((s) => s.unauthorized);
  const view = useGatewayConnectionView();
  const { gatewayOnline } = useGatewayHealth();
  const { reachability, checking } = useGatewayRouteReachability(configured);

  const networkOffline = getNetworkSnapshot().kind === 'offline';

  return useMemo(
    () =>
      deriveConnectionState({
        configured,
        unauthorized,
        gatewayOnline,
        view,
        reachability,
        reachabilityChecking: checking,
        networkOffline,
      }),
    [configured, unauthorized, gatewayOnline, view, reachability, checking, networkOffline],
  );
}

export type ConnectionStateCopy = {
  short: string;
  long: string;
  detail?: string;
  actionLabel?: string;
};

export function copyForConnectionState(
  state: ConnectionState,
  m: {
    initializing: string;
    detecting: string;
    okLan: string;
    okTunnel: string;
    okDirect: string;
    degradedTunnelOnlyShort: string;
    degradedTunnelOnlyLong: string;
    degradedRetryLan: string;
    offlineNetworkShort: string;
    offlineNetworkLong: string;
    offlineDeviceShort: string;
    offlineDeviceLong: string;
    noRouteShort: string;
    noRouteLong: string;
    tokenInvalidShort: string;
    tokenInvalidLong: string;
    unconfiguredShort: string;
    unconfiguredLong: string;
    msSuffix: string;
    retry: string;
    reconnect: string;
    openSettings: string;
  },
): ConnectionStateCopy {
  const fmtMs = (ms?: number) =>
    typeof ms === 'number' ? `${Math.max(0, Math.round(ms))}${m.msSuffix}` : '';

  switch (state.kind) {
    case 'unconfigured':
      return {
        short: m.unconfiguredShort,
        long: m.unconfiguredLong,
        actionLabel: m.openSettings,
      };
    case 'initializing':
      return { short: m.initializing, long: m.detecting };
    case 'ok-lan':
      return {
        short: m.okLan,
        long: state.latencyMs != null ? `${m.okLan} · ${fmtMs(state.latencyMs)}` : m.okLan,
      };
    case 'ok-tunnel':
      return {
        short: m.okTunnel,
        long:
          state.latencyMs != null ? `${m.okTunnel} · ${fmtMs(state.latencyMs)}` : m.okTunnel,
      };
    case 'ok-direct':
      return {
        short: m.okDirect,
        long:
          state.latencyMs != null ? `${m.okDirect} · ${fmtMs(state.latencyMs)}` : m.okDirect,
      };
    case 'degraded-tunnel-only':
      return {
        short: m.degradedTunnelOnlyShort,
        long: m.degradedTunnelOnlyLong,
        actionLabel: m.degradedRetryLan,
      };
    case 'offline-network':
      return {
        short: m.offlineNetworkShort,
        long: m.offlineNetworkLong,
        actionLabel: m.retry,
      };
    case 'offline-device':
      return {
        short: m.offlineDeviceShort,
        long: m.offlineDeviceLong,
        detail: state.httpStatus ? `HTTP ${state.httpStatus}` : undefined,
        actionLabel: m.retry,
      };
    case 'no-route':
      return { short: m.noRouteShort, long: m.noRouteLong, actionLabel: m.retry };
    case 'token-invalid':
      return {
        short: m.tokenInvalidShort,
        long: m.tokenInvalidLong,
        actionLabel: m.reconnect,
      };
  }
}
