import { CredentialResolver } from '../auth/credentials.js';
import type { Config } from '../config/schema.js';
import {
  getConnectorAccount,
  refreshConnectorAccountCurrent,
} from '../storage/sqlite/connector-account-repository.js';
import {
  getConnectorConnection,
  getConnectorInstallation,
  listConnectorConnections as listStoredConnectorConnections,
  upsertConnectorConnection,
  upsertConnectorActionMetadata,
  upsertConnectorInstallation,
} from '../storage/sqlite/connector-repository.js';
import {
  COMPOSIO_AGENT_READY_TOOLKITS,
  COMPOSIO_TOOLKIT_DISPLAY_NAMES,
  connectorDefinitionFromComposioToolkit,
} from './composio-catalog.js';
import { connectorIdentityKey } from './connector-identity.js';
import {
  ComposioSessionsAdapter,
  type ComposioToolkitAuthState,
} from './composio-sessions.js';
import { consumeConnectorSetupSecretRef } from './setup-secrets.js';
import type {
  ConnectorConfirmationPolicy,
  ConnectorConnection,
  ConnectorDefinition,
  ConnectorInstallationPolicy,
} from './types.js';

export type ComposioConnection = {
  id: string;
  accountId?: string;
  providerConnectionId: string;
  toolkit: string;
  status: string;
  alias?: string;
  isDefault: boolean;
  isCurrentAuthorization: boolean;
  accountEmail?: string;
  workspace?: string;
  username?: string;
  identityKey?: string;
  workspaceId?: string;
  userId?: string;
  connectedAt?: string;
  lastError?: string;
};

function toComposioConnection(connection: ConnectorConnection): ComposioConnection {
  const toolkit = toolkitFromConnectionMetadata(connection);
  const account = connection.accountId ? getConnectorAccount(connection.accountId) : undefined;
  return {
    id: connection.id,
    accountId: connection.accountId,
    providerConnectionId: connection.providerConnectionId,
    toolkit,
    status: connection.status,
    alias: connection.alias,
    isDefault: connection.isDefault,
    isCurrentAuthorization: account?.currentConnectionId === connection.id,
    accountEmail: typeof connection.identity.email === 'string' ? connection.identity.email : undefined,
    workspace: typeof connection.identity.workspace === 'string' ? connection.identity.workspace : undefined,
    username: typeof connection.identity.username === 'string' ? connection.identity.username : undefined,
    identityKey: connectorIdentityKey(toolkit, connection.identity),
    workspaceId: typeof connection.identity.workspaceId === 'string' ? connection.identity.workspaceId : undefined,
    userId: typeof connection.identity.userId === 'string' ? connection.identity.userId : undefined,
    connectedAt: connection.connectedAt,
    lastError: connection.lastError,
  };
}

export type ComposioScope = 'read' | 'write' | 'admin';

export type ComposioTool = {
  slug: string;
  name?: string;
  description?: string;
  inputSchema?: unknown;
  scope: ComposioScope;
  curated: boolean;
};

export type ComposioConnectorHealth = {
  toolkit: string;
  status: 'connected' | 'disconnected' | 'reauthorization_required' | 'degraded';
  activeAccounts: number;
  affectedAccounts: number;
  checkedAt: string;
  message: string;
  recovery: 'none' | 'connect' | 'reconnect' | 'retry';
  errorCode?: 'missing_credential' | 'unauthorized' | 'forbidden' | 'network' | 'timeout' | 'provider_error';
};

const COMPOSIO_API_KEY_PROVIDER = 'connector-composio-api-key';
const COMPOSIO_SCOPE_ORDER: Record<ComposioScope, number> = { read: 1, write: 2, admin: 3 };
const COMPOSIO_AGENT_READY = new Set<string>(COMPOSIO_AGENT_READY_TOOLKITS);
const STRICT_CURATED_TOOLKITS = new Set<string>(['github']);
const READ_ACTION_TOKENS = ['GET', 'LIST', 'SEARCH', 'FETCH', 'FIND', 'LOOKUP', 'RETRIEVE', 'READ', 'QUERY', 'CHECK', 'DESCRIBE', 'DOWNLOAD'];
const WRITE_ACTION_TOKENS = ['CREATE', 'UPDATE', 'SEND', 'POST', 'ADD', 'UPLOAD', 'REPLY', 'DRAFT', 'INVITE', 'ASSIGN', 'MOVE', 'COPY', 'EDIT', 'WRITE', 'PUBLISH', 'SCHEDULE'];
const ADMIN_ACTION_TOKENS = ['DELETE', 'REMOVE', 'REVOKE', 'TRASH', 'ARCHIVE', 'CANCEL', 'DISCONNECT', 'DEACTIVATE'];

