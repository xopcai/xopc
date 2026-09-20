import { BUILTIN_CONNECTORS } from './builtin-catalog.js';
import { CHINA_CONNECTORS } from './china-catalog.js';
import { COMPOSIO_CONNECTORS } from './composio.js';
import type { ConnectorDefinition } from './types.js';

export type ConnectorProvider = {
  id: string;
  displayName: string;
  listConnectors(): readonly ConnectorDefinition[];
};

export const builtinConnectorProvider: ConnectorProvider = {
  id: 'builtin',
  displayName: 'Built-in connectors',
  listConnectors() {
    return BUILTIN_CONNECTORS;
  },
};

export const composioConnectorProvider: ConnectorProvider = {
  id: 'composio',
  displayName: 'Composio connectors',
  listConnectors() {
    return COMPOSIO_CONNECTORS;
  },
};

export const chinaConnectorProvider: ConnectorProvider = {
  id: 'china',
  displayName: 'China connectors',
  listConnectors() {
    return CHINA_CONNECTORS;
  },
};

const CONNECTOR_PROVIDERS: readonly ConnectorProvider[] = [
  builtinConnectorProvider,
  chinaConnectorProvider,
  composioConnectorProvider,
];

export function listConnectorProviders(): ConnectorProvider[] {
  return [...CONNECTOR_PROVIDERS];
}

export function listConnectorProviderDefinitions(): ConnectorDefinition[] {
  return CONNECTOR_PROVIDERS.flatMap((provider) => provider.listConnectors());
}
