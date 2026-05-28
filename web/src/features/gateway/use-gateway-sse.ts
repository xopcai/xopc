import { useEffect } from 'react';

import { startGatewaySseConnection, stopGatewaySseConnection } from '@/features/gateway/gateway-sse-lifecycle';
import { useGatewayStore } from '@/stores/gateway-store';

/**
 * Keeps a single SSE connection to `/api/events` while the app is mounted (parity with `ui` ChatConnection).
 */
export function useGatewaySse(): void {
  const token = useGatewayStore((s) => s.token);

  useEffect(() => {
    if (!token) {
      stopGatewaySseConnection();
      return;
    }
    return startGatewaySseConnection(token);
  }, [token]);
}
