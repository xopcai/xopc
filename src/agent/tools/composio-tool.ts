import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';

import type { Config } from '../../config/schema.js';
import { connectorArgumentsHash, connectorArgumentsPreview } from '../../connectors/approval.js';
import { getConnectorDefinition } from '../../connectors/catalog.js';
import { ComposioSessionsAdapter } from '../../connectors/composio-sessions.js';
import { getComposioToolkitScope, scopeForComposioAction } from '../../connectors/composio.js';
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

const ComposioSearchSchema = Type.Object({
  query: Type.String({ description: 'Describe the task or information you need from connected apps.' }),
  toolkits: Type.Optional(Type.Array(Type.String(), { maxItems: 8, description: 'Optional installed app slugs to search.' })),
});

const ComposioConnectSchema = Type.Object({
  toolkit: Type.String({ description: 'Installed Composio app slug, for example gmail or notion.' }),
  alias: Type.Optional(Type.String({ description: 'Optional account label such as Personal or Work.' })),
});

const ComposioExecuteSchema = Type.Object({
  actionId: Type.String({ description: 'Exact action slug returned by composio_search.' }),
  arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: 'Arguments matching the exact contract returned by composio_search.' })),
  connectionId: Type.Optional(Type.String({ description: 'Local connection id when more than one account is connected.' })),
  approvalId: Type.Optional(Type.String({ description: 'Approval id after the user explicitly approves a pending write/admin action.' })),
});

type CurrentContext = { channel: string; chatId: string; sessionKey: string } | null;

export type ComposioToolDeps = {
  getConfig: () => Config | undefined;
  getCurrentContext: () => CurrentContext;
  agentId?: string;
  adapter?: ComposioSessionsAdapter;
};

function textResult(value: unknown): AgentToolResult<Record<string, unknown>> {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    details: {},
  };
}

