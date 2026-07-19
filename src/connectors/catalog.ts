import { listConnectorProviderDefinitions, listConnectorProviders } from './providers.js';
import { getCachedConnectorCatalogEntry, listCachedConnectorCatalogEntries } from '../storage/sqlite/connector-repository.js';
import { isXopcDatabaseOpen } from '../storage/sqlite/connection.js';
import type { ConnectorDefinition } from './types.js';

const CONNECTOR_BY_ID = new Map(listConnectorProviderDefinitions().map((connector) => [connector.id, connector]));

export function listConnectorCatalog(): ConnectorDefinition[] {
  const cached = isXopcDatabaseOpen()
    ? listCachedConnectorCatalogEntries().map((entry) => entry.definition)
    : [];
  const definitions = [...cached, ...listConnectorProviderDefinitions()];
  return [...new Map(definitions.map((connector) => [connector.id, connector])).values()]
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

export function getConnectorDefinition(connectorId: string): ConnectorDefinition | undefined {
  const providerDefinition = CONNECTOR_BY_ID.get(connectorId);
  if (providerDefinition || !isXopcDatabaseOpen()) return providerDefinition;
  const cached = getCachedConnectorCatalogEntry(connectorId)?.definition;
  return cached;
}

export { listConnectorProviders };
