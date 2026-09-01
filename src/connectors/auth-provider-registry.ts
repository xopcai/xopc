import type { Config } from '../config/schema.js';
import { getMcpOAuthManager } from '../agent/mcp/oauth/mcp-oauth-manager.js';

import { startComposioAuthorize } from './composio.js';
import { getConnectorInstance } from './instances.js';
import { isManagedConnectorServer } from './materialize.js';
import type { ConnectorDefinition } from './types.js';

export type ConnectorAuthStartResult = {
  connectorId: string;
  provider: string;
  status: string;
  authorizationUrl?: string;
  connectionId?: string;
};

export async function startConnectorAuthorization(
  definition: ConnectorDefinition,
  config?: Config,
  instanceId?: string,
): Promise<ConnectorAuthStartResult> {
  if (definition.auth.mode !== 'oauth') {
    throw new Error(`Connector "${definition.id}" does not use OAuth.`);
  }
  if (definition.runtime.type === 'mcp') {
    if (!config) throw new Error('Connector configuration is required for MCP authorization.');
    const serverId = instanceId ?? definition.runtime.serverId;
    const server = config.mcp?.servers?.[serverId];
    if (!server) throw new Error(`Connector MCP server not found: ${serverId}`);
    if (!isManagedConnectorServer(server) || server.xopcConnector.connectorId !== definition.id) {
      throw new Error(`MCP server "${serverId}" is not managed by connector "${definition.id}".`);
    }
    const status = await getMcpOAuthManager().start({ serverId, rawServer: server, cfg: config });
    return {
      connectorId: definition.id,
      provider: 'mcp',
      status: status.status,
      authorizationUrl: status.session?.authorizationUrl,
    };
  }
  if (
    definition.auth.provider !== 'composio'
    || definition.runtime.type !== 'composio'
    || definition.runtime.role !== 'toolkit'
  ) {
    throw new Error(`Connector "${definition.id}" does not support OAuth authorization.`);
  }
  const configuredAuthConfigId = config
    ? getConnectorInstance(config, definition.id)?.config?.authConfigId
    : undefined;
  const authConfigId = typeof configuredAuthConfigId === 'string' && configuredAuthConfigId.trim()
    ? configuredAuthConfigId.trim()
    : undefined;
  const authorization = await startComposioAuthorize(
    definition.id,
    definition.runtime.toolkit,
    undefined,
    authConfigId,
  );
  return {
    connectorId: definition.id,
    provider: 'composio',
    status: 'pending',
    authorizationUrl: authorization.connectUrl,
    connectionId: authorization.connectionId,
  };
}
