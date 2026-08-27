import type { AgentToolResult } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import type { ExtensionHookRunner } from '../../extensions/index.js';
import { connectorArgumentsHash, connectorArgumentsPreview } from '../../connectors/approval.js';
import { getConnectorDefinition } from '../../connectors/catalog.js';
import { ComposioSessionsAdapter } from '../../connectors/composio-sessions.js';
import {
  getConfiguredComposioAuthConfigs,
  getComposioToolkitScope,
  isComposioActionAllowedByCatalog,
  scopeForComposioAction,
} from '../../connectors/composio.js';
import type { ConnectorActionMetadata, ConnectorInstallationPolicy } from '../../connectors/types.js';
import { parseSessionKey } from '../../routing/session-key.js';
import {
  consumeConnectorApproval,
  createConnectorApproval,
  getConnectorApproval,
  getConnectorInstallation,
  listConnectorActionMetadata,
  listConnectorConnections,
  listConnectorInstallations,
  upsertConnectorActionMetadata,
  upsertConnectorInstallation,
} from '../../storage/sqlite/index.js';
import { externalToolRef, parseExternalToolRef } from './refs.js';
import type {
  ExternalToolDescriptor,
  ExternalToolExecutionContext,
  ExternalToolProvider,
  ExternalToolSearchHit,
} from './types.js';

const CONNECT_ACTION = '$connect';
const CONNECTION_ARGUMENT = 'xopcConnectionId';

type CurrentContext = { channel: string; chatId: string; sessionKey: string } | null;

export interface ComposioToolProviderDeps {
  getConfig: () => Config | undefined;
  getCurrentContext: () => CurrentContext;
  agentId?: string;
  adapter?: ComposioSessionsAdapter;
  hookRunner?: ExtensionHookRunner;
}

function textResult(value: unknown): AgentToolResult<Record<string, unknown>> {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    details: {},
  };
}

function connectorPrincipalForSession(sessionKey: string | undefined): {
  principalId: string;
  agentId?: string;
  isLocalOwner: boolean;
} {
  const parsed = parseSessionKey(sessionKey);
  if (!parsed || parsed.source === 'cli' || parsed.source === 'webchat') {
    return { principalId: 'local-owner', agentId: parsed?.agentId, isLocalOwner: true };
  }
  return {
    principalId: `channel:${parsed.source}:${parsed.accountId}:${parsed.peerKind}:${parsed.peerId}`,
    agentId: parsed.agentId,
    isLocalOwner: false,
  };
}

type InstalledComposioToolkit = { connectorId: string; toolkit: string; authConfigId?: string };

function installedConfigToolkits(config: Config | undefined): InstalledComposioToolkit[] {
  return Object.values(config?.connectors?.instances ?? {}).flatMap((record) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return [];
    const row = record as Record<string, unknown>;
    const marker = row.xopcConnector;
    const markerRecord = marker && typeof marker === 'object' && !Array.isArray(marker)
      ? marker as Record<string, unknown>
      : undefined;
    if (markerRecord?.enabled === false) return [];
    const runtime = row.runtime;
    if (
      typeof markerRecord?.connectorId !== 'string'
      || !runtime
      || typeof runtime !== 'object'
      || Array.isArray(runtime)
      || (runtime as Record<string, unknown>).type !== 'composio'
      || (runtime as Record<string, unknown>).role !== 'toolkit'
      || typeof (runtime as Record<string, unknown>).toolkit !== 'string'
    ) return [];
    return [{
      connectorId: markerRecord.connectorId,
      toolkit: (runtime as Record<string, string>).toolkit,
      ...(markerRecord.config && typeof markerRecord.config === 'object' && !Array.isArray(markerRecord.config)
        && typeof (markerRecord.config as Record<string, unknown>).authConfigId === 'string'
        && ((markerRecord.config as Record<string, unknown>).authConfigId as string).trim()
        ? { authConfigId: ((markerRecord.config as Record<string, unknown>).authConfigId as string).trim() }
        : {}),
    }];
  });
}

