import type { Config } from '../config/schema.js';

import { startComposioAuthorize } from './composio.js';
import { getConnectorInstance } from './instances.js';
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
): Promise<ConnectorAuthStartResult> {
  if (
    definition.auth.mode !== 'oauth'
    || definition.auth.provider !== 'composio'
    || definition.runtime.type !== 'composio'
    || definition.runtime.role !== 'toolkit'
  ) {
    throw new Error(`Connector "${definition.id}" does not support Composio authorization.`);
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