const COMPOSIO_CURATED_ACTIONS: Record<string, Record<string, ComposioScope>> = {
  gmail: {
    GMAIL_GET_PROFILE: 'read',
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
    SLACK_TEST_AUTH: 'read',
    SLACK_LIST_CHANNELS: 'read',
    SLACK_FETCH_CONVERSATION_HISTORY: 'read',
    SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL: 'write',
    SLACK_SEND_DIRECT_MESSAGE: 'write',
  },
  github: {
    GITHUB_GET_THE_AUTHENTICATED_USER: 'read',
    GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER: 'read',
    GITHUB_GET_A_REPOSITORY: 'read',
    GITHUB_GET_REPOSITORY: 'read',
    GITHUB_LIST_REPOSITORY_COLLABORATORS: 'read',
    GITHUB_SEARCH_REPOSITORIES: 'read',
    GITHUB_SEARCH_CODE: 'read',
    GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS: 'read',
    GITHUB_SEARCH_USERS: 'read',
    GITHUB_LIST_REPOSITORY_ISSUES: 'read',
    GITHUB_GET_AN_ISSUE: 'read',
    GITHUB_LIST_ISSUE_COMMENTS: 'read',
    GITHUB_LIST_PULL_REQUESTS: 'read',
    GITHUB_GET_A_PULL_REQUEST: 'read',
    GITHUB_LIST_BRANCHES: 'read',
    GITHUB_GET_A_BRANCH: 'read',
    GITHUB_LIST_COMMITS: 'read',
    GITHUB_GET_A_COMMIT: 'read',
    GITHUB_CREATE_A_REPOSITORY_FOR_THE_AUTHENTICATED_USER: 'write',
    GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS: 'write',
    GITHUB_CREATE_A_COMMIT: 'write',
    GITHUB_CREATE_A_COMMIT_COMMENT: 'write',
    GITHUB_CREATE_AN_ISSUE: 'write',
    GITHUB_UPDATE_AN_ISSUE: 'write',
    GITHUB_CREATE_AN_ISSUE_COMMENT: 'write',
    GITHUB_ADD_LABELS_TO_AN_ISSUE: 'write',
    GITHUB_ADD_ASSIGNEES_TO_AN_ISSUE: 'write',
    GITHUB_CREATE_A_PULL_REQUEST: 'write',
    GITHUB_CREATE_PULL_REQUEST: 'write',
    GITHUB_UPDATE_A_PULL_REQUEST: 'write',
    GITHUB_MERGE_A_PULL_REQUEST: 'write',
    GITHUB_CREATE_A_REVIEW_FOR_A_PULL_REQUEST: 'write',
    GITHUB_CREATE_A_REVIEW_COMMENT_FOR_A_PULL_REQUEST: 'write',
    GITHUB_CREATE_A_GIST: 'write',
    GITHUB_DELETE_A_REPOSITORY: 'admin',
    GITHUB_DELETE_A_REFERENCE: 'admin',
    GITHUB_DELETE_A_FILE: 'admin',
    GITHUB_ADD_A_REPOSITORY_COLLABORATOR: 'admin',
    GITHUB_CANCEL_A_WORKFLOW_RUN: 'admin',
  },
  linear: {
    LINEAR_LIST_ISSUES: 'read',
    LINEAR_GET_ISSUE: 'read',
    LINEAR_CREATE_ISSUE: 'write',
    LINEAR_UPDATE_ISSUE: 'write',
  },
};

const LOCAL_OWNER_PRINCIPAL = 'local-owner';

function toolkitFromConnectionMetadata(connection: { id: string; metadata: Record<string, unknown> }): string {
  const toolkit = connection.metadata.toolkit;
  if (typeof toolkit !== 'string' || !toolkit.trim()) {
    throw new Error(`Composio connection "${connection.id}" does not contain toolkit metadata.`);
  }
  return toolkit;
}

function normalizeToolkit(toolkit: string): string {
  return toolkit.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '');
}