function composioToolkitFromConnectorId(connectorId: string): string | undefined {
  const definition = getConnectorDefinition(connectorId);
  return definition?.runtime.type === 'composio' && definition.runtime.role === 'toolkit'
    ? definition.runtime.toolkit
    : undefined;
}

function toolkitFromInstallation(installation: ConnectorInstallationPolicy): string {
  const toolkit = composioToolkitFromConnectorId(installation.connectorId);
  if (!toolkit) throw new Error(`Connector installation is not a Composio toolkit: ${installation.connectorId}`);
  return toolkit;
}

function syncLocalOwnerInstallations(config: Config | undefined): void {
  for (const { connectorId, toolkit } of installedConfigToolkits(config)) {
    const id = `${connectorId}-local-owner`;
    const existing = getConnectorInstallation(id);
    upsertConnectorInstallation({
      id,
      connectorId,
      principalId: 'local-owner',
      enabled: true,
      allowedAgentIds: existing?.allowedAgentIds ?? [],
      maxScope: getComposioToolkitScope(config, toolkit),
      confirmationPolicy: existing?.confirmationPolicy ?? 'writes',
      selectedConnectionIds: existing?.selectedConnectionIds ?? [],
      createdAt: existing?.createdAt,
    });
  }
}

function toolkitForAction(actionId: string, candidates: string[]): string | undefined {
  const normalizedAction = actionId.trim().toUpperCase();
  return [...candidates]
    .sort((left, right) => right.length - left.length)
    .find((toolkit) => (
      normalizedAction === toolkit.toUpperCase()
      || normalizedAction.startsWith(`${toolkit.toUpperCase()}_`)
    ));
}

function contractFromSearch(
  connectorId: string,
  toolkit: string,
  actionId: string,
  value: unknown,
): ConnectorActionMetadata {
  const row = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const risk = scopeForComposioAction(actionId);
  return {
    connectorId,
    actionId,
    toolkit,
    scope: risk.scope,
    curated: risk.curated,
    inputSchema: row.inputSchema,
    cachedAt: new Date().toISOString(),
  };
}

function schemaSummary(value: unknown, fallback: string): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const row = value as Record<string, unknown>;
  for (const candidate of [row.description, row.title, row.name]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return fallback;
}

function actionInputSchema(action: ConnectorActionMetadata): Record<string, unknown> {
  const schema = action.inputSchema && typeof action.inputSchema === 'object' && !Array.isArray(action.inputSchema)
    ? action.inputSchema as Record<string, unknown>
    : { type: 'object' };
  const properties = schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
    ? schema.properties as Record<string, unknown>
    : {};
  return {
    ...schema,
    type: 'object',
    properties: {
      ...properties,
      [CONNECTION_ARGUMENT]: {
        type: 'string',
        description: 'Optional local connection id when more than one account is connected.',
      },
    },
  };
}

export class ComposioToolProvider implements ExternalToolProvider {
  readonly source = 'composio' as const;
  private readonly adapter: ComposioSessionsAdapter;

  constructor(private readonly deps: ComposioToolProviderDeps) {
    this.adapter = deps.adapter ?? new ComposioSessionsAdapter();
  }

