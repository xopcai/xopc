import {
  listCachedConnectorCatalogEntries,
  upsertConnectorCatalogEntry,
} from '../storage/sqlite/connector-repository.js';
import { ComposioSessionsAdapter, type ComposioToolkitCatalogItem } from './composio-sessions.js';
import { composioIntegrationStrategy } from './integration-strategy.js';
import type { ConnectorCategory, ConnectorDefinition, ConnectorVerificationLevel } from './types.js';

const CATALOG_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export const COMPOSIO_RECOMMENDED_TOOLKITS = [
  'gmail',
  'googlecalendar',
  'googledrive',
  'notion',
  'slack',
  'github',
  'linear',
  'outlook',
  'microsoft_teams',
  'jira',
  'dropbox',
  'todoist',
] as const;

export const COMPOSIO_AGENT_READY_TOOLKITS = [
  ...COMPOSIO_RECOMMENDED_TOOLKITS,
  'discord',
  'googledocs',
  'googlesheets',
  'trello',
  'asana',
  'clickup',
  'twitter',
  'spotify',
  'telegram',
  'whatsapp',
  'shopify',
  'stripe',
  'hubspot',
  'salesforce',
  'airtable',
  'figma',
  'youtube',
  'one_drive',
  'excel',
] as const;

export type ComposioAgentReadyToolkit = typeof COMPOSIO_AGENT_READY_TOOLKITS[number];

export const COMPOSIO_TOOLKIT_DISPLAY_NAMES: Record<ComposioAgentReadyToolkit, string> = {
  gmail: 'Gmail',
  googlecalendar: 'Google Calendar',
  googledrive: 'Google Drive',
  notion: 'Notion',
  slack: 'Slack',
  github: 'GitHub',
  linear: 'Linear via Composio',
  outlook: 'Outlook',
  microsoft_teams: 'Microsoft Teams',
  jira: 'Jira',
  dropbox: 'Dropbox',
  todoist: 'Todoist',
  discord: 'Discord',
  googledocs: 'Google Docs',
  googlesheets: 'Google Sheets',
  trello: 'Trello',
  asana: 'Asana',
  clickup: 'ClickUp',
  twitter: 'X (Twitter)',
  spotify: 'Spotify',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  shopify: 'Shopify',
  stripe: 'Stripe',
  hubspot: 'HubSpot',
  salesforce: 'Salesforce',
  airtable: 'Airtable',
  figma: 'Figma',
  youtube: 'YouTube',
  one_drive: 'OneDrive',
  excel: 'Microsoft Excel',
};

const RECOMMENDED = new Set<string>(COMPOSIO_RECOMMENDED_TOOLKITS);
const AGENT_READY = new Set<string>(COMPOSIO_AGENT_READY_TOOLKITS);

const LOCAL_TOOLKIT_LOGO_FILE_NAMES: Readonly<Record<string, string>> = {
  googlecalendar: 'google-calendar',
  googledocs: 'google-docs',
  googledrive: 'google-drive',
  googlesheets: 'google-sheets',
  microsoft_teams: 'microsoft-teams',
  one_drive: 'one-drive',
};

function composioLogoUrl(slug: string): string {
  if (AGENT_READY.has(slug)) {
    const fileName = LOCAL_TOOLKIT_LOGO_FILE_NAMES[slug] ?? slug;
    return `/connector-icons/${fileName}.svg`;
  }
  return `/connector-icons/composio/${encodeURIComponent(slug)}`;
}

const CONNECTOR_DESCRIPTIONS: Record<string, string> = {
  gmail: 'Find, draft, and send Gmail messages with explicit write confirmation.',
  googlecalendar: 'Find and manage Google Calendar events from conversations and workflows.',
  googledrive: 'Search and work with approved files in Google Drive.',
  notion: 'Search and update approved Notion pages and databases.',
  slack: 'Read conversations and send approved messages in Slack.',
  github: 'Work with repositories, issues, pull requests, and reviews on GitHub.',
  linear: 'Find and manage Linear issues and projects.',
  outlook: 'Read and send Outlook mail with account-level controls.',
  microsoft_teams: 'Read conversations and send approved Microsoft Teams messages.',
  jira: 'Find and manage Jira issues for an approved site.',
  dropbox: 'Search and work with approved Dropbox files.',
  todoist: 'Create and manage personal or team tasks in Todoist.',
  discord: 'Read conversations and send approved messages in Discord.',
  googledocs: 'Find, read, and update approved documents in Google Docs.',
  googlesheets: 'Read and update approved spreadsheets in Google Sheets.',
  trello: 'Find and manage Trello boards, lists, and cards.',
  asana: 'Find and manage Asana tasks and projects.',
  clickup: 'Find and manage ClickUp tasks, lists, and workspaces.',
  twitter: 'Search posts and publish approved updates on X.',
  spotify: 'Search Spotify and manage approved playlists and playback actions.',
  telegram: 'Read conversations and send approved Telegram messages.',
  whatsapp: 'Read conversations and send approved WhatsApp messages.',
  shopify: 'Work with Shopify products, customers, and orders.',
  stripe: 'Work with Stripe customers, payments, invoices, and subscriptions.',
  hubspot: 'Find and manage HubSpot contacts, companies, and deals.',
  salesforce: 'Find and manage approved Salesforce records and opportunities.',
  airtable: 'Read and update approved Airtable bases and records.',
  figma: 'Find Figma files, inspect project context, and manage comments.',
  youtube: 'Find and manage YouTube videos, channels, and playlists.',
  one_drive: 'Search and work with approved files in OneDrive.',
  excel: 'Read and update approved Microsoft Excel workbooks and tables.',
};

