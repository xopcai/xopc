import type { Config } from '../config/schema.js';
import { getConnectorDefinition } from './catalog.js';
import { isManagedConnectorServer } from './materialize.js';
import { getConnectorAuditFromMarker, getConnectorUsageFromMarker } from './usage.js';
import type { ConnectorInstance } from './types.js';

function readMarkerConfig(marker: unknown): Record<string, unknown> | undefined {
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return undefined;
  const config = (marker as Record<string, unknown>).config;
  return config && typeof config === 'object' && !Array.isArray(config)
    ? config as Record<string, unknown>
    : undefined;
}

function secretStatusForServer(server: Record<string, unknown>): Record<string, boolean> {
  const marker = server.xopcConnector as { connectorId?: string } | undefined;
  const definition = marker?.connectorId ? getConnectorDefinition(marker.connectorId) : undefined;
  const env = server.env && typeof server.env === 'object' && !Array.isArray(server.env)
    ? (server.env as Record<string, unknown>)
    : {};
  const status: Record<string, boolean> = {};
  for (const secret of definition?.setup.secrets ?? []) {
    const value = env[secret.key];
    status[secret.key] = Boolean(
      value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        'xopcSecretRef' in value,
    );
  }
  return status;
}

function connectorInstanceFromRecord(instanceId: string, record: Record<string, unknown>): ConnectorInstance[] {
  const marker = record.xopcConnector;
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return [];
  const markerRecord = marker as Record<string, unknown>;
  if (markerRecord.managed !== true || typeof markerRecord.connectorId !== 'string') return [];
  const connectorId = markerRecord.connectorId;
  const definition = getConnectorDefinition(connectorId);
  const runtime = record.runtime && typeof record.runtime === 'object' && !Array.isArray(record.runtime)
    ? record.runtime as Record<string, unknown>
    : {};
  const runtimeType = runtime.type;
  if (
    runtimeType !== 'composio' &&
    runtimeType !== 'channel' &&
    runtimeType !== 'nativeTool' &&
    runtimeType !== 'memorySource'
  ) return [];
  if (
    runtimeType === 'composio' &&
    (typeof runtime.toolkit !== 'string' || (runtime.role !== 'credential' && runtime.role !== 'toolkit'))
  ) return [];
  const enabled = markerRecord.enabled !== false;
  return [{
    instanceId,
    connectorId,
    displayName: definition?.displayName ?? (typeof markerRecord.displayName === 'string' ? markerRecord.displayName : connectorId),
    enabled,
    status: enabled ? 'installed' : 'disabled',
    connectionStatus: enabled ? 'unknown' : 'disabled',
    authStatus: definition?.auth.mode === 'none' ? 'none' : 'unknown',
    lastConnectedAt: typeof markerRecord.lastConnectedAt === 'string' ? markerRecord.lastConnectedAt : undefined,
    lastError: typeof markerRecord.lastError === 'string' ? markerRecord.lastError : undefined,
    secretStatus: {},
    config: readMarkerConfig(markerRecord),
    materialized: runtimeType === 'composio'
      ? {
          type: 'composio',
          id: instanceId,
          toolkit: runtime.toolkit as string,
          role: runtime.role as 'credential' | 'toolkit',
        }
      : runtimeType === 'channel'
        ? { type: 'channel', id: instanceId }
        : runtimeType === 'nativeTool'
          ? { type: 'nativeTool', id: instanceId }
          : { type: 'memorySource', id: instanceId },
    usage: getConnectorUsageFromMarker(marker),
    audit: getConnectorAuditFromMarker(marker),
  }];
}

export function listConnectorInstances(config: Config): ConnectorInstance[] {
  const servers = config.mcp?.servers ?? {};
  const mcpInstances = Object.entries(servers)
    .flatMap(([serverId, server]) => {
      if (!isManagedConnectorServer(server)) {
        return [];
      }
      const connectorId = server.xopcConnector.connectorId;
      const definition = getConnectorDefinition(connectorId);
      const enabled = server.xopcConnector.enabled !== false;
      const usage = getConnectorUsageFromMarker(server.xopcConnector);
      const lastHealthStatus = usage.lastHealthStatus;
      const connectionStatus: ConnectorInstance['connectionStatus'] = !enabled
        ? 'disabled'
        : lastHealthStatus === 'ok'
          ? 'connected'
          : lastHealthStatus === 'unauthorized'
            ? 'unauthorized'
            : lastHealthStatus
              ? 'error'
              : 'unknown';
      const authStatus: ConnectorInstance['authStatus'] = definition?.auth.mode === 'none'
        ? 'none'
        : lastHealthStatus === 'missing_secret'
          ? 'missing'
          : lastHealthStatus === 'unauthorized'
            ? 'unauthorized'
            : 'unknown';
      const status: ConnectorInstance['status'] = enabled ? (lastHealthStatus === 'ok' ? 'connected' : 'installed') : 'disabled';
      return [
        {
          instanceId: serverId,
          connectorId,
          displayName: definition?.displayName ?? server.xopcConnector.displayName ?? connectorId,
          enabled,
          status,
          connectionStatus,
          authStatus,
          lastConnectedAt: server.xopcConnector.lastConnectedAt,
          lastError: server.xopcConnector.lastError,
          secretStatus: secretStatusForServer(server),
          config: readMarkerConfig(server.xopcConnector),
          materialized: {
            type: 'mcp' as const,
            serverId,
          },
          usage,
          audit: getConnectorAuditFromMarker(server.xopcConnector),
        },
      ];
    });
  const genericInstances = Object.entries(config.connectors?.instances ?? {})
    .flatMap(([instanceId, record]) => (
      record && typeof record === 'object' && !Array.isArray(record)
        ? connectorInstanceFromRecord(instanceId, record as Record<string, unknown>)
        : []
    ));
  return [...mcpInstances, ...genericInstances]
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

export function getConnectorInstance(config: Config, instanceId: string): ConnectorInstance | undefined {
  return listConnectorInstances(config).find((instance) => instance.instanceId === instanceId);
}
