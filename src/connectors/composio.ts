import { CredentialResolver } from '../auth/credentials.js';
import type { Config } from '../config/schema.js';
import { consumeConnectorSetupSecretRef } from './setup-secrets.js';
import type { ConnectorDefinition } from './types.js';

export type ComposioConnection = {
  id: string;
  toolkit: string;
  status: string;
  accountEmail?: string;
  workspace?: string;
  username?: string;
};

export type ComposioScope = 'read' | 'write' | 'admin';

export type ComposioTool = {
  slug: string;
  name?: string;
  description?: string;
  inputSchema?: unknown;
  scope: ComposioScope;
  curated: boolean;
};

const COMPOSIO_TOOLKITS = [
  ['gmail', 'Gmail', 'Read and send Gmail messages through Composio.'],
  ['googlecalendar', 'Google Calendar', 'Read and manage Google Calendar events through Composio.'],
  ['googledrive', 'Google Drive', 'Search and manage Google Drive files through Composio.'],
  ['notion', 'Notion', 'Search and update Notion pages and databases through Composio.'],
  ['slack', 'Slack', 'Read and send Slack workspace messages through Composio.'],
  ['github', 'GitHub via Composio', 'Work with GitHub repositories, issues, and pull requests through Composio.'],
  ['linear', 'Linear via Composio', 'Manage Linear issues and projects through Composio.'],
] as const;

const COMPOSIO_API_KEY_PROVIDER = 'connector-composio-api-key';
const COMPOSIO_SCOPE_ORDER: Record<ComposioScope, number> = { read: 1, write: 2, admin: 3 };

const COMPOSIO_CURATED_ACTIONS: Record<string, Record<string, ComposioScope>> = {
  gmail: {
    GMAIL_FETCH_EMAILS: 'read',
    GMAIL_GET_EMAIL: 'read',
    GMAIL_LIST_LABELS: 'read',
    GMAIL_SEND_EMAIL: 'write',
    GMAIL_CREATE_EMAIL_DRAFT: 'write',
    GMAIL_REPLY_TO_THREAD: 'write',
    GMAIL_TRASH_EMAIL: 'admin',
  },
  googlecalendar: {
    GOOGLECALENDAR_FIND_EVENT: 'read',
    GOOGLECALENDAR_LIST_EVENTS: 'read',
    GOOGLECALENDAR_CREATE_EVENT: 'write',
    GOOGLECALENDAR_UPDATE_EVENT: 'write',
    GOOGLECALENDAR_DELETE_EVENT: 'admin',
  },
  googledrive: {
    GOOGLEDRIVE_SEARCH_FILES: 'read',
    GOOGLEDRIVE_GET_FILE: 'read',
    GOOGLEDRIVE_CREATE_FILE: 'write',
    GOOGLEDRIVE_UPDATE_FILE: 'write',
    GOOGLEDRIVE_DELETE_FILE: 'admin',
  },
  notion: {
    NOTION_SEARCH: 'read',
    NOTION_FETCH_PAGE: 'read',
    NOTION_CREATE_PAGE: 'write',
    NOTION_UPDATE_PAGE: 'write',
  },
  slack: {
    SLACK_LIST_CHANNELS: 'read',
    SLACK_FETCH_CONVERSATION_HISTORY: 'read',
    SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL: 'write',
    SLACK_SEND_DIRECT_MESSAGE: 'write',
  },
  github: {
    GITHUB_GET_REPOSITORY: 'read',
    GITHUB_LIST_REPOSITORY_ISSUES: 'read',
    GITHUB_CREATE_AN_ISSUE: 'write',
    GITHUB_CREATE_PULL_REQUEST: 'write',
  },
  linear: {
    LINEAR_LIST_ISSUES: 'read',
    LINEAR_GET_ISSUE: 'read',
    LINEAR_CREATE_ISSUE: 'write',
    LINEAR_UPDATE_ISSUE: 'write',
  },
};

function composioBaseUrl(): string {
  return process.env.XOPC_COMPOSIO_BASE_URL?.trim().replace(/\/+$/, '') || 'https://backend.composio.dev/api/v3';
}

