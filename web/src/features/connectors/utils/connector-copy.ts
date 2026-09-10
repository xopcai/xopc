import type { ConnectorsSettingsMessages } from '@/i18n/messages';

import type { ConnectorDefinition } from '../connectors-api';

export function connectorDescription(
  connector: ConnectorDefinition,
  t: ConnectorsSettingsMessages,
): string {
  if (connector.runtime.type !== 'composio') return connector.description;

  const descriptions = t.connectorDescriptions as Record<string, string>;
  return descriptions[connector.runtime.toolkit.toLowerCase()] ?? connector.description;
}
