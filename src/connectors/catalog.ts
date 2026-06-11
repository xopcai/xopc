import { listConnectorProviderDefinitions, listConnectorProviders } from './providers.js';
import type { ConnectorDefinition } from './types.js';

const CONNECTOR_BY_ID = new Map(listConnectorProviderDefinitions().map((connector) => [connector.id, connector]));

export function listConnectorCatalog(): ConnectorDefinition[] {
  return listConnectorProviderDefinitions().sort((left, right) => left.displayName.localeCompare(right.displayName));
}

export function getConnectorDefinition(connectorId: string): ConnectorDefinition | undefined {
  return CONNECTOR_BY_ID.get(connectorId);
}

export { listConnectorProviders };
