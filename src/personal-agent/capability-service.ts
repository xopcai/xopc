import { AgentCatalogRepository } from '../agent-catalog/repository.js';
import { resolveEffectiveAgentConfig } from '../agent-config/index.js';
import { canAccessConnectorAccount, currentAccountConnections } from '../connectors/account-access.js';
import { connectionCandidates, resolveConnectionCandidate } from '../connectors/connection-candidates.js';
import { connectorPrincipalForSession } from '../connectors/principal.js';
import { getAvailablePersonalAgentTools, personalAgentModelAvailability } from '../agent/tools/personal-task-tool.js';
import { getConnectorInstallation, listConnectorConnections } from '../storage/sqlite/connector-repository.js';
import { isPersonalConversation } from './repository.js';

export interface PersonalCapability {
  connectorId: string;
  label: string;
  capabilities: string[];
  status: 'ready' | 'needs_connection' | 'needs_reauthorization' | 'needs_account_selection' | 'blocked' | 'unavailable';
  executorAgentIds: string[];
  accounts: { accountId: string; label: string; executorAgentIds: string[] }[];
  reason?: string;
}
export function personalCapabilities(conversationId: string, query: string, accountId?: string): PersonalCapability[] {
  if (!isPersonalConversation(conversationId)) throw new Error('Personal conversation is required');
  const principal = connectorPrincipalForSession(conversationId);
  if (!principal.isLocalOwner) throw new Error('Owner access is required');
  const repository = new AgentCatalogRepository();
  const catalog = repository.snapshot();
  return connectionCandidates(query).map(candidate => {
    resolveConnectionCandidate(candidate.candidateRef);
    const installation = getConnectorInstallation(`${candidate.candidateRef}-${principal.principalId}`);
    const executors = catalog.agents.filter(agent => agent.enabled !== false
      && agent.id !== principal.agentId && !agent.id.startsWith('personal-')
      && repository.get(agent.id)?.provisioningState === 'ready').filter(agent => {
      const config = resolveEffectiveAgentConfig({ defaults: catalog.defaults, agent }).config;
      const tools = getAvailablePersonalAgentTools(config, {});
      return ['xopc_tool_search', 'xopc_tool_describe', 'xopc_tool_execute'].every(tool => tools.includes(tool))
        && personalAgentModelAvailability(config).available
        && (!installation?.allowedAgentIds.length || installation.allowedAgentIds.includes(agent.id));
    });
    const connections = listConnectorConnections({ principalId: principal.principalId, connectorId: candidate.candidateRef });
    const relevantConnections = accountId ? connections.filter(connection => connection.accountId === accountId) : connections;
    const isExpired = (connection: typeof connections[number]) => Boolean(connection.expiresAt && Date.parse(connection.expiresAt) <= Date.now());
    const accounts = installation ? currentAccountConnections(connections).filter(connection => !isExpired(connection)).flatMap(connection => {
      const ids = canAccessConnectorAccount(connection, installation, principal.agentId)
        ? executors.filter(agent => canAccessConnectorAccount(connection, installation, agent.id)).map(agent => agent.id) : [];
      return ids.length && connection.accountId ? [{ accountId: connection.accountId,
        label: String(connection.identity.email ?? connection.identity.name ?? connection.alias ?? connection.accountId), executorAgentIds: ids }] : [];
    }) : [];
    const selected = accountId ? accounts.filter(account => account.accountId === accountId) : accounts;
    const blocked = (accountId && !relevantConnections.length) || (installation && (!installation.enabled
      || (installation.allowedAgentIds.length && (!principal.agentId || !installation.allowedAgentIds.includes(principal.agentId)))));
    const status: PersonalCapability['status'] = blocked ? 'blocked' : !executors.length ? 'unavailable'
      : selected.length === 1 ? 'ready' : selected.length > 1 ? 'needs_account_selection'
        : relevantConnections.some(connection => connection.status === 'active' && !isExpired(connection)) ? 'blocked'
          : relevantConnections.some(connection => ['expired', 'revoked'].includes(connection.status) || isExpired(connection)) ? 'needs_reauthorization' : 'needs_connection';
    return { connectorId: candidate.candidateRef, label: candidate.label, capabilities: candidate.capabilities, status,
      executorAgentIds: executors.map(agent => agent.id), accounts,
      ...(status === 'unavailable' ? { reason: 'No available specialist Agent has the external search, describe and execute tools' }
        : status === 'blocked' ? { reason: 'Connector or account policy does not allow this request' } : {}) };
  });
}