export function getConfiguredComposioAuthConfigs(
  config: Config | undefined,
  toolkits: string[],
): Record<string, string> {
  const requested = new Set(toolkits.map(normalizeToolkit));
  return Object.values(config?.connectors?.instances ?? {}).reduce<Record<string, string>>((result, record) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return result;
    const row = record as Record<string, unknown>;
    const runtime = row.runtime;
    const marker = row.xopcConnector;
    if (
      !runtime || typeof runtime !== 'object' || Array.isArray(runtime)
      || (runtime as Record<string, unknown>).type !== 'composio'
      || (runtime as Record<string, unknown>).role !== 'toolkit'
      || typeof (runtime as Record<string, unknown>).toolkit !== 'string'
      || !marker || typeof marker !== 'object' || Array.isArray(marker)
    ) return result;
    const toolkit = normalizeToolkit((runtime as Record<string, string>).toolkit);
    if (!requested.has(toolkit)) return result;
    const configValue = (marker as Record<string, unknown>).config;
    const authConfigId = configValue && typeof configValue === 'object' && !Array.isArray(configValue)
      ? (configValue as Record<string, unknown>).authConfigId
      : undefined;
    if (typeof authConfigId === 'string' && authConfigId.trim()) result[toolkit] = authConfigId.trim();
    return result;
  }, {});
}

export function toolkitFromComposioSlug(slug: string): string | undefined {
  const upper = slug.trim().toUpperCase();
  if (!upper) return undefined;
  const known = [...COMPOSIO_AGENT_READY].sort((left, right) => right.length - left.length)
    .find((toolkit) => upper === toolkit.toUpperCase() || upper.startsWith(`${toolkit.toUpperCase()}_`));
  if (known) return known;
  const prefix = upper.split('_')[0]?.toLowerCase();
  return prefix || undefined;
}

export function scopeForComposioAction(slug: string): { toolkit?: string; scope: ComposioScope; curated: boolean } {
  const toolkit = toolkitFromComposioSlug(slug);
  if (!toolkit) return { scope: 'write', curated: false };
  const scope = COMPOSIO_CURATED_ACTIONS[toolkit]?.[slug.trim().toUpperCase()];
  if (scope) return { toolkit, scope, curated: true };
  if (STRICT_CURATED_TOOLKITS.has(toolkit)) {
    return { toolkit, scope: 'write', curated: false };
  }
  if (COMPOSIO_AGENT_READY.has(toolkit)) {
    const tokens = slug.trim().toUpperCase().split('_');
    if (tokens.some((token) => ADMIN_ACTION_TOKENS.some((verb) => token.startsWith(verb)))) {
      return { toolkit, scope: 'admin', curated: true };
    }
    if (tokens.some((token) => READ_ACTION_TOKENS.some((verb) => token.startsWith(verb)))) {
      return { toolkit, scope: 'read', curated: true };
    }
    if (tokens.some((token) => WRITE_ACTION_TOKENS.some((verb) => token.startsWith(verb)))) {
      return { toolkit, scope: 'write', curated: true };
    }
  }
  return { toolkit, scope: 'write', curated: false };
}

export function isComposioActionAllowedByCatalog(slug: string): boolean {
  const action = scopeForComposioAction(slug);
  return Boolean(action.toolkit && (action.curated || !STRICT_CURATED_TOOLKITS.has(action.toolkit)));
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
  if (!isComposioActionAllowedByCatalog(slug)) {
    return {
      ok: false,
      reason: `Composio action ${slug} is not in the curated ${action.toolkit} action catalog.`,
      toolkit: action.toolkit,
      scope: action.scope,
    };
  }
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
    branding: {
      logoUrl: '/connector-icons/composio.svg',
      source: 'composio-catalog',
    },
    verificationLevel: 'verified',
    capabilities: ['auth.apiKey', 'tools', 'events', 'workflows'],
    tags: ['composio', 'oauth', 'integrations'],
    auth: { mode: 'apiKey' },
    setup: {
      secrets: [{ key: 'COMPOSIO_API_KEY', label: 'Composio API key', required: true }],
    },
    runtime: { type: 'composio', toolkit: 'composio', role: 'credential' },
    integrationStrategy: { lane: 'composio', workload: 'long_tail', preferred: true },
  },
  ...COMPOSIO_AGENT_READY_TOOLKITS.map((toolkit) => {
    const definition = connectorDefinitionFromComposioToolkit({
      slug: toolkit,
      name: COMPOSIO_TOOLKIT_DISPLAY_NAMES[toolkit],
      isNoAuth: false,
      connected: false,
    });
    return { ...definition, version: '1.0.0', source: 'builtin' as const };
  }),
];

