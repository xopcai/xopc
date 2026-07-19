import type {
  ConnectorActionMetadata,
  ConnectorExecutionDecision,
  ConnectorInstallationPolicy,
  ConnectorScope,
} from './types.js';

const SCOPE_ORDER: Record<ConnectorScope, number> = {
  read: 1,
  write: 2,
  admin: 3,
};

export type ConnectorPolicyEvaluation = {
  decision: ConnectorExecutionDecision;
  reason: string;
};

function requiresConfirmation(
  policy: ConnectorInstallationPolicy['confirmationPolicy'],
  scope: ConnectorScope,
): boolean {
  if (policy === 'always') return true;
  if (policy === 'writes') return scope === 'write' || scope === 'admin';
  if (policy === 'admin') return scope === 'admin';
  return false;
}

/** Evaluate every local policy layer before an external connector action is called. */
export function evaluateConnectorExecutionPolicy(input: {
  installation: ConnectorInstallationPolicy;
  action: Pick<ConnectorActionMetadata, 'scope' | 'curated'>;
  agentId?: string;
  connectionId?: string;
  confirmed?: boolean;
}): ConnectorPolicyEvaluation {
  const { installation, action } = input;
  if (!installation.enabled) {
    return { decision: 'denied', reason: 'Connector is disabled.' };
  }
  if (
    installation.allowedAgentIds.length > 0 &&
    (!input.agentId || !installation.allowedAgentIds.includes(input.agentId))
  ) {
    return { decision: 'denied', reason: 'Agent is not allowed to use this connector.' };
  }
  if (
    installation.selectedConnectionIds.length > 0 &&
    (!input.connectionId || !installation.selectedConnectionIds.includes(input.connectionId))
  ) {
    return { decision: 'denied', reason: 'Connection is not allowed by this connector policy.' };
  }
  if (SCOPE_ORDER[installation.maxScope] < SCOPE_ORDER[action.scope]) {
    return {
      decision: 'denied',
      reason: `Action requires ${action.scope} scope; connector allows ${installation.maxScope}.`,
    };
  }
  if (!action.curated && installation.maxScope !== 'admin') {
    return {
      decision: 'denied',
      reason: 'Unverified connector actions require admin scope.',
    };
  }
  if (!input.confirmed && requiresConfirmation(installation.confirmationPolicy, action.scope)) {
    return {
      decision: 'confirmation_required',
      reason: `Action requires ${action.scope} confirmation.`,
    };
  }
  return { decision: 'allowed', reason: 'Connector policy allows this action.' };
}
