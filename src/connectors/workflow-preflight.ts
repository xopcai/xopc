import type { Config } from '../config/schema.js';
import { listConnectorConnections, getConnectorInstallation } from '../storage/sqlite/connector-repository.js';
import type { WorkflowConnectorRequirement, WorkflowDefinition } from '../workflows/domain/definition.js';
import { getComposioToolkitScope } from './composio.js';
import { getConnectorDefinition } from './catalog.js';
import { listConnectorInstances } from './instances.js';
import type { ConnectorScope } from './types.js';
import { canAccessConnectorAccount, currentAccountConnections } from './account-access.js';

export type ConnectorPreflightIssueCode =
  | 'not_installed'
  | 'disabled'
  | 'agent_not_allowed'
  | 'scope_too_narrow'
  | 'connection_missing'
  | 'account_selection_required'
  | 'reauthorization_required';

export type ConnectorPreflightIssue = {
  connectorId: string;
  code: ConnectorPreflightIssueCode;
  message: string;
  recoveryPath: string;
};

export type ConnectorPreflightResult = {
  ok: boolean;
  accounts: Record<string, string[]>;
  issues: ConnectorPreflightIssue[];
  optionalIssues: ConnectorPreflightIssue[];
};

export type ConnectorRequirementPreflightInput = {
  requirements: readonly WorkflowConnectorRequirement[];
  config: Config;
  agentId: string;
  principalId?: string;
};

const SCOPE_ORDER: Record<ConnectorScope, number> = { read: 1, write: 2, admin: 3 };

function issue(requirement: WorkflowConnectorRequirement, code: ConnectorPreflightIssueCode, message: string): ConnectorPreflightIssue {
  return {
    connectorId: requirement.connectorId,
    code,
    message,
    recoveryPath: `/connectors?connector=${encodeURIComponent(requirement.connectorId)}`,
  };
}

export function preflightConnectorRequirements(input: ConnectorRequirementPreflightInput): ConnectorPreflightResult {
  const principalId = input.principalId ?? 'local-owner';
  const instances = listConnectorInstances(input.config);
  const issues: ConnectorPreflightIssue[] = [];
  const accounts: Record<string, string[]> = {};
  const optionalIssues: ConnectorPreflightIssue[] = [];
  const add = (requirement: WorkflowConnectorRequirement, value: ConnectorPreflightIssue): void => {
    (requirement.optional ? optionalIssues : issues).push(value);
  };

  for (const requirement of input.requirements) {
    const instance = instances.find((candidate) => candidate.connectorId === requirement.connectorId);
    if (!instance) {
      add(requirement, issue(requirement, 'not_installed', `${requirement.connectorId} is not installed.`));
      continue;
    }
    if (!instance.enabled) {
      add(requirement, issue(requirement, 'disabled', `${requirement.connectorId} is disabled.`));
      continue;
    }
    const definition = getConnectorDefinition(requirement.connectorId);
    if (definition?.runtime.type !== 'cli' && (definition?.runtime.type !== 'composio' || definition.runtime.role !== 'toolkit')) continue;

    const toolkit = definition.runtime.type === 'composio' ? definition.runtime.toolkit : undefined;
    const installation = getConnectorInstallation(`${requirement.connectorId}-${principalId}`);
    if (definition.runtime.type === 'cli' && (!installation || !installation.enabled)) {
      add(requirement, issue(requirement, 'disabled', `${requirement.connectorId} policy is disabled or missing.`));
      continue;
    }
    if (installation?.allowedAgentIds.length && !installation.allowedAgentIds.includes(input.agentId)) {
      add(requirement, issue(requirement, 'agent_not_allowed', `${input.agentId} is not allowed to use ${requirement.connectorId}.`));
      continue;
    }
    const allowedScope = installation?.maxScope ?? (toolkit ? getComposioToolkitScope(input.config, toolkit) : 'read');
    const requiredScope = requirement.scope ?? 'read';
    if (SCOPE_ORDER[allowedScope] < SCOPE_ORDER[requiredScope]) {
      add(requirement, issue(requirement, 'scope_too_narrow', `${requirement.connectorId} requires ${requiredScope} scope but allows ${allowedScope}.`));
      continue;
    }
    if (requirement.connectionRequired === false) continue;
    const connections = listConnectorConnections({ principalId, connectorId: requirement.connectorId }).filter(connection => definition.runtime.type !== 'cli' || (connection.provider === 'cli' && connection.metadata.runtimeInstanceId === instance.instanceId));
    const selected = installation && installation.selectedAccountIds !== null
      ? connections.filter((connection) => connection.accountId && installation.selectedAccountIds!.includes(connection.accountId))
      : connections;
    const active = currentAccountConnections(selected.filter(connection => installation
      && canAccessConnectorAccount(connection, installation, input.agentId)));
    if (requirement.accountIds) {
      if (!requirement.accountIds.length || requirement.accountIds.some(id => !active.some(connection => connection.accountId === id))) {
        add(requirement, issue(requirement, 'connection_missing', `${requirement.connectorId} has an unavailable selected account. Reconnect or update its permissions; no other account will be substituted.`));
      } else accounts[requirement.connectorId] = [...requirement.accountIds];
      continue;
    }
    if (active.length > 1) {
      add(requirement, issue(requirement, 'account_selection_required', `${requirement.connectorId} has multiple available accounts. Select the intended account before unattended execution.`));
      continue;
    }
    if (active.length === 1) { accounts[requirement.connectorId] = [active[0].accountId!]; continue; }
    const needsAuthorization = selected.some((connection) => connection.status === 'expired' || connection.status === 'failed');
    add(requirement, issue(
      requirement,
      needsAuthorization ? 'reauthorization_required' : 'connection_missing',
      needsAuthorization
        ? `${requirement.connectorId} needs to be reconnected.`
        : `${requirement.connectorId} has no active account connection.`,
    ));
  }
  return { ok: issues.length === 0, accounts, issues, optionalIssues };
}

export function preflightWorkflowConnectors(input: {
  definition: WorkflowDefinition;
  config: Config;
  agentId: string;
  principalId?: string;
}): ConnectorPreflightResult {
  return preflightConnectorRequirements({
    requirements: input.definition.connectors ?? [],
    config: input.config,
    agentId: input.agentId,
    ...(input.principalId ? { principalId: input.principalId } : {}),
  });
}