export async function saveComposioApiKey(input: { secrets?: Record<string, unknown> }, resolver = new CredentialResolver()): Promise<void> {
  const raw = input.secrets?.COMPOSIO_API_KEY;
  const resolved = typeof raw === 'string' && raw.trim().startsWith('secret://')
    ? consumeConnectorSetupSecretRef(raw)
    : raw;
  if (typeof resolved !== 'string' || !resolved.trim()) {
    throw new Error('Composio API key is required.');
  }
  await resolver.saveApiKey(COMPOSIO_API_KEY_PROVIDER, resolved.trim(), { profileName: 'default' });
}

export async function configureComposioApiKey(apiKey: string, resolver = new CredentialResolver()): Promise<void> {
  const normalized = apiKey.trim();
  if (!normalized) throw new Error('Composio API key is required.');
  if (normalized.length > 4096) throw new Error('Composio API key is too long.');
  const validationResolver = {
    resolveApiKey: async () => normalized,
  } as unknown as CredentialResolver;
  await new ComposioSessionsAdapter({ resolver: validationResolver }).listToolkitCatalog({
    principalId: LOCAL_OWNER_PRINCIPAL,
  });
  await resolver.saveApiKey(COMPOSIO_API_KEY_PROVIDER, normalized, { profileName: 'default' });
}

export async function listComposioConnections(resolver = new CredentialResolver()): Promise<ComposioConnection[]> {
  const adapter = new ComposioSessionsAdapter({ resolver });
  await adapter.syncConnections({ principalId: LOCAL_OWNER_PRINCIPAL });
  const connections = listStoredConnectorConnections({ principalId: LOCAL_OWNER_PRINCIPAL })
    .filter((connection) => connection.provider === 'composio');
  for (const accountId of new Set(connections.flatMap((connection) => connection.accountId ? [connection.accountId] : []))) {
    refreshConnectorAccountCurrent(accountId);
  }
  return connections
    .map(toComposioConnection);
}

export async function inspectComposioConnectorHealth(toolkit: string, resolver = new CredentialResolver()): Promise<ComposioConnectorHealth> {
  const normalizedToolkit = normalizeToolkit(toolkit);
  try {
    const all = await listComposioConnections(resolver);
    const connections = all.filter((connection) => connection.toolkit.toLowerCase() === normalizedToolkit);
    const byAccount = new Map<string, ComposioConnection[]>();
    for (const connection of connections) {
      const accountId = connection.accountId ?? connection.id;
      byAccount.set(accountId, [...(byAccount.get(accountId) ?? []), connection]);
    }
    const accountStatuses = [...byAccount.values()];
    const activeAccounts = accountStatuses.filter(
      (authorizations) => authorizations.some((connection) => connection.status === 'active'),
    ).length;
    const affectedAccounts = accountStatuses.filter((authorizations) => (
      !authorizations.some((connection) => connection.status === 'active')
      && authorizations.some((connection) => connection.status === 'expired' || connection.status === 'failed')
    )).length;
    if (activeAccounts > 0) {
      return {
        toolkit: normalizedToolkit,
        status: 'connected',
        activeAccounts,
        affectedAccounts,
        checkedAt: new Date().toISOString(),
        message: `${activeAccounts} connected account${activeAccounts === 1 ? '' : 's'}.`,
        recovery: 'none',
      };
    }
    if (affectedAccounts > 0) {
      return {
        toolkit: normalizedToolkit,
        status: 'reauthorization_required',
        activeAccounts: 0,
        affectedAccounts,
        checkedAt: new Date().toISOString(),
        message: 'The account connection expired or failed and must be authorized again.',
        recovery: 'reconnect',
      };
    }
    return {
      toolkit: normalizedToolkit,
      status: 'disconnected',
      activeAccounts: 0,
      affectedAccounts: 0,
      checkedAt: new Date().toISOString(),
      message: 'No active account is connected.',
      recovery: 'connect',
    };
  } catch (error) {
    const failure = classifyComposioHealthError(error);
    return {
      toolkit: normalizedToolkit,
      status: 'degraded',
      activeAccounts: 0,
      affectedAccounts: 0,
      checkedAt: new Date().toISOString(),
      message: failure.message,
      recovery: 'retry',
      errorCode: failure.code,
    };
  }
}

