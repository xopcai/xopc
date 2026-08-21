export const DISCOVERY_SOURCE_ALL = 'all';
export const DISCOVERY_SOURCE_BUILTIN = 'builtin';
export const COMPOSIO_CONNECTOR_SOURCE = 'composio';
export const STORE_CONNECTOR_SOURCE = 'xopc-store';

export type ConnectorDiscoveryEntry = 'default' | 'personal-context';

/**
 * Start from the local catalog so Composio credentials can be collected by the
 * connector install dialog before any authenticated remote catalog request.
 */
export function connectorDiscoverySourceForEntry(
  _entry: ConnectorDiscoveryEntry,
): typeof DISCOVERY_SOURCE_BUILTIN {
  return DISCOVERY_SOURCE_BUILTIN;
}
