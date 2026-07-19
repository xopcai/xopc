import type { ConnectorDefinition, ConnectorInstance } from '../connectors-api';

export type ConnectorBenefit = 'understand' | 'act' | 'reach';

export const CONNECTOR_BENEFIT_ORDER: ConnectorBenefit[] = ['understand', 'act', 'reach'];

export function connectorBenefitFor(connector: ConnectorDefinition): ConnectorBenefit {
  const capabilities = new Set(connector.capabilities);
  const searchable = [connector.id, connector.displayName, ...(connector.tags ?? [])].join(' ').toLowerCase();

  if (
    capabilities.has('channel')
    || capabilities.has('events')
    || /slack|telegram|discord|teams|mail|message|wechat|weixin/.test(searchable)
  ) return 'reach';

  if (
    capabilities.has('context')
    || capabilities.has('memory_source')
    || capabilities.has('resources')
    || connector.category === 'docs'
    || connector.category === 'data'
    || /notion|drive|document|confluence|airtable|database|knowledge|wiki/.test(searchable)
  ) return 'understand';

  return 'act';
}

export function groupConnectorsByBenefit(connectors: ConnectorDefinition[]): Record<ConnectorBenefit, ConnectorDefinition[]> {
  return connectors.reduce<Record<ConnectorBenefit, ConnectorDefinition[]>>((groups, connector) => {
    groups[connectorBenefitFor(connector)].push(connector);
    return groups;
  }, { understand: [], act: [], reach: [] });
}

export function connectorFirstValue(
  instance: ConnectorInstance,
  definition?: ConnectorDefinition,
): { benefit: ConnectorBenefit; state: 'ready' | 'checking' | 'needs_setup'; availableCount?: number } {
  const benefit = definition ? connectorBenefitFor(definition) : 'act';
  const ready = instance.connectionStatus === 'connected'
    || instance.status === 'connected'
    || instance.usage.lastHealthStatus === 'ok';
  const needsSetup = instance.status === 'not_configured'
    || instance.status === 'failed'
    || instance.status === 'unauthorized'
    || instance.connectionStatus === 'unauthorized'
    || instance.connectionStatus === 'error';
  const availableCount = benefit === 'understand'
    ? instance.usage.lastResourceCount
    : benefit === 'act'
      ? instance.usage.lastToolCount
      : undefined;
  return { benefit, state: ready ? 'ready' : needsSetup ? 'needs_setup' : 'checking', availableCount };
}
