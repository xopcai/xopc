import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import type { ToolRouterCreateSessionConfig } from '@composio/core';

import { CredentialResolver } from '../auth/credentials.js';
import { resolveStateDir } from '../config/paths-state.js';
import {
  appendConnectorExecutionAudit,
  getConnectorConnection,
  getConnectorInstallation,
  listConnectorConnections as listStoredConnectorConnections,
  upsertConnectorConnection,
} from '../storage/sqlite/connector-repository.js';
import { reconcileConnectorAccount } from '../storage/sqlite/connector-account-repository.js';
import { createLogger } from '../utils/logger.js';
import { connectorIdentityKey, mergeConnectorIdentity } from './connector-identity.js';
import type {
  ComposioSessionLike,
  ComposioSessionsClient,
  ComposioToolkitAuthState,
} from './composio-session-types.js';
import { evaluateConnectorExecutionPolicy } from './policy.js';
import type {
  ConnectorActionMetadata,
  ConnectorConnection,
  ConnectorInstallationPolicy,
} from './types.js';

const log = createLogger('Connectors:ComposioSessions');
const COMPOSIO_API_KEY_PROVIDER = 'connector-composio-api-key';

export async function resolveComposioApiKey(resolver = new CredentialResolver()): Promise<string | null> {
  const stored = await resolver.resolveApiKey(COMPOSIO_API_KEY_PROVIDER).catch(() => undefined);
  return stored?.trim() || process.env.XOPC_COMPOSIO_API_KEY?.trim() || process.env.COMPOSIO_API_KEY?.trim() || null;
}

export async function assertComposioAccessConfigured(resolver = new CredentialResolver()): Promise<'byok' | 'managed'> {
  if (await resolveComposioApiKey(resolver)) return 'byok';
  const cloudAccessToken = await resolver.resolveApiKey('xopc-cloud').catch(() => null);
  if (cloudAccessToken?.trim()) return 'managed';
  throw new Error(
    'Composio API key is not configured and XOPC Cloud is not signed in. '
    + 'Install the "Composio API Key" connector first or sign in to XOPC Cloud.',
  );
}

export type ComposioToolkitCatalogItem = {
  slug: string;
  name: string;
  logoUrl?: string;
  isNoAuth: boolean;
  connected: boolean;
  providerConnectionId?: string;
};

export type ComposioAuthorizeResult = {
  toolkit: string;
  connectionId: string;
  connectUrl?: string;
  status: string;
};

export type {
  ComposioAuthConfigOption,
  ComposioSessionLike,
  ComposioSessionsClient,
  ComposioToolkitAuthState,
} from './composio-session-types.js';

export type ComposioSessionContext = {
  principalId: string;
  installationScope?: string;
  providerPrincipalId?: string;
  toolkits?: string[];
  authConfigs?: Record<string, string>;
  connectedAccounts?: Record<string, string[]>;
  callbackUrl?: string;
};

type ClientFactory = () => Promise<ComposioSessionsClient>;

function stableHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function defaultInstallationScope(): string {
  return resolve(resolveStateDir());
}

/** Convert local identities to stable opaque Composio user IDs without disclosing user data. */
export function createComposioPrincipalId(principalId: string, installationScope = defaultInstallationScope()): string {
  const normalized = principalId.trim();
  if (!normalized) throw new Error('Connector principalId is required.');
  return `xopc_${stableHash(installationScope)}_${stableHash(normalized)}`;
}