export function connectorPrincipalForSession(sessionKey: string | undefined): { principalId: string; agentId?: string; isLocalOwner: boolean } {
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

type InstalledComposioToolkit = { connectorId: string; toolkit: string };

function installedConfigToolkits(config: Config | undefined): InstalledComposioToolkit[] {
  return Object.entries(config?.connectors?.instances ?? {}).flatMap(([_instanceId, record]) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return [];
    const row = record as Record<string, unknown>;
    const marker = row.xopcConnector;
    if (marker && typeof marker === 'object' && !Array.isArray(marker) && (marker as Record<string, unknown>).enabled === false) return [];
    const connectorId = marker && typeof marker === 'object' && !Array.isArray(marker)
      ? (marker as Record<string, unknown>).connectorId
      : undefined;
    const runtime = row.runtime;
    if (
      typeof connectorId !== 'string' ||
      !runtime ||
      typeof runtime !== 'object' ||
      Array.isArray(runtime) ||
      (runtime as Record<string, unknown>).type !== 'composio' ||
      (runtime as Record<string, unknown>).role !== 'toolkit' ||
      typeof (runtime as Record<string, unknown>).toolkit !== 'string'
    ) return [];
    return [{ connectorId, toolkit: (runtime as Record<string, string>).toolkit }];
  });
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

function availableInstallations(deps: ComposioToolDeps): {
  principalId: string;
  agentId?: string;
  context: CurrentContext;
  installations: ConnectorInstallationPolicy[];
} {
  const context = deps.getCurrentContext();
  const principal = connectorPrincipalForSession(context?.sessionKey);
  if (principal.isLocalOwner) syncLocalOwnerInstallations(deps.getConfig());
  const agentId = deps.agentId ?? principal.agentId;
  const installations = listConnectorInstallations(principal.principalId).filter((installation) => (
    installation.enabled &&
    composioToolkitFromConnectorId(installation.connectorId) !== undefined &&
    (installation.allowedAgentIds.length === 0 || Boolean(agentId && installation.allowedAgentIds.includes(agentId)))
  ));
  return { principalId: principal.principalId, agentId, context, installations };
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

function toolkitForAction(actionId: string, candidates: string[]): string | undefined {
  const normalizedAction = actionId.trim().toUpperCase();
  return [...candidates]
    .sort((left, right) => right.length - left.length)
    .find((toolkit) => normalizedAction === toolkit.toUpperCase() || normalizedAction.startsWith(`${toolkit.toUpperCase()}_`));
}

function contractFromSearch(connectorId: string, toolkit: string, actionId: string, value: unknown): ConnectorActionMetadata {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
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

export function createComposioTools(deps: ComposioToolDeps): AgentTool[] {
  if (installedConfigToolkits(deps.getConfig()).length === 0) return [];
  const adapter = deps.adapter ?? new ComposioSessionsAdapter();

  const searchTool: AgentTool<typeof ComposioSearchSchema, Record<string, unknown>> = {
    name: 'composio_search',
    label: '🔎 Connected Apps Search',
    description: 'Discover exact actions and argument contracts for the connected apps allowed in this session. Call this before composio_execute.',
    parameters: ComposioSearchSchema,
    async execute(_toolCallId, params) {
      const available = availableInstallations(deps);
      const installedToolkits = available.installations.map(toolkitFromInstallation);
      const requested = params.toolkits?.length
        ? params.toolkits.map((toolkit) => toolkit.toLowerCase()).filter((toolkit) => installedToolkits.includes(toolkit))
        : installedToolkits;
      if (requested.length === 0) return textResult('No connected apps are allowed for this user and agent.');
      const session = await adapter.createSession({ principalId: available.principalId, toolkits: requested });
      const result = await session.search({ query: params.query, toolkits: requested });
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        const schemas = (result as Record<string, unknown>).toolSchemas;
        if (schemas && typeof schemas === 'object' && !Array.isArray(schemas)) {
          for (const [actionId, schema] of Object.entries(schemas)) {
            const toolkit = toolkitForAction(actionId, requested);
            if (toolkit && requested.includes(toolkit)) {
              const installation = available.installations.find((candidate) => toolkitFromInstallation(candidate) === toolkit);
              if (installation) upsertConnectorActionMetadata(contractFromSearch(installation.connectorId, toolkit, actionId, schema));
            }
          }
        }
      }
      return textResult(result);
    },
  };

  const connectTool: AgentTool<typeof ComposioConnectSchema, Record<string, unknown>> = {
    name: 'composio_connect',
    label: '🔐 Connect App Account',
    description: 'Create an authorization link for an installed app. Never claims the connection succeeded until it is checked again.',
    parameters: ComposioConnectSchema,
    async execute(_toolCallId, params) {
      const available = availableInstallations(deps);
      const toolkit = params.toolkit.trim().toLowerCase();
      const installation = available.installations.find((candidate) => toolkitFromInstallation(candidate) === toolkit);
      if (!installation) return textResult('This app is not installed or is not allowed for this user and agent.');
      const authorization = await adapter.authorize({
        principalId: available.principalId,
        toolkit,
        installationId: installation.id,
        alias: params.alias,
      });
      return textResult({
        status: authorization.status,
        toolkit,
        authorizationUrl: authorization.connectUrl,
        connectionId: authorization.connectionId,
        instruction: 'Ask the user to open the authorization URL. Check the connection again after they finish.',
      });
    },
  };

  const executeTool: AgentTool<typeof ComposioExecuteSchema, Record<string, unknown>> = {
    name: 'composio_execute',
    label: '🔌 Connected App Action',
    description: 'Execute an exact action returned by composio_search. Write and admin actions require a user-approved approvalId.',
    parameters: ComposioExecuteSchema,
    async execute(_toolCallId, params) {
      const available = availableInstallations(deps);
      const toolkit = toolkitForAction(params.actionId, available.installations.map(toolkitFromInstallation));
      if (!toolkit) return textResult('Unknown toolkit for this action. Call composio_search first.');
      const installation = available.installations.find((candidate) => toolkitFromInstallation(candidate) === toolkit);
      if (!installation) return textResult('This app is not allowed for this user and agent.');
      const action = listConnectorActionMetadata(installation.connectorId)
        .find((candidate) => candidate.actionId === params.actionId);
      if (!action?.inputSchema) {
        return textResult('The exact action contract is not cached. Call composio_search for this task before executing.');
      }
      await adapter.syncConnections({ principalId: available.principalId }).catch(() => []);
      const connections = listConnectorConnections({
        principalId: available.principalId,
        connectorId: installation.connectorId,
      }).filter((connection) => connection.status === 'active');
      const connection = params.connectionId
        ? connections.find((candidate) => candidate.id === params.connectionId)
        : connections.find((candidate) => candidate.isDefault) ?? connections[0];
      const args = params.arguments ?? {};
      const argsHash = connectorArgumentsHash(args);
      let confirmed = false;
      if (params.approvalId) {
        const pending = getConnectorApproval(params.approvalId);
        if (
          !pending ||
          pending.principalId !== available.principalId ||
          pending.connectorId !== installation.connectorId ||
          pending.actionId !== action.actionId ||
          pending.sessionKey !== available.context?.sessionKey
        ) {
          return textResult('The connector approval is invalid for this session or action.');
        }
        confirmed = Boolean(consumeConnectorApproval(params.approvalId, argsHash));
        if (!confirmed) return textResult('The connector approval is not approved, has expired, or was already used.');
      }
      const result = await adapter.executeWithPolicy({
        context: { principalId: available.principalId, toolkits: [toolkit] },
        installation,
        connection,
        action,
        args,
        agentId: available.agentId,
        sessionKey: available.context?.sessionKey,
        confirmed,
      });
      if (result.decision === 'confirmation_required') {
        const approval = createConnectorApproval({
          principalId: available.principalId,
          connectorId: installation.connectorId,
          connectionId: connection?.id,
          agentId: available.agentId,
          sessionKey: available.context?.sessionKey,
          actionId: action.actionId,
          scope: action.scope,
          argumentsHash: argsHash,
          argumentsPreview: connectorArgumentsPreview(args),
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
    },
  };

  return [searchTool, connectTool, executeTool];
}
