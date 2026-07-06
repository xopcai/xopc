import { useEffect } from 'react';

import { useGatewayConfigured } from '../../query/sessions';
import { useGatewayStore } from '../../stores/gateway-store';
import { resolveEffectiveGatewayBaseUrl } from '../../stores/gateway-types';

import { recordConnectionEvent } from './connection-log';
import { GatewaySseConnection } from './gateway-sse-connection';
import { setSseStatus } from './sse-status';

let sharedConnection: GatewaySseConnection | null = null;
let sharedConnectionKey = '';
let subscriberCount = 0;
let disconnectTimer: ReturnType<typeof setTimeout> | null = null;

function createGatewaySseConnection(): GatewaySseConnection {
  return new GatewaySseConnection({
    onConnected: () => {
      setSseStatus('connected');
      recordConnectionEvent({ kind: 'sse', ok: true, message: 'connected' });
    },
    onReconnecting: () => {
      setSseStatus('reconnecting');
    },
    onDisconnected: () => {
      setSseStatus('reconnecting');
    },
    onError: (msg) => {
      setSseStatus('failed');
      recordConnectionEvent({ kind: 'sse', ok: false, message: msg });
    },
  });
}

function acquireSharedConnection(connectionKey: string): void {
  subscriberCount += 1;
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }

  if (sharedConnection && sharedConnectionKey === connectionKey) return;

  sharedConnection?.disconnect();
  sharedConnection = createGatewaySseConnection();
  sharedConnectionKey = connectionKey;
  setSseStatus('connecting');
  sharedConnection.connect();
}

function releaseSharedConnection(): void {
  subscriberCount = Math.max(0, subscriberCount - 1);
  if (subscriberCount > 0 || disconnectTimer) return;

  disconnectTimer = setTimeout(() => {
    disconnectTimer = null;
    if (subscriberCount > 0) return;
    sharedConnection?.disconnect();
    sharedConnection = null;
    sharedConnectionKey = '';
    setSseStatus('idle');
  }, 250);
}

/**
 * Keeps a single SSE connection to `GET /api/events` while the app is configured (web parity).
 */
export function useGatewaySse(): void {
  const configured = useGatewayConfigured();
  const token = useGatewayStore((s) => s.token);
  const gatewayEndpoint = useGatewayStore((s) =>
    resolveEffectiveGatewayBaseUrl({
      activeBaseUrl: s.activeBaseUrl,
      baseUrl: s.baseUrl,
      lanUrl: s.lanUrl,
    }),
  );

  useEffect(() => {
    if (!configured || !token || !gatewayEndpoint) {
      releaseSharedConnection();
      return;
    }

    acquireSharedConnection(`${gatewayEndpoint}|${token}`);
    return () => releaseSharedConnection();
  }, [configured, token, gatewayEndpoint]);
}

export function getSharedGatewaySseConnection(): GatewaySseConnection | null {
  return sharedConnection;
}
