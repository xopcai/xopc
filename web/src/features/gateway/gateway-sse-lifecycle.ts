import { GatewaySseConnection } from '@/features/gateway/gateway-sse-connection';
import { dispatchGatewaySseEvent } from '@/features/gateway/dispatch-sse-event';
import { registerGatewaySseConnection } from '@/features/gateway/sse-controller';
import { setSseConnectionState } from '@/stores/gateway-sse-store';

/** Start `/api/events` SSE; returns teardown. Lives outside hooks so effect bodies stay lean. */
export function startGatewaySseConnection(token: string): () => void {
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
}

export function stopGatewaySseConnection(): void {
  registerGatewaySseConnection(null);
  setSseConnectionState({ connectionState: 'disconnected', error: null, reconnectAttempt: 0 });
}