export async function getComposioToolkitAuthState(
  toolkit: string,
  resolver = new CredentialResolver(),
): Promise<ComposioToolkitAuthState> {
  return new ComposioSessionsAdapter({ resolver }).getToolkitAuthState(normalizeToolkit(toolkit));
}

function classifyComposioHealthError(error: unknown): {
  code: NonNullable<ComposioConnectorHealth['errorCode']>;
  message: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  if (/api key is not configured|missing.*api key/i.test(message)) {
    return { code: 'missing_credential', message };
  }
  if (/\b401\b|unauthori[sz]ed|invalid api key|authentication failed/i.test(message)) {
    return { code: 'unauthorized', message: 'Composio rejected the configured project API key.' };
  }
  if (/\b403\b|forbidden|insufficient permission|permission denied/i.test(message)) {
    return { code: 'forbidden', message: 'The Composio project API key does not have the required permissions.' };
  }
  if (/timed?\s*out|timeout|aborterror/i.test(message)) {
    return { code: 'timeout', message: 'The Composio health request timed out.' };
  }
  if (/fetch failed|network|econn|enotfound|eai_again|socket|tls/i.test(message)) {
    return { code: 'network', message: 'The gateway could not reach the Composio API.' };
  }
  return { code: 'provider_error', message };
}

export function getComposioInstallationPolicy(config: Config | undefined, toolkit: string): ConnectorInstallationPolicy {
  const normalizedToolkit = normalizeToolkit(toolkit);
  const connectorId = `composio-${normalizedToolkit}`;
  const id = `${connectorId}-${LOCAL_OWNER_PRINCIPAL}`;
  const existing = getConnectorInstallation(id);
  return upsertConnectorInstallation({
    id,
    connectorId,
    principalId: LOCAL_OWNER_PRINCIPAL,
    enabled: existing?.enabled ?? true,
    allowedAgentIds: existing?.allowedAgentIds ?? [],
    maxScope: getComposioToolkitScope(config, normalizedToolkit),
    confirmationPolicy: existing?.confirmationPolicy ?? 'writes',
    selectedConnectionIds: existing?.selectedConnectionIds ?? [],
    createdAt: existing?.createdAt,
  });
}

export function updateComposioInstallationPolicy(
  config: Config | undefined,
  toolkit: string,
  patch: { allowedAgentIds?: string[]; confirmationPolicy?: ConnectorConfirmationPolicy; selectedConnectionIds?: string[] },
): ConnectorInstallationPolicy {
  const current = getComposioInstallationPolicy(config, toolkit);
  return upsertConnectorInstallation({
    ...current,
    allowedAgentIds: patch.allowedAgentIds ?? current.allowedAgentIds,
    confirmationPolicy: patch.confirmationPolicy ?? current.confirmationPolicy,
    selectedConnectionIds: patch.selectedConnectionIds ?? current.selectedConnectionIds,
  });
}

export function updateComposioConnection(
  id: string,
  patch: { alias?: string; isDefault?: boolean },
): ComposioConnection {
  const connection = getConnectorConnection(id);
  if (!connection || connection.provider !== 'composio' || connection.principalId !== LOCAL_OWNER_PRINCIPAL) {
    throw new Error('Composio connection not found.');
  }
  upsertConnectorConnection({
    ...connection,
    alias: patch.alias === undefined ? connection.alias : patch.alias.trim() || undefined,
    isDefault: patch.isDefault ?? connection.isDefault,
  });
  const updated = getConnectorConnection(id)!;
  return toComposioConnection(updated);
}

export async function refreshComposioConnection(id: string, resolver = new CredentialResolver()): Promise<void> {
  const connection = getConnectorConnection(id);
  if (!connection || connection.provider !== 'composio' || connection.principalId !== LOCAL_OWNER_PRINCIPAL) {
    throw new Error('Composio connection not found.');
  }
  await new ComposioSessionsAdapter({ resolver }).refreshConnection(connection);
}

export async function revokeComposioConnection(id: string, resolver = new CredentialResolver()): Promise<void> {
  const connection = getConnectorConnection(id);
  if (!connection || connection.provider !== 'composio' || connection.principalId !== LOCAL_OWNER_PRINCIPAL) {
    throw new Error('Composio connection not found.');
  }
  await new ComposioSessionsAdapter({ resolver }).revokeConnection(connection);
  if (connection.accountId) refreshConnectorAccountCurrent(connection.accountId);
}

