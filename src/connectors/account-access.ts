import { getConnectorAccount } from '../storage/sqlite/connector-account-repository.js';
import type { ConnectorConnection, ConnectorInstallationPolicy } from './types.js';

/** Account policy can only narrow the installation's permissions. */
export function canAccessConnectorAccount(
  connection: ConnectorConnection,
  installation: ConnectorInstallationPolicy,
  agentId?: string,
): boolean {
  if (!installation.enabled || connection.principalId !== installation.principalId
    || connection.connectorId !== installation.connectorId || !connection.accountId) return false;
  if (installation.allowedAgentIds.length && (!agentId || !installation.allowedAgentIds.includes(agentId))) return false;
  if (installation.selectedAccountIds !== null && !installation.selectedAccountIds.includes(connection.accountId)) return false;
  const account = getConnectorAccount(connection.accountId);
  return Boolean(account?.enabled && (account.allowedAgentIds === null
    || (agentId && account.allowedAgentIds.includes(agentId))));
}

export function currentAccountConnections(connections: ConnectorConnection[]): ConnectorConnection[] {
  const byAccount = new Map<string, ConnectorConnection>();
  for (const connection of connections) {
    if (!connection.accountId || connection.status !== 'active') continue;
    const existing = byAccount.get(connection.accountId);
    const currentId = getConnectorAccount(connection.accountId)?.currentConnectionId;
    if (!existing || connection.id === currentId
      || (existing.id !== currentId && connection.updatedAt > existing.updatedAt)) {
      byAccount.set(connection.accountId, connection);
    }
  }
  return [...byAccount.values()];
}