const CODE_TOOLKITS = new Set(['github', 'gitlab', 'bitbucket', 'linear', 'jira']);
const DOC_TOOLKITS = new Set(['notion', 'googledocs', 'figma']);
const DATA_TOOLKITS = new Set(['googledrive', 'dropbox', 'one_drive', 'googlesheets', 'excel', 'airtable']);

function categoryForToolkit(slug: string): ConnectorCategory {
  if (CODE_TOOLKITS.has(slug)) return 'code';
  if (DOC_TOOLKITS.has(slug)) return 'docs';
  if (DATA_TOOLKITS.has(slug)) return 'data';
  return 'automation';
}

function verificationForToolkit(slug: string): ConnectorVerificationLevel {
  if (RECOMMENDED.has(slug) || AGENT_READY.has(slug)) return 'verified';
  return 'experimental';
}

export function connectorDefinitionFromComposioToolkit(item: ComposioToolkitCatalogItem): ConnectorDefinition {
  const slug = item.slug.trim().toLowerCase();
  return {
    id: `composio-${slug}`,
    version: 'sessions-v1',
    displayName: item.name,
    description: CONNECTOR_DESCRIPTIONS[slug]
      ?? `Connect ${item.name} so agents can use approved actions on your behalf.`,
    category: categoryForToolkit(slug),
    kind: 'composio',
    source: 'builtin',
    capabilities: item.isNoAuth
      ? ['tools', 'events', 'workflows']
      : ['tools', 'auth.oauth', 'events', 'workflows'],
    tags: ['composio', slug, verificationForToolkit(slug)],
    branding: {
      logoUrl: composioLogoUrl(slug),
      source: 'composio-catalog',
      fetchedAt: new Date().toISOString(),
    },
    verificationLevel: verificationForToolkit(slug),
    auth: item.isNoAuth
      ? { mode: 'none' }
      : { mode: 'oauth', provider: 'composio' },
    setup: {},
    runtime: { type: 'composio', toolkit: slug, role: 'toolkit' },
    integrationStrategy: composioIntegrationStrategy(slug),
  };
}

export type ComposioCatalogResult = {
  connectors: ConnectorDefinition[];
  source: 'live' | 'cache';
  stale: boolean;
  fetchedAt?: string;
};

export async function listComposioConnectorCatalog(options: {
  principalId?: string;
  refresh?: boolean;
  adapter?: ComposioSessionsAdapter;
  now?: number;
} = {}): Promise<ComposioCatalogResult> {
  const now = options.now ?? Date.now();
  const cached = listCachedConnectorCatalogEntries('composio');
  const freshCached = cached.filter((entry) => !entry.expiresAt || Date.parse(entry.expiresAt) > now);
  if (!options.refresh && freshCached.length > 0) {
    return {
      connectors: freshCached.map((entry) => entry.definition),
      source: 'cache',
      stale: false,
      fetchedAt: freshCached[0]?.fetchedAt,
    };
  }

  try {
    const adapter = options.adapter ?? new ComposioSessionsAdapter();
    const toolkits = await adapter.listToolkitCatalog({ principalId: options.principalId ?? 'local-owner' });
    const fetchedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + CATALOG_CACHE_TTL_MS).toISOString();
    const connectors = toolkits.map(connectorDefinitionFromComposioToolkit);
    for (const definition of connectors) {
      upsertConnectorCatalogEntry({
        connectorId: definition.id,
        provider: 'composio',
        definition,
        fetchedAt,
        expiresAt,
      });
    }
    return { connectors, source: 'live', stale: false, fetchedAt };
  } catch (error) {
    if (cached.length === 0) throw error;
    return {
      connectors: cached.map((entry) => entry.definition),
      source: 'cache',
      stale: true,
      fetchedAt: cached[0]?.fetchedAt,
    };
  }
}
