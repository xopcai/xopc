import type { AgentToolResult } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import type { ExtensionHookRunner } from '../../extensions/index.js';
import { connectorArgumentsHash, connectorArgumentsPreview } from '../../connectors/approval.js';
import { evaluateConnectorExecutionPolicy } from '../../connectors/policy.js';
import { executeExternalOperation, ExternalEffectNotAppliedError } from '../../capabilities/runtime/external-operations.js';
import { CapabilityError } from '../../capabilities/runtime/errors.js';
import { getConnectorDefinition } from '../../connectors/catalog.js';
import { listConnectorInstances } from '../../connectors/instances.js';
import { ComposioSessionsAdapter } from '../../connectors/composio-sessions.js';
import {
  getConfiguredComposioAuthConfigs,
  getComposioToolkitScope,
  isComposioActionAllowedByCatalog,
  scopeForComposioAction,
} from '../../connectors/composio.js';
import type { ConnectorActionMetadata, ConnectorInstallationPolicy } from '../../connectors/types.js';
import { isToolInputSchema } from '../../connectors/connection-capabilities.js';
import { connectorPrincipalForSession } from '../../connectors/principal.js';
import { connectorIdentitySummary } from '../../connectors/connector-identity.js';
import { getSessionInputState } from '../../storage/sqlite/session-input-repository.js';
import { bindObjectiveAccount, connectorObjectiveScope, connectionBinding, connectionBindings, requireSessionConnection, publishConnectionWait } from '../../storage/sqlite/connection-wait-repository.js';
import { canAccessConnectorAccount, currentAccountConnections } from '../../connectors/account-access.js';
import { getConnectorAccount, getConnectorConnection } from '../../storage/sqlite/index.js';
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
import { createLogger } from '../../utils/logger.js';
import { ExternalToolSearchError } from './search-error.js';
import { externalToolRef, parseExternalToolRef } from './refs.js';
import type {
  ExternalToolDescriptor,
  ExternalToolExecutionContext,
  ExternalToolProvider,
  ExternalToolSearchHit,
} from './types.js';

const CONNECTION_ARGUMENT = 'xopcAccountId';
const log = createLogger('ComposioToolProvider');
const BATCH_READ_ACTIONS = new Set([
  'GMAIL_GET_PROFILE', 'GMAIL_GET_EMAIL', 'GMAIL_LIST_LABELS',
  'GOOGLEDRIVE_GET_ABOUT', 'GOOGLEDRIVE_GET_FILE_METADATA',
  'GITHUB_GET_THE_AUTHENTICATED_USER', 'GITHUB_GET_A_REPOSITORY', 'GITHUB_GET_REPOSITORY',
]);

type CurrentContext = { channel: string; chatId: string; conversationId: string } | null;

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

function actionDigest(action: ConnectorActionMetadata): string {
  const { cachedAt: _cachedAt, ...contract } = action;
  return connectorArgumentsHash(contract);
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
      enabled: existing?.enabled ?? true,
      allowedAgentIds: existing?.allowedAgentIds ?? [],
      maxScope: existing?.maxScope ?? getComposioToolkitScope(config, toolkit),
      confirmationPolicy: existing?.confirmationPolicy ?? 'writes',
      selectedAccountIds: existing?.selectedAccountIds ?? null,
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
  if (!isToolInputSchema(action.inputSchema)) throw new Error(`Exact input contract is unavailable for ${action.actionId}`);
  const schema = action.inputSchema;
  const properties = schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
    ? schema.properties as Record<string, unknown>
    : {};
  if (Object.hasOwn(properties, CONNECTION_ARGUMENT)) throw new Error('The provider contract conflicts with the reserved account selector.');
  return {
    ...schema,
    type: 'object',
    properties: {
      ...properties,
      [CONNECTION_ARGUMENT]: {
        type: 'string',
        description: 'Stable local account ID. Required when this objective uses multiple accounts. Never guess an account.',
      },
    },
  };
}

