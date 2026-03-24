import { useEffect } from 'react';

import { GatewaySseConnection } from '@/features/gateway/gateway-sse-connection';
import { dispatchGatewaySseEvent } from '@/features/gateway/dispatch-sse-event';
import { registerGatewaySseConnection } from '@/features/gateway/sse-controller';
import { setSseConnectionState } from '@/stores/gateway-sse-store';
import { useGatewayStore } from '@/stores/gateway-store';

/**
 * Keeps a single SSE connection to `/api/events` while the app is mounted (parity with `ui` ChatConnection).
 */
export function useGatewaySse(): void {
  const token = useGatewayStore((s) => s.token);

  useEffect(() => {
    const config = { token, autoReconnect: true, maxReconnectAttempts: 10 };

    const conn = new GatewaySseConnection(config, {
      onConnected: () => {
        setSseConnectionState({ connectionState: 'connected', error: null, reconnectAttempt: 0 });
      },
      onReconnecting: () => {
        setSseConnectionState({ connectionState: 'reconnecting' });
      },
      onDisconnected: () => {
        setSseConnectionState({ connectionState: 'disconnected' });
      },
      onError: (msg) => {
        setSseConnectionState({ connectionState: 'error', error: msg });
      },
      onEvent: (evt, data) => {
        dispatchGatewaySseEvent(evt, data);
      },
    });

    registerGatewaySseConnection(conn);
    setSseConnectionState({ connectionState: 'connecting', error: null });
    conn.connect();

    return () => {
      conn.disconnect();
      registerGatewaySseConnection(null);
      setSseConnectionState({ connectionState: 'disconnected', error: null });
    };
  }, [token]);
}
