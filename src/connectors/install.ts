import { CredentialResolver } from '../auth/credentials.js';
import type { Config } from '../config/schema.js';
import { getConnectorDefinition } from './catalog.js';
import { listConnectorInstances } from './instances.js';
import { isManagedConnectorServer, materializeConnectorMcpServer } from './materialize.js';
import { saveComposioApiKey } from './composio.js';
import { assertConnectorOAuthReady } from './oauth.js';
import { saveConnectorSecrets } from './secret-store.js';
import { appendConnectorAuditRecord } from './usage.js';
import type { ConnectorDefinition, ConnectorInstallInput, ConnectorInstance } from './types.js';

export async function installConnectorDefinition(
  config: Config,
  definition: ConnectorDefinition,
  input: ConnectorInstallInput,
  resolver = new CredentialResolver(),
): Promise<ConnectorInstance> {
  if (definition.runtime.type !== 'mcp') {
    const instanceId = definition.id;
    if (definition.runtime.type === 'composio' && definition.id === 'composio-api-key') {
      await saveComposioApiKey(input, resolver);
    }
    config.connectors = config.connectors ?? {};
    config.connectors.instances = {
      ...(config.connectors.instances ?? {}),
      [instanceId]: {
        xopcConnector: {
          managed: true,
          connectorId: definition.id,
          version: definition.version,
          enabled: true,
          displayName: definition.displayName,
        },
        runtime: definition.runtime,
        ...(definition.runtime.type === 'composio' && definition.runtime.toolkit !== 'composio' ? { scope: 'read' } : {}),
      },
    };
    const instance = listConnectorInstances(config).find((candidate) => candidate.instanceId === instanceId);
    if (!instance) {
      throw new Error(`Connector "${definition.id}" was installed but could not be resolved.`);
    }
    return instance;
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
    throw new Error(`Connector "${definition.id}" was installed but could not be resolved.`);
  }
  appendConnectorAuditRecord(config, serverId, { action: 'installed' });
  return instance;
}

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
  return installConnectorDefinition(config, definition, input, resolver);
}

export function uninstallConnector(config: Config, instanceId: string): ConnectorInstance {
  const server = config.mcp?.servers?.[instanceId];
  const connectorRecord = config.connectors?.instances?.[instanceId];
  if (!server && !connectorRecord) {
    throw new Error(`Connector instance not found: ${instanceId}`);
  }
  if (server && !isManagedConnectorServer(server)) {
    throw new Error(`MCP server "${instanceId}" is not managed by Connectors.`);
  }

  const instance = listConnectorInstances(config).find((candidate) => candidate.instanceId === instanceId);
  if (!instance) {
    throw new Error(`Connector instance not found: ${instanceId}`);
  }
  appendConnectorAuditRecord(config, instanceId, { action: 'removed' });

  if (server) {
    const nextServers = { ...(config.mcp?.servers ?? {}) };
    delete nextServers[instanceId];
    config.mcp = {
      ...(config.mcp ?? {}),
      servers: nextServers,
    };
  }
  if (connectorRecord) {
    const nextInstances = { ...(config.connectors?.instances ?? {}) };
    delete nextInstances[instanceId];
    config.connectors = { ...(config.connectors ?? {}), instances: nextInstances };
  }
  return instance;
}
