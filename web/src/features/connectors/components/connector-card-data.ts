import type { ConnectorDefinition, ConnectorInstance } from '../connectors-api';

export const CONNECTOR_SKELETON_KEYS = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'] as const;

export function connectorIsInstalled(
  connector: ConnectorDefinition,
  instances: ConnectorInstance[],
): boolean {
  return instances.some((instance) => instance.connectorId === connector.id);
}
