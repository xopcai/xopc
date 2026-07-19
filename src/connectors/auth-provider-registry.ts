import { startComposioAuthorize } from './composio.js';
import type { ConnectorDefinition } from './types.js';

export type ConnectorAuthStartResult = {
  connectorId: string;
  provider: string;
  status: string;
  authorizationUrl?: string;
  connectionId?: string;
};

export async function startConnectorAuthorization(definition: ConnectorDefinition): Promise<ConnectorAuthStartResult> {
  if (
    definition.auth.mode !== 'oauth'
    || definition.auth.provider !== 'composio'
    || definition.runtime.type !== 'composio'
    || definition.runtime.role !== 'toolkit'
  ) {
    throw new Error(`Connector "${definition.id}" does not support Composio authorization.`);
  }
  const authorization = await startComposioAuthorize(definition.id, definition.runtime.toolkit);
  return {
    connectorId: definition.id,
    provider: 'composio',
    status: 'pending',
    authorizationUrl: authorization.connectUrl,
    connectionId: authorization.connectionId,
  };
}
