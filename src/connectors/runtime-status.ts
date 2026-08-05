import type { ConnectorConnection, ConnectorInstance } from './types.js';

export function projectComposioConnectionStatus(
  instances: ConnectorInstance[],
  connections: ConnectorConnection[],
): ConnectorInstance[] {
  return instances.map((instance) => {
    if (instance.materialized.type !== 'composio' || instance.materialized.role !== 'toolkit' || !instance.enabled) {
      return instance;
    }
    const relevant = connections.filter((connection) => (
      connection.provider === 'composio'
      && connection.connectorId === instance.connectorId
      && connection.status !== 'revoked'
    ));
    const active = relevant.filter((connection) => connection.status === 'active');
    const lastConnectedAt = active
      .flatMap((connection) => connection.connectedAt ? [connection.connectedAt] : [])
      .sort()
      .at(-1) ?? instance.lastConnectedAt;

    if (active.length > 0) {
      return {
        ...instance,
        status: 'connected',
        connectionStatus: 'connected',
        authStatus: 'connected',
        lastConnectedAt,
        lastError: undefined,
      };
    }

    if (relevant.some((connection) => connection.status === 'pending')) {
      return { ...instance, status: 'connecting', connectionStatus: 'connecting', authStatus: 'unknown' };
    }
    if (relevant.some((connection) => connection.status === 'expired')) {
      return { ...instance, status: 'unauthorized', connectionStatus: 'unauthorized', authStatus: 'expired' };
    }
    if (relevant.some((connection) => connection.status === 'failed')) {
      return { ...instance, status: 'failed', connectionStatus: 'error', authStatus: 'unauthorized' };
    }
    return { ...instance, status: 'not_configured', connectionStatus: 'disconnected', authStatus: 'missing' };
  });
}
