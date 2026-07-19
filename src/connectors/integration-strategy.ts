import type { ConnectorDefinition, ConnectorIntegrationStrategy } from './types.js';

const COMPOSIO_STRATEGY_OVERRIDES: Readonly<Record<string, ConnectorIntegrationStrategy>> = {
  telegram: {
    lane: 'native',
    workload: 'core',
    preferred: false,
    alternative: { kind: 'channel', id: 'telegram' },
  },
};

export function composioIntegrationStrategy(toolkit: string): ConnectorIntegrationStrategy {
  return COMPOSIO_STRATEGY_OVERRIDES[toolkit.trim().toLowerCase()] ?? {
    lane: 'composio',
    workload: 'long_tail',
    preferred: true,
  };
}

export function assertPreferredConnectorStrategy(definition: ConnectorDefinition): void {
  const strategy = definition.integrationStrategy;
  if (!strategy || strategy.preferred) return;
  const alternative = strategy.alternative;
  if (alternative?.kind === 'channel') {
    throw new Error(
      `Connector "${definition.displayName}" is reserved for the native ${alternative.id} channel. Configure it under Channels instead.`,
    );
  }
  if (alternative?.kind === 'connector') {
    throw new Error(
      `Connector "${definition.displayName}" is a fallback integration. Install the preferred MCP connector "${alternative.id}" instead.`,
    );
  }
  throw new Error(`Connector "${definition.displayName}" is not available in the preferred integration lane.`);
}
