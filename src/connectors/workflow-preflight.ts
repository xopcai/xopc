import type { Config } from '../config/schema.js';
import { listConnectorConnections, getConnectorInstallation } from '../storage/sqlite/connector-repository.js';
import type { WorkflowConnectorRequirement, WorkflowDefinition } from '../workflows/domain/definition.js';
import { getComposioToolkitScope } from './composio.js';
import { getConnectorDefinition } from './catalog.js';
import { listConnectorInstances } from './instances.js';
import type { ConnectorScope } from './types.js';

export type ConnectorPreflightIssueCode =
  | 'not_installed'
  | 'disabled'
  | 'agent_not_allowed'
  | 'scope_too_narrow'
  | 'connection_missing'
  | 'reauthorization_required';

export type ConnectorPreflightIssue = {
  connectorId: string;
  code: ConnectorPreflightIssueCode;
  message: string;
  recoveryPath: string;
};

export type ConnectorPreflightResult = {
  ok: boolean;
  issues: ConnectorPreflightIssue[];
  optionalIssues: ConnectorPreflightIssue[];
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

export function preflightWorkflowConnectors(input: {
  definition: WorkflowDefinition;
  config: Config;
  agentId: string;
  principalId?: string;
}): ConnectorPreflightResult {
  const principalId = input.principalId ?? 'local-owner';
  const instances = listConnectorInstances(input.config);
  const issues: ConnectorPreflightIssue[] = [];
  const optionalIssues: ConnectorPreflightIssue[] = [];
  const add = (requirement: WorkflowConnectorRequirement, value: ConnectorPreflightIssue): void => {
    (requirement.optional ? optionalIssues : issues).push(value);
  };

  for (const requirement of input.definition.connectors ?? []) {
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
    if (definition?.runtime.type !== 'composio' || definition.runtime.role !== 'toolkit') continue;

    const toolkit = definition.runtime.toolkit;
    const installation = getConnectorInstallation(`${requirement.connectorId}-${principalId}`);
    if (installation?.allowedAgentIds.length && !installation.allowedAgentIds.includes(input.agentId)) {
      add(requirement, issue(requirement, 'agent_not_allowed', `${input.agentId} is not allowed to use ${requirement.connectorId}.`));
      continue;
    }
    const allowedScope = installation?.maxScope ?? getComposioToolkitScope(input.config, toolkit);
    const requiredScope = requirement.scope ?? 'read';
    if (SCOPE_ORDER[allowedScope] < SCOPE_ORDER[requiredScope]) {
      add(requirement, issue(requirement, 'scope_too_narrow', `${requirement.connectorId} requires ${requiredScope} scope but allows ${allowedScope}.`));
      continue;
    }
    if (requirement.connectionRequired === false) continue;
    const connections = listConnectorConnections({ principalId, connectorId: requirement.connectorId });
    const selected = installation?.selectedConnectionIds.length
      ? connections.filter((connection) => installation.selectedConnectionIds.includes(connection.id))
      : connections;
    if (selected.some((connection) => connection.status === 'active')) continue;
    const needsAuthorization = selected.some((connection) => connection.status === 'expired' || connection.status === 'failed');
    add(requirement, issue(
      requirement,
      needsAuthorization ? 'reauthorization_required' : 'connection_missing',
      needsAuthorization
        ? `${requirement.connectorId} needs to be reconnected.`
        : `${requirement.connectorId} has no active account connection.`,
    ));
  }
  return { ok: issues.length === 0, issues, optionalIssues };
}