  async search(query: string): Promise<ExternalToolSearchHit[]> {
    const available = this.availableInstallations();
    const toolkits = available.installations.map(toolkitFromInstallation);
    if (toolkits.length === 0) return [];
    const session = await this.adapter.createSession({
      principalId: available.principalId,
      toolkits,
      authConfigs: getConfiguredComposioAuthConfigs(this.deps.getConfig(), toolkits),
    });
    const result = await session.search({ query, toolkits });
    const schemas = result && typeof result === 'object' && !Array.isArray(result)
      ? (result as Record<string, unknown>).toolSchemas
      : undefined;
    const hits: ExternalToolSearchHit[] = available.installations.map((installation) => {
      const toolkit = toolkitFromInstallation(installation);
      return {
        toolRef: externalToolRef(this.source, installation.id, CONNECT_ACTION),
        source: this.source,
        namespace: toolkit,
        title: `Connect ${toolkit}`,
        summary: `Authorize an account for the installed ${toolkit} app.`,
      };
    });
    if (!schemas || typeof schemas !== 'object' || Array.isArray(schemas)) return hits;
    for (const [actionId, schema] of Object.entries(schemas)) {
      const toolkit = toolkitForAction(actionId, toolkits);
      if (!toolkit || !isComposioActionAllowedByCatalog(actionId)) continue;
      const installation = available.installations.find((candidate) => (
        toolkitFromInstallation(candidate) === toolkit
      ));
      if (!installation) continue;
      upsertConnectorActionMetadata(contractFromSearch(
        installation.connectorId,
        toolkit,
        actionId,
        schema,
      ));
      hits.push({
        toolRef: externalToolRef(this.source, installation.id, actionId),
        source: this.source,
        namespace: toolkit,
        title: actionId,
        summary: schemaSummary(schema, `Run ${actionId} in ${toolkit}.`),
      });
    }
    return hits;
  }

  async describe(toolRef: string): Promise<ExternalToolDescriptor | undefined> {
    const resolved = this.resolve(toolRef);
    if (!resolved) return undefined;
    const toolkit = toolkitFromInstallation(resolved.installation);
    if (resolved.actionId === CONNECT_ACTION) {
      const summary = `Authorize an account for the installed ${toolkit} app.`;
      return {
        toolRef,
        source: this.source,
        namespace: toolkit,
        title: `Connect ${toolkit}`,
        summary,
        description: `${summary} Never claim the connection succeeded until it is checked again.`,
        inputSchema: {
          type: 'object',
          properties: { alias: { type: 'string', description: 'Optional account label.' } },
          additionalProperties: false,
        },
      };
    }
    const action = listConnectorActionMetadata(resolved.installation.connectorId)
      .find((candidate) => candidate.actionId === resolved.actionId);
    if (!action?.inputSchema || !isComposioActionAllowedByCatalog(action.actionId)) return undefined;
    const summary = `Run ${action.actionId} in ${toolkit}.`;
    return {
      toolRef,
      source: this.source,
      namespace: toolkit,
      title: action.actionId,
      summary,
      description: summary,
      inputSchema: actionInputSchema(action),
    };
  }