export class ComposioToolProvider implements ExternalToolProvider {
  readonly source = 'composio' as const;
  private readonly adapter: ComposioSessionsAdapter;
  private readonly unavailableToolkits = new Set<string>();

  constructor(private readonly deps: ComposioToolProviderDeps) {
    this.adapter = deps.adapter ?? new ComposioSessionsAdapter();
  }

  async search(query: string): Promise<ExternalToolSearchHit[]> {
    const available = this.availableInstallations();
    if (available.installations.length === 0) return [];
    const settled = await Promise.allSettled(available.installations.map(async (installation) => {
      const toolkit = toolkitFromInstallation(installation);
      let phase: 'create_session' | 'search' = 'create_session';
      try {
        const session = await this.adapter.createSession({
          principalId: available.principalId,
          toolkits: [toolkit],
          authConfigs: getConfiguredComposioAuthConfigs(this.deps.getConfig(), [toolkit]),
        });
        phase = 'search';
        return {
          installation,
          toolkit,
          result: await session.search({ query, toolkits: [toolkit] }),
        };
      } catch (cause) {
        throw new ExternalToolSearchError(phase, [toolkit], cause);
      }
    }));

    const hits: ExternalToolSearchHit[] = [];
    const failures: ExternalToolSearchError[] = [];
    for (const attempt of settled) {
      if (attempt.status === 'rejected') {
        failures.push(attempt.reason instanceof ExternalToolSearchError
          ? attempt.reason
          : new ExternalToolSearchError('search', [], attempt.reason));
        continue;
      }
      const { installation, toolkit, result } = attempt.value;
      this.unavailableToolkits.delete(toolkit);
      const schemas = result && typeof result === 'object' && !Array.isArray(result)
        ? (result as Record<string, unknown>).toolSchemas
        : undefined;
      if (!schemas || typeof schemas !== 'object' || Array.isArray(schemas)) continue;
      for (const [actionId, schema] of Object.entries(schemas)) {
        if (toolkitForAction(actionId, [toolkit]) !== toolkit || !isComposioActionAllowedByCatalog(actionId)) continue;
        const inputSchema = schema && typeof schema === 'object' ? (schema as Record<string, unknown>).inputSchema : undefined;
        if (!isToolInputSchema(inputSchema)) continue;
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
    }
    if (failures.length === settled.length) {
      const first = failures[0]!;
      throw new ExternalToolSearchError(
        first.phase,
        [...new Set(failures.flatMap(failure => failure.toolkits))],
        first,
      );
    }
    if (failures.length > 0) {
      const failedToolkits = [...new Set(failures.flatMap(failure => failure.toolkits))];
      const newlyUnavailable = failedToolkits.filter(toolkit => !this.unavailableToolkits.has(toolkit));
      failedToolkits.forEach(toolkit => this.unavailableToolkits.add(toolkit));
      if (newlyUnavailable.length > 0) {
        log.warn(
          { failedToolkits: newlyUnavailable, failureCount: newlyUnavailable.length, err: failures[0] },
          `Composio tool discovery skipped ${newlyUnavailable.length} unavailable toolkit${newlyUnavailable.length === 1 ? '' : 's'}`,
        );
      }
    }
    return hits;
  }

  async describe(toolRef: string): Promise<ExternalToolDescriptor | undefined> {
    const resolved = this.resolve(toolRef);
    if (!resolved) return undefined;
    const toolkit = toolkitFromInstallation(resolved.installation);
    const action = listConnectorActionMetadata(resolved.installation.connectorId)
      .find((candidate) => candidate.actionId === resolved.actionId);
    if (!action || !isToolInputSchema(action.inputSchema) || !isComposioActionAllowedByCatalog(action.actionId)) return undefined;
    const summary = `Run ${action.actionId} in ${toolkit}.`;
    const available = this.availableInstallations();
    const accounts = currentAccountConnections(listConnectorConnections({ principalId: available.principalId,
      connectorId: resolved.installation.connectorId }).filter(connection => canAccessConnectorAccount(connection, resolved.installation, available.agentId)))
      .map(connection => ({ accountId: connection.accountId, label: getConnectorAccount(connection.accountId!)?.label,
        identity: connectorIdentitySummary(connection.identity) }));
    return {
      toolRef,
      source: this.source,
      namespace: toolkit,
      title: action.actionId,
      summary,
      description: `${summary} Available accounts: ${JSON.stringify(accounts)}. Use xopcAccountId to select one; never guess when the user's intent is ambiguous.`,
      inputSchema: actionInputSchema(action),
      batchRead: accounts.length > 0 && action.scope === 'read' && action.curated && BATCH_READ_ACTIONS.has(action.actionId),
    };
  }

  async execute(
    toolRef: string,
    args: Record<string, unknown>,
    approvalId: string | undefined,
    context: ExternalToolExecutionContext,
  ) {
    const available = this.availableInstallations();
    const resolved = this.resolve(toolRef, available.installations);
    if (!resolved) return textResult('This connected app tool is not allowed for this user and agent.');
    let executionArgs = args;
    if (this.deps.hookRunner) {
      const hook = await this.deps.hookRunner.runBeforeToolCall(toolRef, args, {
        conversationId: available.context?.conversationId,
      });
      if (!hook.allowed) throw new Error(hook.reason ?? 'Connected app tool call blocked by policy hook.');
      executionArgs = hook.params ?? args;
    }
    const toolkit = toolkitFromInstallation(resolved.installation);
    const action = listConnectorActionMetadata(resolved.installation.connectorId)
      .find((candidate) => candidate.actionId === resolved.actionId);
    if (!action || !isToolInputSchema(action.inputSchema) || !isComposioActionAllowedByCatalog(resolved.actionId)) {
      return textResult('The exact action contract is unavailable. Search and describe the tool again.');
    }
    let fresh = await this.adapter.syncConnections({ principalId: available.principalId });
    const binding = available.context ? connectionBinding(available.context.conversationId, resolved.installation.connectorId) : undefined;
    const expired = fresh.find(item => item.connectorId === resolved.installation.connectorId && item.status === 'expired' && item.id === binding);
    if (expired) {
      const refreshed = await this.adapter.refreshConnection(expired);
      fresh = fresh.map(item => item.id === refreshed.id ? refreshed : item);
    }
    const connections = currentAccountConnections(listConnectorConnections({
      principalId: available.principalId,
      connectorId: resolved.installation.connectorId,
    }).filter((connection) => connection.status === 'active' && fresh.some(item => item.id === connection.id)
      && canAccessConnectorAccount(connection, resolved.installation, available.agentId)));
    const boundConnection = available.context ? connectionBinding(available.context.conversationId, resolved.installation.connectorId) : undefined;
    const requestedAccount = typeof executionArgs[CONNECTION_ARGUMENT] === 'string'
      ? executionArgs[CONNECTION_ARGUMENT]
      : boundConnection ? getConnectorConnection(boundConnection)?.accountId : undefined;
    const bindings = available.context ? connectionBindings(available.context.conversationId).filter(need => need.connectorId === resolved.installation.connectorId) : [];
    if (bindings.length > 1 && !requestedAccount) return textResult({ status: 'account_selection_required',
      accounts: bindings, instruction: 'Choose the account for this operation using xopcAccountId.' });
    if (bindings.length && requestedAccount && !bindings.some(need => need.accountId === requestedAccount)) {
      return textResult('This account was not selected for the current objective.');
    }
    const connection = requestedAccount
      ? connections.find((candidate) => candidate.accountId === requestedAccount)
      : connections.length === 1 ? connections[0] : undefined;
    const requestConnection = () => {
      if (!available.context) return textResult({ status: 'connection_required' });
      const result = requireSessionConnection({
        conversationId: available.context.conversationId, principalId: available.principalId,
        agentId: available.agentId ?? 'main', summary: `Continue ${action.actionId} using ${toolkit}`,
        needs: [{ key: `${resolved.installation.connectorId}:default`, connectorId: resolved.installation.connectorId,
          accountId: requestedAccount,
          label: getConnectorDefinition(resolved.installation.connectorId)?.displayName ?? toolkit,
          capabilities: [action.actionId] }],
      });
      publishConnectionWait(available.context.conversationId);
      return textResult(result);
    };
    if (!connection) return requestConnection();
    if (available.context && connection.accountId) bindObjectiveAccount(available.context.conversationId, resolved.installation.connectorId, connection.accountId);
    const actionArgs = { ...executionArgs };
    delete actionArgs[CONNECTION_ARGUMENT];
    const descriptorDigest = actionDigest(action);
    const argumentIdentity = () => connectorArgumentsHash({ args: actionArgs, accountId: connection.accountId,
      connectionId: connection.id, descriptorDigest, principalId: available.principalId,
      agentId: available.agentId, conversationId: available.context?.conversationId,
      objective: available.context ? connectorObjectiveScope(available.context.conversationId) : undefined });
    const argsHash = argumentIdentity();
    let confirmed = false;
    if (approvalId) {
      const pending = getConnectorApproval(approvalId);
      if (
        !pending
        || pending.principalId !== available.principalId
        || pending.connectorId !== resolved.installation.connectorId
        || pending.actionId !== action.actionId
        || pending.conversationId !== available.context?.conversationId
        || pending.agentId !== available.agentId
        || pending.connectionId !== connection.id
        || pending.argumentsHash !== argsHash
        || !['approved', 'consumed'].includes(pending.status)
        || (pending.status === 'approved' && Date.parse(pending.expiresAt) <= Date.now())
      ) return textResult('The connector approval is invalid for this session or action.');
      confirmed = true;
    }
    const authorizeCurrent = () => {
      context.signal?.throwIfAborted();
      const current = this.availableInstallations();
      const installation = this.resolve(toolRef, current.installations)?.installation;
      const active = getConnectorConnection(connection.id);
      const contract = listConnectorActionMetadata(resolved.installation.connectorId).find(item => item.actionId === action.actionId);
      if (!installation || current.principalId !== available.principalId || current.agentId !== available.agentId
        || current.context?.conversationId !== available.context?.conversationId
        || !active || active.status !== 'active' || active.accountId !== connection.accountId
        || active.providerConnectionId !== connection.providerConnectionId
        || getConnectorAccount(active.accountId!)?.currentConnectionId !== active.id
        || !canAccessConnectorAccount(active, installation, current.agentId)) {
        throw new CapabilityError('FORBIDDEN', 'Connected account authorization changed');
      }
      if (!contract || actionDigest(contract) !== descriptorDigest || argumentIdentity() !== argsHash) {
        throw new CapabilityError('REVISION_CONFLICT', 'Action contract or objective changed');
      }
      const evaluation = evaluateConnectorExecutionPolicy({ installation, action: contract, agentId: current.agentId,
        accountId: active.accountId, confirmed });
      if (evaluation.decision === 'denied') throw new CapabilityError('FORBIDDEN', evaluation.reason);
      return evaluation;
    };
    const evaluation = authorizeCurrent();
    let result: Awaited<ReturnType<ComposioSessionsAdapter['executeWithPolicy']>>;
    try {
      const execute = async () => this.adapter.executeWithPolicy({
      signal: context.signal,
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
      conversationId: available.context?.conversationId,
      confirmed,
      beforeExecute: () => {
        const current = authorizeCurrent();
        if (current.decision !== 'allowed') throw new ExternalEffectNotAppliedError(current.reason);
        if (approvalId && !consumeConnectorApproval(approvalId, argsHash)) {
          throw new ExternalEffectNotAppliedError('Approval is no longer available');
        }
      },
    });
      if (evaluation.decision === 'confirmation_required') {
        result = { decision: 'confirmation_required', reason: evaluation.reason };
      } else if (action.scope === 'read') {
        result = await execute();
      } else {
        result = await executeExternalOperation({
          principalId: available.principalId, capabilityId: toolRef,
          idempotencyKey: connectorArgumentsHash(approvalId ? { approvalId }
            : { conversationId: available.context?.conversationId, toolCallId: context.toolCallId }),
          requestDigest: argsHash, descriptorDigest, surface: 'agent', recovery: 'manual',
        }, async () => {
          const outcome = await execute();
          if (outcome.decision !== 'allowed') throw new ExternalEffectNotAppliedError(outcome.reason);
          return outcome;
        }, outcome => {
          if (outcome.result && typeof outcome.result === 'object'
            && 'successful' in outcome.result && outcome.result.successful === false) {
            throw new Error('Provider reported an unsuccessful action without proving that no effect was applied');
          }
          return outcome;
        });
      }
    } catch (error) {
      if (action.scope === 'read') {
        const checked = await this.adapter.syncConnections({ principalId: available.principalId }).catch(() => undefined);
        if (checked && !checked.some(item => item.id === connection.id && item.status === 'active')) return requestConnection();
      }
      throw error;
    }
    if (result.decision === 'confirmation_required') {
      const wait = available.context && getSessionInputState(available.context.conversationId).activeInputId
        ? requireSessionConnection({ conversationId: available.context.conversationId, principalId: available.principalId,
          agentId: available.agentId ?? 'main', summary: `Confirm ${action.actionId}`,
          needs: [{ key: `${resolved.installation.connectorId}:${connection.accountId}`, connectorId: resolved.installation.connectorId,
            accountId: connection.accountId, connectionId: connection.id, label: toolkit, capabilities: [action.actionId] }] }) : undefined;
      const approval = createConnectorApproval({
        waitId: wait?.waitId,
        principalId: available.principalId,
        connectorId: resolved.installation.connectorId,
        connectionId: connection?.id,
        agentId: available.agentId,
        conversationId: available.context?.conversationId,
        actionId: action.actionId,
        scope: action.scope,
        argumentsHash: argumentIdentity(),
        argumentsPreview: { account: { id: connection.accountId, label: getConnectorAccount(connection.accountId!)?.label,
          identity: connectorIdentitySummary(connection.identity) }, arguments: connectorArgumentsPreview(actionArgs) },
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      });
      if (available.context && wait?.waitId) publishConnectionWait(available.context.conversationId);
      return textResult({
        status: 'confirmation_required',
        approvalId: approval.id,
        actionId: approval.actionId,
        scope: approval.scope,
        argumentsPreview: approval.argumentsPreview,
        expiresAt: approval.expiresAt,
        account: { id: connection.accountId, label: getConnectorAccount(connection.accountId!)?.label, identity: connectorIdentitySummary(connection.identity) },
        instruction: 'Ask the user to approve this exact action in xopc, then retry with the approvalId and unchanged arguments.',
      });
    }
    return textResult(result.decision === 'allowed' ? {
      account: { id: connection.accountId, label: getConnectorAccount(connection.accountId!)?.label, identity: connectorIdentitySummary(connection.identity) },
      result: result.result,
    } : result.reason);
  }

  private availableInstallations(): {
    principalId: string;
    agentId?: string;
    context: CurrentContext;
    installations: ConnectorInstallationPolicy[];
  } {
    const context = this.deps.getCurrentContext();
    const principal = connectorPrincipalForSession(context?.conversationId);
    if (principal.isLocalOwner) syncLocalOwnerInstallations(this.deps.getConfig());
    const agentId = this.deps.agentId ?? principal.agentId;
    const config = this.deps.getConfig();
    const disabled = new Set(config ? listConnectorInstances(config).filter(instance => !instance.enabled).map(instance => instance.connectorId) : []);
    const installations = listConnectorInstallations(principal.principalId).filter((installation) => (
      installation.enabled
      && !disabled.has(installation.connectorId)
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
