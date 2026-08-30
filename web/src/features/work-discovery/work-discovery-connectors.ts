import type { ConnectorDefinition } from '@/features/connectors/connectors-api';

const POPULAR_TOOLKITS = ['gmail', 'googlecalendar', 'googledrive'] as const;
const UNDERSTANDING_TOOLKIT_ORDER = [...POPULAR_TOOLKITS, 'github', 'linear'] as const;

function onboardingConnector({
  toolkit,
  displayName,
  description,
  category,
  mode,
  bootstrapWindowDays,
  logoFileName = toolkit,
}: {
  toolkit: string;
  displayName: string;
  description: string;
  category: ConnectorDefinition['category'];
  mode: NonNullable<ConnectorDefinition['understanding']>['mode'];
  bootstrapWindowDays: number;
  logoFileName?: string;
}): ConnectorDefinition {
  return {
    id: `composio-${toolkit}`,
    version: 'sessions-v1',
    displayName,
    description,
    category,
    kind: 'composio',
    source: 'registry',
    capabilities: ['tools', 'auth.oauth', 'events', 'workflows', 'context', 'memory_source'],
    benefits: ['understand', 'act'],
    understanding: { mode, bootstrapWindowDays, readOnly: true },
    tags: ['composio', toolkit, 'verified'],
    branding: {
      logoUrl: `/connector-icons/${logoFileName}.svg`,
      source: 'builtin',
    },
    verificationLevel: 'verified',
    auth: { mode: 'oauth', provider: 'composio' },
    setup: {},
    runtime: { type: 'composio', toolkit, role: 'toolkit' },
    integrationStrategy: { lane: 'composio', workload: 'long_tail', preferred: true },
  };
}

export const ONBOARDING_CONNECTOR_FALLBACKS: ConnectorDefinition[] = [
  onboardingConnector({
    toolkit: 'gmail',
    displayName: 'Gmail',
    description: 'Find and understand recent email, then draft or send with your approval.',
    category: 'automation',
    mode: 'activity',
    bootstrapWindowDays: 30,
  }),
  onboardingConnector({
    toolkit: 'googlecalendar',
    displayName: 'Google Calendar',
    description: 'Understand your schedule and work with approved calendar events.',
    category: 'automation',
    mode: 'activity',
    bootstrapWindowDays: 90,
    logoFileName: 'google-calendar',
  }),
  onboardingConnector({
    toolkit: 'googledrive',
    displayName: 'Google Drive',
    description: 'Search and understand approved files in Google Drive.',
    category: 'data',
    mode: 'inventory',
    bootstrapWindowDays: 90,
    logoFileName: 'google-drive',
  }),
  onboardingConnector({
    toolkit: 'github',
    displayName: 'GitHub',
    description: 'Understand repositories, issues, pull requests, and reviews.',
    category: 'code',
    mode: 'activity',
    bootstrapWindowDays: 90,
  }),
  onboardingConnector({
    toolkit: 'linear',
    displayName: 'Linear',
    description: 'Understand and work with Linear issues and projects.',
    category: 'code',
    mode: 'activity',
    bootstrapWindowDays: 60,
  }),
];

export function toolkitFor(connector: ConnectorDefinition): string {
  return connector.runtime.type === 'composio' && connector.runtime.role === 'toolkit'
    ? connector.runtime.toolkit.toLocaleLowerCase()
    : '';
}

export function sortUnderstandingConnectors(connectors: ConnectorDefinition[]): ConnectorDefinition[] {
  const order = new Map<string, number>(UNDERSTANDING_TOOLKIT_ORDER.map((toolkit, index) => [toolkit, index]));
  return connectors
    .filter((connector) => connector.understanding != null && toolkitFor(connector))
    .sort((left, right) => (
      (order.get(toolkitFor(left)) ?? Number.MAX_SAFE_INTEGER)
      - (order.get(toolkitFor(right)) ?? Number.MAX_SAFE_INTEGER)
      || left.displayName.localeCompare(right.displayName)
    ));
}

export function mergeUnderstandingConnectors(
  fallbackConnectors: ConnectorDefinition[],
  catalogConnectors: ConnectorDefinition[],
): ConnectorDefinition[] {
  const merged = new Map(fallbackConnectors.map((connector) => [connector.id, connector]));
  for (const connector of catalogConnectors) merged.set(connector.id, connector);
  return sortUnderstandingConnectors([...merged.values()]);
}
