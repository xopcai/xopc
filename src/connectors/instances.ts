import type { Config } from '../config/schema.js';
import { getConnectorDefinition } from './catalog.js';
import { isManagedConnectorServer } from './materialize.js';
import { getConnectorAuditFromMarker, getConnectorUsageFromMarker } from './usage.js';
import type { ConnectorInstance } from './types.js';

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

export function listConnectorInstances(config: Config): ConnectorInstance[] {
  const servers = config.mcp?.servers ?? {};
  return Object.entries(servers)
    .flatMap(([serverId, server]) => {
      if (!isManagedConnectorServer(server)) {
        return [];
      }
      const connectorId = server.xopcConnector.connectorId;
      const definition = getConnectorDefinition(connectorId);
      return [
        {
          instanceId: serverId,
          connectorId,
          displayName: definition?.displayName ?? connectorId,
          enabled: true,
          status: 'installed' as const,
          secretStatus: secretStatusForServer(server),
          materialized: {
            type: 'mcp' as const,
            serverId,
          },
          usage: getConnectorUsageFromMarker(server.xopcConnector),
          audit: getConnectorAuditFromMarker(server.xopcConnector),
        },
      ];
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

export function getConnectorInstance(config: Config, instanceId: string): ConnectorInstance | undefined {
  return listConnectorInstances(config).find((instance) => instance.instanceId === instanceId);
}
