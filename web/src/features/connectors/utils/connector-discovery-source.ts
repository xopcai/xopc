export const DISCOVERY_SOURCE_RECOMMENDED = 'recommended';
export const DISCOVERY_SOURCE_ALL = 'all';
export const DISCOVERY_SOURCE_BUILTIN = 'builtin';
export const COMPOSIO_CONNECTOR_SOURCE = 'composio';
export const STORE_CONNECTOR_SOURCE = 'xopc-store';

export type ConnectorDiscoveryEntry = 'default' | 'understanding';

/** Keep understanding setup explicit; Chinese discovery starts with Store recommendations. */
export function connectorDiscoverySourceForEntry(
  entry: ConnectorDiscoveryEntry,
  language = 'en',
): typeof DISCOVERY_SOURCE_BUILTIN | typeof DISCOVERY_SOURCE_RECOMMENDED {
  return entry === 'default' && language.startsWith('zh') ? DISCOVERY_SOURCE_RECOMMENDED : DISCOVERY_SOURCE_BUILTIN;
}
