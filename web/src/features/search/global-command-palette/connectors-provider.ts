import type { NavigateFunction } from 'react-router-dom';

import type {
  ConnectorDefinition,
  ConnectorInstance,
} from '@/features/connectors/connectors-api';
import { isProductConnector } from '@/features/connectors/utils/connector-filters';
import type { GlobalHit } from '@/features/search/global-command-palette/types';

export type ConnectorPaletteLabels = {
  group: string;
  builtin: string;
  connected: string;
  installed: string;
  needsSetup: string;
  disabled: string;
};

function instanceStatus(
  instance: ConnectorInstance,
  labels: ConnectorPaletteLabels,
): string {
  if (!instance.enabled || instance.status === 'disabled') return labels.disabled;
  if (
    instance.status === 'failed'
    || instance.status === 'degraded'
    || instance.status === 'not_configured'
    || instance.status === 'unauthorized'
    || instance.connectionStatus === 'error'
    || instance.connectionStatus === 'unauthorized'
  ) return labels.needsSetup;
  if (instance.status === 'connected' || instance.connectionStatus === 'connected') {
    return labels.connected;
  }
  return labels.installed;
}

function definitionKeywords(definition: ConnectorDefinition | undefined): string[] {
  if (!definition) return [];
  return [
    definition.id,
    definition.description,
    definition.category,
    definition.kind,
    ...(definition.tags ?? []),
    ...definition.capabilities,
    ...(definition.benefits ?? []),
  ];
}

function subtitle(status: string, description: string | undefined): string {
  return description ? `${status} · ${description}` : status;
}

export function buildConnectorHits(args: {
  query: string;
  catalog: ConnectorDefinition[];
  instances: ConnectorInstance[];
  labels: ConnectorPaletteLabels;
  navigate: NavigateFunction;
  close: () => void;
}): Array<Omit<GlobalHit, 'rank'>> {
  if (!args.query.trim()) return [];

  const definitions = new Map(args.catalog.map((definition) => [definition.id, definition]));
  const installedConnectorIds = new Set(args.instances.map((instance) => instance.connectorId));

  const installedHits: Array<Omit<GlobalHit, 'rank'>> = args.instances.map((instance) => {
    const definition = definitions.get(instance.connectorId);
    return {
      kind: 'connector',
      id: `connector-instance:${instance.instanceId}`,
      title: instance.displayName,
      subtitle: subtitle(instanceStatus(instance, args.labels), definition?.description),
      groupLabel: args.labels.group,
      keywords: [
        instance.connectorId,
        instance.instanceId,
        instance.materialized.type,
        ...definitionKeywords(definition),
      ],
      run: () => {
        args.close();
        args.navigate(`/capabilities/connectors?instance=${encodeURIComponent(instance.instanceId)}&tab=connected`);
      },
    };
  });

  const builtinHits: Array<Omit<GlobalHit, 'rank'>> = args.catalog.flatMap((definition) => {
    if (
      definition.source !== 'builtin'
      || definition.integrationStrategy?.preferred === false
      || !isProductConnector(definition)
      || installedConnectorIds.has(definition.id)
    ) return [];

    return [{
      kind: 'connector',
      id: `connector:${definition.id}`,
      title: definition.displayName,
      subtitle: subtitle(args.labels.builtin, definition.description),
      groupLabel: args.labels.group,
      keywords: definitionKeywords(definition),
      run: () => {
        args.close();
        args.navigate(`/capabilities/connectors?connector=${encodeURIComponent(definition.id)}&tab=discover`);
      },
    }];
  });

  return [...installedHits, ...builtinHits];
}