  async execute(
    toolRef: string,
    args: Record<string, unknown>,
    approvalId: string | undefined,
    _context: ExternalToolExecutionContext,
  ) {
    const available = this.availableInstallations();
    const resolved = this.resolve(toolRef, available.installations);
    if (!resolved) return textResult('This connected app tool is not allowed for this user and agent.');
    let executionArgs = args;
    if (this.deps.hookRunner) {
      const hook = await this.deps.hookRunner.runBeforeToolCall(toolRef, args, {
        sessionKey: available.context?.sessionKey,
      });
      if (!hook.allowed) throw new Error(hook.reason ?? 'Connected app tool call blocked by policy hook.');
      executionArgs = hook.params ?? args;
    }
    const toolkit = toolkitFromInstallation(resolved.installation);
    if (resolved.actionId === CONNECT_ACTION) {
      const authorization = await this.adapter.authorize({
        principalId: available.principalId,
        toolkit,
        authConfigId: installedConfigToolkits(this.deps.getConfig())
          .find((item) => item.connectorId === resolved.installation.connectorId)?.authConfigId,
        installationId: resolved.installation.id,
        alias: typeof executionArgs.alias === 'string' ? executionArgs.alias : undefined,
      });
      return textResult({
        status: authorization.status,
        toolkit,
        authorizationUrl: authorization.connectUrl,
        connectionId: authorization.connectionId,
        instruction: 'Ask the user to open the authorization URL. Check the connection again after they finish.',
      });
    }
    const action = listConnectorActionMetadata(resolved.installation.connectorId)
      .find((candidate) => candidate.actionId === resolved.actionId);
    if (!action?.inputSchema || !isComposioActionAllowedByCatalog(resolved.actionId)) {
      return textResult('The exact action contract is unavailable. Search and describe the tool again.');
    }
    await this.adapter.syncConnections({ principalId: available.principalId }).catch(() => []);
    const connections = listConnectorConnections({
      principalId: available.principalId,
      connectorId: resolved.installation.connectorId,
    }).filter((connection) => connection.status === 'active');
    const requestedConnection = typeof executionArgs[CONNECTION_ARGUMENT] === 'string'
      ? executionArgs[CONNECTION_ARGUMENT]
      : undefined;
    const connection = requestedConnection
      ? connections.find((candidate) => candidate.id === requestedConnection)
      : connections.find((candidate) => candidate.isDefault) ?? connections[0];
    const actionArgs = { ...executionArgs };
    delete actionArgs[CONNECTION_ARGUMENT];
    const argsHash = connectorArgumentsHash(actionArgs);
    let confirmed = false;
    if (approvalId) {
      const pending = getConnectorApproval(approvalId);
      if (
        !pending
        || pending.principalId !== available.principalId
        || pending.connectorId !== resolved.installation.connectorId
        || pending.actionId !== action.actionId
        || pending.sessionKey !== available.context?.sessionKey
      ) return textResult('The connector approval is invalid for this session or action.');
      confirmed = Boolean(consumeConnectorApproval(approvalId, argsHash));
      if (!confirmed) return textResult('The connector approval is not approved, has expired, or was already used.');
    }
    const result = await this.adapter.executeWithPolicy({
      context: {
        principalId: available.principalId,
        toolkits: [toolkit],
        authConfigs: getConfiguredComposioAuthConfigs(this.deps.getConfig(), [toolkit]),
      },
      installation: resolved.installation,
      connection,
      action,
      args: actionArgs,
      agentId: available.agentId,
      sessionKey: available.context?.sessionKey,
      confirmed,
    });
    if (result.decision === 'confirmation_required') {
      const approval = createConnectorApproval({
        principalId: available.principalId,
        connectorId: resolved.installation.connectorId,
        connectionId: connection?.id,
        agentId: available.agentId,
        sessionKey: available.context?.sessionKey,
        actionId: action.actionId,
        scope: action.scope,
        argumentsHash: argsHash,
        argumentsPreview: connectorArgumentsPreview(actionArgs),
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      });
      return textResult({
        status: 'confirmation_required',
        approvalId: approval.id,
        actionId: approval.actionId,
        scope: approval.scope,
        argumentsPreview: approval.argumentsPreview,
        expiresAt: approval.expiresAt,
        instruction: 'Ask the user to approve this exact action in xopc, then retry with the approvalId and unchanged arguments.',
      });
    }
    return textResult(result.decision === 'allowed' ? result.result : result.reason);
  }

  private availableInstallations(): {
    principalId: string;
    agentId?: string;
    context: CurrentContext;
    installations: ConnectorInstallationPolicy[];
  } {
    const context = this.deps.getCurrentContext();
    const principal = connectorPrincipalForSession(context?.sessionKey);
    if (principal.isLocalOwner) syncLocalOwnerInstallations(this.deps.getConfig());
    const agentId = this.deps.agentId ?? principal.agentId;
    const installations = listConnectorInstallations(principal.principalId).filter((installation) => (
      installation.enabled
      && composioToolkitFromConnectorId(installation.connectorId) !== undefined
      && (
        installation.allowedAgentIds.length === 0
        || Boolean(agentId && installation.allowedAgentIds.includes(agentId))
      )
    ));
    return { principalId: principal.principalId, agentId, context, installations };
  }

  private resolve(
    toolRef: string,
    installations = this.availableInstallations().installations,
  ): { installation: ConnectorInstallationPolicy; actionId: string } | undefined {
    const parsed = parseExternalToolRef(toolRef, this.source);
    if (!parsed) return undefined;
    const installation = installations.find((candidate) => candidate.id === parsed.namespace);
    return installation ? { installation, actionId: parsed.toolName } : undefined;
  }
}
