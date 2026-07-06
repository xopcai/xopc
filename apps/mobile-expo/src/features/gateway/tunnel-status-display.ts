import type { TunnelStatusResponse } from '../../api/tunnel';
import { formatGatewayHost } from './gateway-connection-view';

export type TunnelStatusUiKey =
  | 'loading'
  | 'unavailable'
  | 'connected'
  | 'connecting'
  | 'error'
  | 'off';

export function resolveTunnelStatusUiKey(input: {
  loading: boolean;
  hasToken: boolean;
  status: TunnelStatusResponse | null;
}): TunnelStatusUiKey {
  if (!input.hasToken) return 'unavailable';
  if (input.loading && !input.status) return 'loading';
  if (!input.status) return 'unavailable';

  const { state } = input.status;
  if (state === 'connected') return 'connected';
  if (state === 'connecting' || state === 'reconnecting') return 'connecting';
  if (state === 'error') return 'error';
  return 'off';
}

export function tunnelStatusDetailLine(status: TunnelStatusResponse | null): string | undefined {
  if (!status) return undefined;
  if (status.state === 'error' && status.lastError?.trim()) {
    return status.lastError.trim();
  }
  if (status.publicUrl?.trim()) {
    return formatGatewayHost(status.publicUrl);
  }
  if (status.subdomain?.trim()) {
    return status.subdomain.trim();
  }
  return undefined;
}
