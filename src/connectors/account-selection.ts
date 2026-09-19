import { connectionBindings, bindObjectiveAccount } from '../storage/sqlite/connection-wait-repository.js';
import { listConnectorConnections } from '../storage/sqlite/connector-repository.js';
import { canAccessConnectorAccount, currentAccountConnections } from './account-access.js';
import type { ConnectorInstallationPolicy } from './types.js';

/** Resolve one explicitly allowed account without falling back from an unavailable selection. */
export function selectConnectorAccount(input: {
  installation: ConnectorInstallationPolicy;
  agentId?: string;
  conversationId?: string;
  requestedAccountId?: string;
  accept?: (connection: ReturnType<typeof listConnectorConnections>[number]) => boolean;
}) {
  const { installation } = input;
  const candidates = currentAccountConnections(listConnectorConnections({ principalId: installation.principalId, connectorId: installation.connectorId })
    .filter(connection => connection.status === 'active' && canAccessConnectorAccount(connection, installation, input.agentId) && (!input.accept || input.accept(connection))));
  const bindings = input.conversationId ? connectionBindings(input.conversationId).filter(binding => binding.connectorId === installation.connectorId) : [];
  const requested = input.requestedAccountId ?? (bindings.length === 1 ? bindings[0]?.accountId : undefined);
  if (requested && bindings.length && !bindings.some(binding => binding.accountId === requested)) throw new Error('This account is not selected for the current objective.');
  const connection = requested ? candidates.find(candidate => candidate.accountId === requested)
    : bindings.length > 1 ? undefined : candidates.length === 1 ? candidates[0] : undefined;
  if (connection?.accountId && input.conversationId) bindObjectiveAccount(input.conversationId, installation.connectorId, connection.accountId);
  return { connection, candidates, requestedAccountId: requested };
}
