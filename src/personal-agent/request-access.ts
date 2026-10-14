import { canAccessConnectorAccount } from '../connectors/account-access.js';
import { connectorPrincipalForSession } from '../connectors/principal.js';
import { getConnectorAccount } from '../storage/sqlite/connector-account-repository.js';
import { getConnectorConnection, getConnectorInstallation } from '../storage/sqlite/connector-repository.js';
import { readCurrentTranscriptId } from '../storage/sqlite/session-instance-repository.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { getPersonalRequest, type PersonalRequest } from './request-repository.js';

/** Revalidate both owner and executor; collaboration cannot grant account access. */
export function assertPersonalRequestAccountAccess(request: PersonalRequest): void {
  const current = getPersonalRequest(request.requestId);
  if (!current || ['cancelled', 'completed', 'failed'].includes(current.state)) throw new Error('Personal request is no longer active');
  if (current.accountId !== request.accountId || current.connectorId !== request.connectorId || current.executorAgentId !== request.executorAgentId) throw new Error('Personal request execution identity changed');
  if (readCurrentTranscriptId(getSqliteDatabase(), request.conversationId) !== request.transcriptId) throw new Error('SESSION_CHANGED');
  const principal = connectorPrincipalForSession(request.conversationId);
  const account = request.accountId ? getConnectorAccount(request.accountId) : undefined;
  const connection = account?.currentConnectionId ? getConnectorConnection(account.currentConnectionId) : undefined;
  const installation = getConnectorInstallation(`${request.connectorId}-${principal.principalId}`);
  if (!principal.isLocalOwner || !installation || !connection
    || account?.connectorId !== request.connectorId
    || !canAccessConnectorAccount(connection, installation, principal.agentId)
    || !canAccessConnectorAccount(connection, installation, request.executorAgentId)) {
    throw new Error('Selected account authorization no longer permits this Personal request');
  }
}
