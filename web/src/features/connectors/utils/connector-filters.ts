import type { ConnectorDefinition, ConnectorInstance } from '../connectors-api';
import type { McpServerRow } from '../mcp/mcp-config-api';

type ConnectorSort = 'name' | 'source';

export function isProductConnector(connector: ConnectorDefinition): boolean {
  return !(connector.runtime.type === 'composio' && connector.runtime.role === 'credential');
}

function connectorMatchesQuery(connector: ConnectorDefinition, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [
    connector.displayName,
    connector.description,
    connector.category,
    connector.kind,
    connector.source,
    ...(connector.tags ?? []),
  ].some((value) => value.toLowerCase().includes(normalized));
}

export function filterAndSortConnectors(
  connectors: ConnectorDefinition[],
  query: string,
  sort: ConnectorSort,
): ConnectorDefinition[] {
  return connectors
    .filter((connector) => connectorMatchesQuery(connector, query))
    .toSorted((a, b) => {
      if (sort === 'source' && a.source !== b.source) return a.source.localeCompare(b.source);
      return a.displayName.localeCompare(b.displayName);
    });
}

export function installedConnectorMatchesQuery(instance: ConnectorInstance, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [
    instance.displayName,
    instance.connectorId,
    instance.instanceId,
    instance.status,
    instance.connectionStatus ?? '',
    instance.materialized.type,
    instance.materialized.type === 'mcp' ? instance.materialized.serverId : instance.materialized.id,
  ].some((value) => value.toLowerCase().includes(normalized));
}

export function customServerMatchesQuery(row: McpServerRow, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [row.id, row.command ?? '', row.url ?? '', row.transport].some((value) => value.toLowerCase().includes(normalized));
}