function readArray(payload: unknown): unknown[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const record = payload as Record<string, unknown>;
  for (const key of ['items', 'data', 'connected_accounts']) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function connectionStatus(value: string | undefined): ConnectorConnection['status'] {
  switch (value?.toUpperCase()) {
    case 'ACTIVE': return 'active';
    case 'INITIATED':
    case 'INITIALIZING': return 'pending';
    case 'EXPIRED': return 'expired';
    case 'FAILED': return 'failed';
    case 'REVOKED':
    case 'DELETED': return 'revoked';
    case 'INACTIVE': return 'disabled';
    default: return 'unknown';
  }
}

function errorChainMessage(error: unknown): string {
  const messages: string[] = [];
  const visited = new Set<unknown>();
  let current = error;
  while (current && !visited.has(current)) {
    visited.add(current);
    if (current instanceof Error) messages.push(current.message);
    else if (typeof current === 'string') messages.push(current);
    if (!current || typeof current !== 'object' || !('cause' in current)) break;
    current = (current as { cause?: unknown }).cause;
  }
  return messages.join(' ');
}

function missingAuthConfigMessage(error: unknown, toolkit: string, authConfigId?: string): string | null {
  const message = errorChainMessage(error);
  if (!message.includes('require auth configs') && !message.includes('cannot be auto-created')) return null;
  if (authConfigId) {
    return `The Composio auth config "${authConfigId}" is not available for toolkit "${toolkit}". `
      + 'Make sure it is enabled for Tool Router and belongs to the same Composio project as the configured API key.';
  }
  return `The Composio toolkit "${toolkit}" requires a custom auth config. `
    + 'Create one in the Composio dashboard, enable it for Tool Router, then select it in the connector settings.';
}

export class ComposioSessionsAdapter {
  private readonly createClient: ClientFactory;

  constructor(options: {
    resolver?: CredentialResolver;
    clientFactory?: ClientFactory;
    fileDownloadDir?: string;
  } = {}) {
    if (options.clientFactory) {
      this.createClient = options.clientFactory;
      return;
    }
    const resolver = options.resolver ?? new CredentialResolver();
    this.createClient = async () => {
      const apiKey = await resolveComposioApiKey(resolver);
      if (!apiKey) {
        const { ManagedComposioClient } = await import('./composio-managed-client.js');
        return new ManagedComposioClient();
      }
      let Composio: typeof import('@composio/core').Composio;
      let PiProvider: typeof import('@composio/experimental').PiProvider;
      try {
        [{ Composio }, { PiProvider }] = await Promise.all([
          import('@composio/core'),
          import('@composio/experimental'),
        ]);
      } catch (cause) {
        throw new Error(
          'The xopc installation is missing the bundled Composio runtime. '
          + 'Reinstall @xopcai/xopc and restart the gateway.',
          { cause },
        );
      }
      const client = new Composio({
        apiKey,
        baseURL: process.env.XOPC_COMPOSIO_BASE_URL?.trim() || undefined,
        allowTracking: false,
        dangerouslyAllowAutoUploadDownloadFiles: Boolean(options.fileDownloadDir),
        fileUploadDirs: false,
        ...(options.fileDownloadDir ? { fileDownloadDir: options.fileDownloadDir } : {}),
        provider: new PiProvider(),
        host: 'xopc',
      }) as unknown as ComposioSessionsClient;
      client.mode = 'byok';
      return client;
    };
  }

  async createSession(context: ComposioSessionContext): Promise<ComposioSessionLike> {
    const client = await this.createClient();
    const config: ToolRouterCreateSessionConfig = {
      manageConnections: {
        enable: true,
        callbackUrl: context.callbackUrl,
        waitForConnections: false,
      },
      sandbox: { enable: false },
      multiAccount: {
        enable: true,
        maxAccountsPerToolkit: 5,
        requireExplicitSelection: true,
      },
      ...(context.toolkits?.length ? { toolkits: { enable: context.toolkits } } : {}),
      ...(context.authConfigs && Object.keys(context.authConfigs).length > 0
        ? { authConfigs: context.authConfigs }
        : {}),
      ...(context.connectedAccounts && Object.keys(context.connectedAccounts).length > 0
        ? { connectedAccounts: context.connectedAccounts }
        : {}),
    };
    return client.sessions.create(
      context.providerPrincipalId ?? createComposioPrincipalId(context.principalId, context.installationScope),
      config,
    );
  }

  async getToolkitAuthState(toolkit: string): Promise<ComposioToolkitAuthState> {
    const normalizedToolkit = toolkit.trim().toLowerCase();
    if (!normalizedToolkit) throw new Error('Composio toolkit is required.');
    const client = await this.createClient();
    if (!client.authConfigs || !client.toolkits) {
      throw new Error('The installed Composio runtime does not support auth config discovery.');
    }
    const [toolkitDetails, authConfigList] = await Promise.all([
      client.toolkits.get(normalizedToolkit),
      client.authConfigs.list({ toolkit: normalizedToolkit, showDisabled: true }),
    ]);
    const managedAuthAvailable = (toolkitDetails.composioManagedAuthSchemes?.length ?? 0) > 0;
    const authConfigs = authConfigList.items.map((item) => ({
      id: item.id,
      name: item.name,
      status: item.status,
      authScheme: item.authScheme,
      isComposioManaged: item.isComposioManaged === true,
      isEnabledForToolRouter: item.isEnabledForToolRouter !== false,
    }));
    return {
      toolkit: normalizedToolkit,
      managedAuthAvailable,
      requiresCustomAuthConfig: !managedAuthAvailable && (toolkitDetails.authConfigDetails?.length ?? 0) > 0,
      authConfigs,
    };
  }

  async listToolkitCatalog(context: Omit<ComposioSessionContext, 'toolkits'>): Promise<ComposioToolkitCatalogItem[]> {
    const session = await this.createSession(context);
    const items: ComposioToolkitCatalogItem[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const response = await session.toolkits({ limit: 50, cursor });
      for (const item of response.items) {
        items.push({
          slug: item.slug,
          name: item.name,
          logoUrl: item.logo,
          isNoAuth: item.isNoAuth,
          connected: item.connection?.isActive === true,
          providerConnectionId: item.connection?.connectedAccount?.id,
        });
      }
      if (!response.cursor || response.cursor === cursor) break;
      cursor = response.cursor;
    }
    return items;
  }

  async authorize(
    context: ComposioSessionContext & { toolkit: string; authConfigId?: string; installationId?: string; alias?: string },
  ): Promise<ComposioAuthorizeResult> {
    const providerPrincipalId = createComposioPrincipalId(context.principalId, context.installationScope);
    let session: ComposioSessionLike;
    try {
      session = await this.createSession({
        ...context,
        providerPrincipalId,
        toolkits: [context.toolkit],
        ...(context.authConfigId ? { authConfigs: { [context.toolkit]: context.authConfigId } } : {}),
      });
    } catch (error) {
      const actionableMessage = missingAuthConfigMessage(error, context.toolkit, context.authConfigId);
      if (actionableMessage) throw new Error(actionableMessage, { cause: error });
      throw error;
    }
    const request = await session.authorize(context.toolkit, {
      callbackUrl: context.callbackUrl,
      alias: context.alias,
    });
    const connectorId = `composio-${context.toolkit}`;
    upsertConnectorConnection({
      id: `composio-${request.id}`,
      installationId: context.installationId && getConnectorInstallation(context.installationId)
        ? context.installationId
        : undefined,
      connectorId,
      provider: 'composio',
      principalId: context.principalId,
      providerConnectionId: request.id,
      alias: context.alias,
      identity: {},
      status: connectionStatus(request.status),
      isDefault: listStoredConnectorConnections({ principalId: context.principalId, connectorId }).length === 0,
      metadata: {
        toolkit: context.toolkit,
        providerPrincipalId,
        ...(context.authConfigId ? { authConfigId: context.authConfigId } : {}),
      },
    });
    return {
      toolkit: context.toolkit,
      connectionId: request.id,
      connectUrl: request.redirectUrl ?? undefined,
      status: request.status,
    };
  }

  async syncConnections(context: Pick<ComposioSessionContext, 'principalId' | 'installationScope'>): Promise<ConnectorConnection[]> {
    const client = await this.createClient();
    const providerPrincipalId = createComposioPrincipalId(context.principalId, context.installationScope);
    const payload = await client.connectedAccounts.list({ userIds: [providerPrincipalId] });
    const synced: ConnectorConnection[] = [];
    for (const item of readArray(payload)) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const row = item as Record<string, unknown>;
      const toolkitRecord = row.toolkit && typeof row.toolkit === 'object' && !Array.isArray(row.toolkit)
        ? row.toolkit as Record<string, unknown>
        : {};
      const providerConnectionId = readString(row, ['id', 'nanoid', 'connectedAccountId', 'connected_account_id']);
      const toolkit = readString(toolkitRecord, ['slug']) ?? readString(row, ['toolkitSlug', 'toolkit_slug']);
      if (!providerConnectionId || !toolkit) continue;
      const connectorId = `composio-${toolkit}`;
      const existing = listStoredConnectorConnections({ principalId: context.principalId, connectorId })
        .find((connection) => connection.providerConnectionId === providerConnectionId);
      const identity = row.connectionData && typeof row.connectionData === 'object' && !Array.isArray(row.connectionData)
        ? row.connectionData as Record<string, unknown>
        : {};
      const connection = upsertConnectorConnection({
        id: existing?.id ?? `composio-${providerConnectionId}`,
        accountId: existing?.accountId,
        installationId: existing?.installationId,
        connectorId,
        provider: 'composio',
        principalId: context.principalId,
        providerConnectionId,
        alias: existing?.alias,
        identity: mergeConnectorIdentity(toolkit, existing?.identity ?? {}, identity),
        status: connectionStatus(readString(row, ['status'])),
        isDefault: existing?.isDefault ?? false,
        connectedAt: readString(row, ['createdAt', 'created_at']),
        lastError: readString(row, ['lastError', 'last_error']),
        metadata: { ...existing?.metadata, toolkit, providerPrincipalId },
      });
      const identityKey = connectorIdentityKey(toolkit, connection.identity);
      if (identityKey) {
        reconcileConnectorAccount({
          connectionId: connection.id,
          identityKey,
          identity: connection.identity,
        });
      }
      synced.push(getConnectorConnection(connection.id)!);
    }
    return synced;
  }

  async revokeConnection(connection: ConnectorConnection): Promise<void> {
    const client = await this.createClient();
    await client.connectedAccounts.delete(connection.providerConnectionId);
    upsertConnectorConnection({
      ...connection,
      status: 'revoked',
      isDefault: false,
      updatedAt: new Date().toISOString(),
    });
  }

  async refreshConnection(connection: ConnectorConnection): Promise<ConnectorConnection> {
    const client = await this.createClient();
    await client.connectedAccounts.refresh(connection.providerConnectionId);
    const synced = await this.syncConnections({ principalId: connection.principalId });
    return synced.find((candidate) => candidate.id === connection.id)
      ?? synced.find((candidate) => candidate.providerConnectionId === connection.providerConnectionId)
      ?? connection;
  }

  async executeWithPolicy(input: {
    context: ComposioSessionContext;
    installation: ConnectorInstallationPolicy;
    connection?: ConnectorConnection;
    action: ConnectorActionMetadata;
    args?: Record<string, unknown>;
    agentId?: string;
    sessionKey?: string;
    confirmed?: boolean;
  }): Promise<{ decision: 'allowed'; result: unknown } | { decision: 'denied' | 'confirmation_required'; reason: string }> {
    const evaluation = evaluateConnectorExecutionPolicy({
      installation: input.installation,
      action: input.action,
      agentId: input.agentId,
      connectionId: input.connection?.id,
      confirmed: input.confirmed,
    });
    if (evaluation.decision !== 'allowed') {
      appendConnectorExecutionAudit({
        installationId: input.installation.id,
        connectionId: input.connection?.id,
        connectorId: input.installation.connectorId,
        principalId: input.context.principalId,
        agentId: input.agentId,
        sessionKey: input.sessionKey,
        actionId: input.action.actionId,
        scope: input.action.scope,
        decision: evaluation.decision,
        resultStatus: 'not_executed',
      });
      return { decision: evaluation.decision, reason: evaluation.reason };
    }

    const startedAt = Date.now();
    try {
      const toolkit = input.action.toolkit;
      const connectedAccounts = toolkit && input.connection
        ? { [toolkit]: [input.connection.providerConnectionId] }
        : input.context.connectedAccounts;
      const providerPrincipalId = input.connection?.metadata.providerPrincipalId;
      const connectionAuthConfigId = input.connection?.metadata.authConfigId;
      if (input.connection && (typeof providerPrincipalId !== 'string' || !providerPrincipalId.trim())) {
        throw new Error('Connected account is missing its provider identity. Reconnect the account and try again.');
      }
      const session = await this.createSession({
        ...input.context,
        connectedAccounts,
        ...(toolkit && typeof connectionAuthConfigId === 'string' && connectionAuthConfigId.trim()
          ? { authConfigs: { [toolkit]: connectionAuthConfigId.trim() } }
          : {}),
        ...(typeof providerPrincipalId === 'string' ? { providerPrincipalId } : {}),
      });
      const result = await session.execute(
        input.action.actionId,
        input.args ?? {},
        input.connection ? { account: input.connection.providerConnectionId } : undefined,
      );
      appendConnectorExecutionAudit({
        installationId: input.installation.id,
        connectionId: input.connection?.id,
        connectorId: input.installation.connectorId,
        principalId: input.context.principalId,
        agentId: input.agentId,
        sessionKey: input.sessionKey,
        actionId: input.action.actionId,
        scope: input.action.scope,
        decision: 'allowed',
        resultStatus: 'success',
        durationMs: Date.now() - startedAt,
      });
      return { decision: 'allowed', result };
    } catch (err) {
      const errorCode = err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : undefined;
      appendConnectorExecutionAudit({
        installationId: input.installation.id,
        connectionId: input.connection?.id,
        connectorId: input.installation.connectorId,
        principalId: input.context.principalId,
        agentId: input.agentId,
        sessionKey: input.sessionKey,
        actionId: input.action.actionId,
        scope: input.action.scope,
        decision: 'allowed',
        resultStatus: 'error',
        durationMs: Date.now() - startedAt,
        errorCode,
      });
      log.warn(
        { err, connectorId: input.installation.connectorId, actionId: input.action.actionId, phase: 'execute' },
        'Composio connector action failed',
      );
      throw err;
    }
  }
}