export async function startComposioAuthorize(
  connectorId: string,
  toolkit: string,
  resolver = new CredentialResolver(),
  authConfigId?: string,
): Promise<{ toolkit: string; connectUrl: string; connectionId?: string }> {
  const normalizedToolkit = normalizeToolkit(toolkit);
  const authorization = await new ComposioSessionsAdapter({ resolver }).authorize({
    principalId: LOCAL_OWNER_PRINCIPAL,
    toolkit: normalizedToolkit,
    authConfigId,
    installationId: getConnectorInstallation(`${connectorId}-${LOCAL_OWNER_PRINCIPAL}`)?.id,
  });
  if (!authorization.connectUrl) {
    throw new Error('Composio authorize did not return a connect URL.');
  }
  return {
    toolkit: authorization.toolkit,
    connectUrl: authorization.connectUrl,
    connectionId: authorization.connectionId,
  };
}

export async function listComposioTools(toolkit: string, config?: Config, resolver = new CredentialResolver()): Promise<ComposioTool[]> {
  const normalizedToolkit = normalizeToolkit(toolkit);
  const session = await new ComposioSessionsAdapter({ resolver }).createSession({
    principalId: LOCAL_OWNER_PRINCIPAL,
    toolkits: [normalizedToolkit],
    authConfigs: getConfiguredComposioAuthConfigs(config, [normalizedToolkit]),
  });
  const payload = await session.search({
    query: `List the available ${normalizedToolkit} actions and their exact input contracts.`,
    toolkits: [normalizedToolkit],
  });
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const schemas = (payload as Record<string, unknown>).toolSchemas;
  if (!schemas || typeof schemas !== 'object' || Array.isArray(schemas)) return [];
  return Object.values(schemas).flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    const slug = typeof row.toolSlug === 'string' ? row.toolSlug : undefined;
    if (!slug) return [];
    const action = scopeForComposioAction(slug);
    if (config && !canUseComposioAction(config, slug).ok) return [];
    const inputSchema = row.inputSchema;
    upsertConnectorActionMetadata({
      connectorId: `composio-${normalizedToolkit}`,
      actionId: slug,
      toolkit: normalizedToolkit,
      scope: action.scope,
      curated: action.curated,
      inputSchema,
      cachedAt: new Date().toISOString(),
    });
    return [{
      slug,
      name: slug,
      description: typeof row.description === 'string' ? row.description : undefined,
      inputSchema,
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
  if (!allowed.toolkit) throw new Error(`Unknown Composio toolkit for action: ${params.slug}`);
  const connectorId = `composio-${allowed.toolkit}`;
  const installation = upsertConnectorInstallation({
    id: `${connectorId}-${LOCAL_OWNER_PRINCIPAL}`,
    connectorId,
    principalId: LOCAL_OWNER_PRINCIPAL,
    enabled: true,
    allowedAgentIds: [],
    maxScope: getComposioToolkitScope(params.config, allowed.toolkit),
    confirmationPolicy: 'writes',
    selectedConnectionIds: [],
  });
  const connection = listStoredConnectorConnections({
    principalId: LOCAL_OWNER_PRINCIPAL,
    connectorId,
  }).find((candidate) => candidate.status === 'active' && candidate.isDefault)
    ?? listStoredConnectorConnections({ principalId: LOCAL_OWNER_PRINCIPAL, connectorId })
      .find((candidate) => candidate.status === 'active');
  const result = await new ComposioSessionsAdapter({ resolver }).executeWithPolicy({
    context: {
      principalId: LOCAL_OWNER_PRINCIPAL,
      toolkits: [allowed.toolkit],
      authConfigs: getConfiguredComposioAuthConfigs(params.config, [allowed.toolkit]),
    },
    installation,
    connection,
    action: {
      connectorId,
      actionId: params.slug,
      toolkit: allowed.toolkit,
      scope: allowed.scope,
      curated: scopeForComposioAction(params.slug).curated,
      cachedAt: new Date().toISOString(),
    },
    args: params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
      ? params.arguments as Record<string, unknown>
      : {},
    confirmed: true,
  });
  if (result.decision !== 'allowed') throw new Error(result.reason);
  return result.result;
}
