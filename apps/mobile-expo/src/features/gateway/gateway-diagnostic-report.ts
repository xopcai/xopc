import type { ConnectionState } from './connection-state-derive';

export type GatewayDiagnosticAction =
  | 'continue'
  | 'retry'
  | 're_pair'
  | 'start_gateway'
  | 'check_network';

export type GatewayDiagnosticReport = {
  state: ConnectionState['kind'];
  action: GatewayDiagnosticAction;
  isBlocking: boolean;
};

export function gatewayDiagnosticReport(state: ConnectionState): GatewayDiagnosticReport {
  switch (state.kind) {
    case 'ok-lan':
    case 'ok-tunnel':
    case 'ok-direct':
    case 'degraded-tunnel-only':
      return { state: state.kind, action: 'continue', isBlocking: false };
    case 'token-invalid':
    case 'unconfigured':
      return { state: state.kind, action: 're_pair', isBlocking: true };
    case 'offline-network':
      return { state: state.kind, action: 'check_network', isBlocking: true };
    case 'offline-device':
    case 'no-route':
      return { state: state.kind, action: 'start_gateway', isBlocking: true };
    case 'initializing':
      return { state: state.kind, action: 'retry', isBlocking: false };
  }
}