async function composioApiKey(resolver = new CredentialResolver()): Promise<string> {
  const stored = await resolver.resolveApiKey(COMPOSIO_API_KEY_PROVIDER).catch(() => undefined);
  const key = stored?.trim() || process.env.XOPC_COMPOSIO_API_KEY?.trim() || process.env.COMPOSIO_API_KEY?.trim();
  if (!key) {
    throw new Error('Composio API key is not configured. Set XOPC_COMPOSIO_API_KEY or connect the Composio API Key connector.');
  }
  return key;
}

async function composioFetch(path: string, init: RequestInit = {}, resolver = new CredentialResolver()): Promise<unknown> {
  const apiKey = await composioApiKey(resolver);
  const response = await fetch(`${composioBaseUrl()}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      Authorization: `Bearer ${apiKey}`,
      ...(init.headers ?? {}),
    },
  });
  const data = await response.json().catch(async () => ({ error: await response.text().catch(() => response.statusText) }));
  if (!response.ok) {
    const record = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};
    throw new Error(String(record.error ?? record.message ?? response.statusText));
  }
  return data;
}

function arrayAt(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeToolkit(toolkit: string): string {
  return toolkit.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '');
}

export function toolkitFromComposioSlug(slug: string): string | undefined {
  const upper = slug.trim().toUpperCase();
  if (!upper) return undefined;
  if (upper.startsWith('GOOGLECALENDAR_')) return 'googlecalendar';
  if (upper.startsWith('GOOGLEDRIVE_')) return 'googledrive';
  const prefix = upper.split('_')[0]?.toLowerCase();
  return prefix || undefined;
}

export function scopeForComposioAction(slug: string): { toolkit?: string; scope: ComposioScope; curated: boolean } {
  const toolkit = toolkitFromComposioSlug(slug);
  if (!toolkit) return { scope: 'write', curated: false };
  const scope = COMPOSIO_CURATED_ACTIONS[toolkit]?.[slug.trim().toUpperCase()];
  if (scope) return { toolkit, scope, curated: true };
  return { toolkit, scope: 'write', curated: false };
}

export function getComposioToolkitScope(config: Config | undefined, toolkit: string): ComposioScope {
  const record = config?.connectors?.instances?.[`composio-${normalizeToolkit(toolkit)}`];
  const raw = record && typeof record === 'object' && !Array.isArray(record)
    ? (record as Record<string, unknown>).scope
    : undefined;
  return raw === 'admin' || raw === 'write' || raw === 'read' ? raw : 'read';
}

export function setComposioToolkitScope(config: Config, toolkit: string, scope: ComposioScope): void {
  const instanceId = `composio-${normalizeToolkit(toolkit)}`;
  const record = config.connectors?.instances?.[instanceId];
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error(`Composio connector is not installed: ${toolkit}`);
  }
  (record as Record<string, unknown>).scope = scope;
}

export function canUseComposioAction(config: Config | undefined, slug: string): { ok: true; toolkit?: string; scope: ComposioScope } | { ok: false; reason: string; toolkit?: string; scope: ComposioScope } {
  const action = scopeForComposioAction(slug);
  if (!action.toolkit) return { ok: false, reason: `Unknown Composio toolkit for action: ${slug}`, scope: action.scope };
  const installed = config?.connectors?.instances?.[`composio-${action.toolkit}`];
  if (!installed) return { ok: false, reason: `Composio connector is not installed: ${action.toolkit}`, toolkit: action.toolkit, scope: action.scope };
  const allowedScope = getComposioToolkitScope(config, action.toolkit);
  if (COMPOSIO_SCOPE_ORDER[allowedScope] < COMPOSIO_SCOPE_ORDER[action.scope]) {
    return { ok: false, reason: `Composio action ${slug} requires ${action.scope} scope; connector allows ${allowedScope}.`, toolkit: action.toolkit, scope: action.scope };
  }
  if (!action.curated && allowedScope !== 'admin') {
    return { ok: false, reason: `Composio action ${slug} is not in the curated allowlist. Set connector scope to admin to allow uncurated actions.`, toolkit: action.toolkit, scope: action.scope };
  }
  return { ok: true, toolkit: action.toolkit, scope: action.scope };
}

export const COMPOSIO_CONNECTORS: readonly ConnectorDefinition[] = [
  {
    id: 'composio-api-key',
    version: '1.0.0',
    displayName: 'Composio API Key',
    description: 'Store a Composio API key for direct-mode toolkit connectors.',
    category: 'automation',
    kind: 'composio',
    source: 'builtin',
    capabilities: ['auth.apiKey', 'tools', 'events', 'workflows'],
    tags: ['composio', 'oauth', 'integrations'],
    auth: { mode: 'apiKey' },
    setup: {
      secrets: [{ key: 'COMPOSIO_API_KEY', label: 'Composio API key', required: true }],
    },
    runtime: { type: 'composio', toolkit: 'composio' },
  },
  ...COMPOSIO_TOOLKITS.map(([toolkit, displayName, description]) => ({
    id: `composio-${toolkit}`,
    version: '1.0.0',
    displayName,
    description,
    category: 'automation' as const,
    kind: 'composio' as const,
    source: 'builtin' as const,
    capabilities: ['tools', 'auth.oauth', 'events', 'workflows'] as ConnectorDefinition['capabilities'],
    tags: ['composio', toolkit],
    auth: { mode: 'none' as const },
    setup: {},
    runtime: { type: 'composio' as const, toolkit },
  })),
];

export async function saveComposioApiKey(input: { secrets?: Record<string, unknown> }, resolver = new CredentialResolver()): Promise<void> {
  const raw = input.secrets?.COMPOSIO_API_KEY;
  const resolved = typeof raw === 'string' && raw.trim().startsWith('secret://')
    ? consumeConnectorSetupSecretRef(raw)
    : raw;
  if (typeof resolved === 'string' && resolved.trim()) {
    await resolver.saveApiKey(COMPOSIO_API_KEY_PROVIDER, resolved.trim(), { profileName: 'default' });
  }
}

export async function listComposioConnections(resolver = new CredentialResolver()): Promise<ComposioConnection[]> {
  const payload = await composioFetch('/connected_accounts', {}, resolver);
  return arrayAt(payload, ['items', 'connected_accounts', 'connections', 'data']).flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const toolkit = readString(row.toolkit_slug ?? row.toolkit ?? row.appName ?? row.app_name);
    const id = readString(row.id ?? row.uuid ?? row.connectedAccountId ?? row.connected_account_id);
    if (!toolkit || !id) return [];
    return [{
      id,
      toolkit,
      status: readString(row.status) ?? 'unknown',
      accountEmail: readString(row.accountEmail ?? row.account_email ?? row.email),
      workspace: readString(row.workspace ?? row.teamName ?? row.team_name),
      username: readString(row.username ?? row.name),
    }];
  });
}

export async function startComposioAuthorize(toolkit: string, resolver = new CredentialResolver()): Promise<{ toolkit: string; connectUrl: string; connectionId?: string }> {
  const payload = await composioFetch('/connected_accounts', {
    method: 'POST',
    body: JSON.stringify({ toolkit_slug: toolkit, toolkit, auth_config: {} }),
  }, resolver);
  const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  const connectUrl = readString(record.redirect_url ?? record.redirectUrl ?? record.connect_url ?? record.connectUrl);
  if (!connectUrl) {
    throw new Error('Composio authorize did not return a connect URL.');
  }
  return { toolkit, connectUrl, connectionId: readString(record.id ?? record.connectionId ?? record.connected_account_id) };
}

export async function listComposioTools(toolkit: string, config?: Config, resolver = new CredentialResolver()): Promise<ComposioTool[]> {
  const path = `/tools?toolkit_slug=${encodeURIComponent(toolkit)}`;
  const payload = await composioFetch(path, {}, resolver);
  return arrayAt(payload, ['items', 'tools', 'data']).flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const slug = readString(row.slug ?? row.name);
    if (!slug) return [];
    const action = scopeForComposioAction(slug);
    const allowed = config ? canUseComposioAction(config, slug).ok : true;
    if (!allowed) return [];
    return [{
      slug,
      name: readString(row.name),
      description: readString(row.description),
      inputSchema: row.inputSchema ?? row.input_schema ?? row.parameters,
      scope: action.scope,
      curated: action.curated,
    }];
  });
}

export async function executeComposioTool(params: { slug: string; arguments?: unknown; config?: Config }, resolver = new CredentialResolver()): Promise<unknown> {
  const allowed = canUseComposioAction(params.config, params.slug);
  if (allowed.ok === false) {
    throw new Error(allowed.reason);
  }
  return composioFetch(`/tools/${encodeURIComponent(params.slug)}/execute`, {
    method: 'POST',
    body: JSON.stringify({ arguments: params.arguments ?? {} }),
  }, resolver);
}
