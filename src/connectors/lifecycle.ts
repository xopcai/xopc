import type { Config } from '../config/schema.js';
import { isManagedConnectorServer } from './materialize.js';
import type { ConnectorInstance } from './types.js';
import { getConnectorInstance } from './instances.js';

export function setConnectorEnabled(config: Config, instanceId: string, enabled: boolean): ConnectorInstance {
  const server = config.mcp?.servers?.[instanceId];
  const connectorRecord = config.connectors?.instances?.[instanceId];
  if (!server && !connectorRecord) {
    throw new Error(`Connector instance not found: ${instanceId}`);
  }
  if (server) {
    if (!isManagedConnectorServer(server)) {
      throw new Error(`MCP server "${instanceId}" is not managed by Connectors.`);
    }
    server.xopcConnector.enabled = enabled;
  } else if (connectorRecord && typeof connectorRecord === 'object' && !Array.isArray(connectorRecord)) {
    const marker = (connectorRecord as Record<string, unknown>).xopcConnector;
    if (!marker || typeof marker !== 'object' || Array.isArray(marker)) {
      throw new Error(`Connector instance "${instanceId}" is not managed by Connectors.`);
    }
    (marker as Record<string, unknown>).enabled = enabled;
  }
  const instance = getConnectorInstance(config, instanceId);
  if (!instance) {
    throw new Error(`Connector instance not found: ${instanceId}`);
  }
  return instance;
}
