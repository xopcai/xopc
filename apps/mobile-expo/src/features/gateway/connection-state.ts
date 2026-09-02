import { useGatewayStore } from '../../stores/gateway-store';
import { getNetworkSnapshot } from './network-info';
import { useGatewayHealth } from './use-gateway-health';

export type ConnectionState =
  | { kind: 'unconfigured' }
  | { kind: 'ok-direct'; latencyMs?: number }
  | { kind: 'offline-network' }
  | { kind: 'no-route' }
  | { kind: 'token-invalid' };
export type ConnectionSeverity = 'idle' | 'ok' | 'warn' | 'error' | 'pending';

export function severityForConnectionState(state: ConnectionState): ConnectionSeverity {
  if (state.kind === 'ok-direct') return 'ok';
  if (state.kind === 'unconfigured') return 'idle';
  if (state.kind === 'token-invalid') return 'error';
  return 'warn';
}

export function useConnectionState(): ConnectionState {
  const configured = useGatewayStore((state) => state.getActiveProfile() !== null);
  const unauthorized = useGatewayStore((state) => state.unauthorized);
  const { gatewayOnline } = useGatewayHealth();
  if (!configured) return { kind: 'unconfigured' };
  if (unauthorized) return { kind: 'token-invalid' };
  if (getNetworkSnapshot().kind === 'offline') return { kind: 'offline-network' };
  return gatewayOnline ? { kind: 'ok-direct' } : { kind: 'no-route' };
}

export type ConnectionStateCopy = { short: string; long: string; detail?: string; actionLabel?: string };

export function copyForConnectionState(state: ConnectionState, m: {
  okDirect: string;
  offlineNetworkShort: string; offlineNetworkLong: string;
  noRouteShort: string; noRouteLong: string;
  tokenInvalidShort: string; tokenInvalidLong: string;
  unconfiguredShort: string; unconfiguredLong: string;
  retry: string; reconnect: string; openSettings: string;
}): ConnectionStateCopy {
  switch (state.kind) {
    case 'unconfigured': return { short: m.unconfiguredShort, long: m.unconfiguredLong, actionLabel: m.openSettings };
    case 'ok-direct': return { short: m.okDirect, long: m.okDirect };
    case 'offline-network': return { short: m.offlineNetworkShort, long: m.offlineNetworkLong, actionLabel: m.retry };
    case 'no-route': return { short: m.noRouteShort, long: m.noRouteLong, actionLabel: m.retry };
    case 'token-invalid': return { short: m.tokenInvalidShort, long: m.tokenInvalidLong, actionLabel: m.reconnect };
  }
}
