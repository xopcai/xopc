import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import { Composio } from '@composio/core';
import type { ToolRouterCreateSessionConfig } from '@composio/core';
import { PiProvider } from '@composio/experimental';

import { CredentialResolver } from '../auth/credentials.js';
import {
  appendConnectorExecutionAudit,
  getConnectorInstallation,
  listConnectorConnections as listStoredConnectorConnections,
  upsertConnectorConnection,
} from '../storage/sqlite/connector-repository.js';
import { createLogger } from '../utils/logger.js';
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

export async function assertComposioApiKeyConfigured(resolver = new CredentialResolver()): Promise<string> {
  const apiKey = await resolveComposioApiKey(resolver);
  if (!apiKey) {
    throw new Error('Composio API key is not configured. Install the "Composio API Key" connector first.');
  }
  return apiKey;
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

type SessionToolkitResponse = {
  items: Array<{
    slug: string;
    name: string;
    logo?: string;
    isNoAuth: boolean;
    connection?: {
      isActive: boolean;
      connectedAccount?: { status: string; id: string };
    };
  }>;
  cursor?: string;
};

export type ComposioSessionLike = {
  sessionId: string;
  toolkits(options?: { toolkits?: string[]; isConnected?: boolean; limit?: number; cursor?: string }): Promise<SessionToolkitResponse>;
  authorize(toolkit: string, options?: { callbackUrl?: string; alias?: string }): Promise<{
    id: string;
    status: string;
    redirectUrl?: string | null;
  }>;
  search(params: { query: string; toolkits?: string[] }): Promise<unknown>;
  execute(toolSlug: string, args?: Record<string, unknown>, options?: { account?: string }): Promise<unknown>;
};

export type ComposioSessionsClient = {
  sessions: {
    create(userId: string, config?: ToolRouterCreateSessionConfig): Promise<ComposioSessionLike>;
  };
  connectedAccounts: {
    list(query?: { userIds?: string[]; toolkitSlugs?: string[] }): Promise<unknown>;
    delete(id: string): Promise<unknown>;
    refresh(id: string): Promise<unknown>;
  };
};

export type ComposioSessionContext = {
  principalId: string;
  installationScope?: string;
  toolkits?: string[];
  connectedAccounts?: Record<string, string[]>;
  callbackUrl?: string;
};

type ClientFactory = () => Promise<ComposioSessionsClient>;

function stableHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function defaultInstallationScope(): string {
  const configured = process.env.XOPC_STATE_DIR?.trim() || process.env.XOPC_CONFIG_PATH?.trim();
  return configured ? resolve(configured) : resolve(process.cwd());
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

export class ComposioSessionsAdapter {
  private readonly createClient: ClientFactory;

  constructor(options: { resolver?: CredentialResolver; clientFactory?: ClientFactory } = {}) {
    if (options.clientFactory) {
      this.createClient = options.clientFactory;
      return;
    }
    const resolver = options.resolver ?? new CredentialResolver();
    this.createClient = async () => {
      const apiKey = await assertComposioApiKeyConfigured(resolver);
      return new Composio({
        apiKey,
        baseURL: process.env.XOPC_COMPOSIO_BASE_URL?.trim() || undefined,
        allowTracking: false,
        dangerouslyAllowAutoUploadDownloadFiles: false,
        fileUploadDirs: false,
        provider: new PiProvider(),
        host: 'xopc',
      }) as unknown as ComposioSessionsClient;
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
      ...(context.connectedAccounts && Object.keys(context.connectedAccounts).length > 0
        ? { connectedAccounts: context.connectedAccounts }
        : {}),
    };
    return client.sessions.create(
      createComposioPrincipalId(context.principalId, context.installationScope),
      config,
    );
  }

  async listToolkitCatalog(context: Omit<ComposioSessionContext, 'toolkits'>): Promise<ComposioToolkitCatalogItem[]> {
    const session = await this.createSession(context);
    const items: ComposioToolkitCatalogItem[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const response = await session.toolkits({ limit: 100, cursor });
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
    context: ComposioSessionContext & { toolkit: string; installationId?: string; alias?: string },
  ): Promise<ComposioAuthorizeResult> {
    const session = await this.createSession({ ...context, toolkits: [context.toolkit] });
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
      metadata: { toolkit: context.toolkit },
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
      synced.push(upsertConnectorConnection({
        id: existing?.id ?? `composio-${providerConnectionId}`,
        installationId: existing?.installationId,
        connectorId,
        provider: 'composio',
        principalId: context.principalId,
        providerConnectionId,
        alias: existing?.alias,
        identity,
        status: connectionStatus(readString(row, ['status'])),
        isDefault: existing?.isDefault ?? false,
        connectedAt: readString(row, ['createdAt', 'created_at']),
        lastError: readString(row, ['lastError', 'last_error']),
        metadata: { toolkit, providerPrincipalId },
      }));
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
      const session = await this.createSession({ ...input.context, connectedAccounts });
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
