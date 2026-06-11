import { CredentialResolver } from '../auth/credentials.js';
import type { Config } from '../config/schema.js';
import { getConnectorDefinition } from './catalog.js';
import { listConnectorInstances } from './instances.js';
import { isManagedConnectorServer, materializeConnectorMcpServer } from './materialize.js';
import { assertConnectorOAuthReady } from './oauth.js';
import { saveConnectorSecrets } from './secret-store.js';
import { appendConnectorAuditRecord } from './usage.js';
import type { ConnectorInstallInput, ConnectorInstance } from './types.js';

export async function installConnector(
  config: Config,
  connectorId: string,
  input: ConnectorInstallInput,
  resolver = new CredentialResolver(),
): Promise<ConnectorInstance> {
  const definition = getConnectorDefinition(connectorId);
  if (!definition) {
    throw new Error(`Unknown connector: ${connectorId}`);
  }

  const { serverId, server } = materializeConnectorMcpServer(definition, input);
  const existingServer = config.mcp?.servers?.[serverId];
  if (existingServer && !isManagedConnectorServer(existingServer)) {
    throw new Error(`MCP server "${serverId}" already exists and is not managed by Connectors.`);
  }

  await assertConnectorOAuthReady(definition, resolver);
  await saveConnectorSecrets(definition, input, resolver);

  config.mcp = config.mcp ?? {};
  config.mcp.servers = {
    ...(config.mcp.servers ?? {}),
    [serverId]: server,
  };

  const instance = listConnectorInstances(config).find((candidate) => candidate.instanceId === serverId);
  if (!instance) {
    throw new Error(`Connector "${connectorId}" was installed but could not be resolved.`);
  }
  appendConnectorAuditRecord(config, serverId, { action: 'installed' });
  return instance;
}

export function uninstallConnector(config: Config, instanceId: string): ConnectorInstance {
  const server = config.mcp?.servers?.[instanceId];
  if (!server) {
    throw new Error(`Connector instance not found: ${instanceId}`);
  }
  if (!isManagedConnectorServer(server)) {
    throw new Error(`MCP server "${instanceId}" is not managed by Connectors.`);
  }

  const instance = listConnectorInstances(config).find((candidate) => candidate.instanceId === instanceId);
  if (!instance) {
    throw new Error(`Connector instance not found: ${instanceId}`);
  }
  appendConnectorAuditRecord(config, instanceId, { action: 'removed' });

  const nextServers = { ...(config.mcp?.servers ?? {}) };
  delete nextServers[instanceId];
  config.mcp = {
    ...(config.mcp ?? {}),
    servers: nextServers,
  };
  return instance;
}
