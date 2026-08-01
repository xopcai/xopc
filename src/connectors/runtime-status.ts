import type { ConnectorConnection, ConnectorInstance } from './types.js';

export type ComposioRuntimeProbe = {
  connectorId: string;
  checkedAt: string;
  toolCount?: number;
  error?: string;
  connectionError?: boolean;
};

export function projectComposioRuntimeStatus(
  instances: ConnectorInstance[],
  connections: ConnectorConnection[],
  probes: ComposioRuntimeProbe[],
): ConnectorInstance[] {
  const probeByConnectorId = new Map(probes.map((probe) => [probe.connectorId, probe]));
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
    const probe = probeByConnectorId.get(instance.connectorId);
    const lastConnectedAt = active
      .flatMap((connection) => connection.connectedAt ? [connection.connectedAt] : [])
      .sort()
      .at(-1) ?? instance.lastConnectedAt;

    if (active.length > 0 && probe && !probe.error && (probe.toolCount ?? 0) > 0) {
      return {
        ...instance,
        status: 'connected',
        connectionStatus: 'connected',
        authStatus: 'connected',
        lastConnectedAt,
        lastError: undefined,
        usage: {
          ...instance.usage,
          lastHealthCheckAt: probe.checkedAt,
          lastHealthStatus: 'ok',
          lastToolCount: probe.toolCount,
        },
      };
    }

    if (active.length > 0 && probe) {
      const error = probe.error ?? 'The connection did not expose any usable tools.';
      return {
        ...instance,
        status: 'degraded',
        connectionStatus: probe.connectionError ? 'error' : 'connected',
        authStatus: 'connected',
        lastConnectedAt,
        lastError: error,
        usage: {
          ...instance.usage,
          lastHealthCheckAt: probe.checkedAt,
          lastHealthStatus: probe.connectionError ? 'network_failed' : 'tools_list_failed',
          lastToolCount: probe.toolCount ?? 0,
        },
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
