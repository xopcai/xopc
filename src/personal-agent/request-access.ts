import { canAccessConnectorAccount } from '../connectors/account-access.js';
import { connectorPrincipalForSession } from '../connectors/principal.js';
import { getConnectorAccount } from '../storage/sqlite/connector-account-repository.js';
import { getConnectorConnection, getConnectorInstallation } from '../storage/sqlite/connector-repository.js';
import { readCurrentTranscriptId } from '../storage/sqlite/session-instance-repository.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { TaskConversationRepository } from '../tasks/task-conversation-repository.js';
import { TaskRunRepository } from '../tasks/task-run-repository.js';
import { getPersonalRequest, personalRequestForExecution, type PersonalRequest } from './request-repository.js';

/** Pin one tool call to its worker assignment; an account grant cannot revive a superseded call. */
export function createPersonalRequestExecutionAuthorizer(conversationId: string, request: PersonalRequest): () => void {
  const conversations = new TaskConversationRepository();
  const runs = new TaskRunRepository();
  const expected = conversations.resolveActiveExecutionSession(conversationId);
  const transcriptId = readCurrentTranscriptId(getSqliteDatabase(), conversationId);
  const authorize = () => {
    const current = conversations.resolveActiveExecutionSession(conversationId);
    const state = request.taskId ? conversations.getState(request.taskId) : undefined;
    const currentRequest = personalRequestForExecution(conversationId);
    const run = request.taskId ? runs.getActiveRoot(request.taskId) : undefined;
    if (!expected || !expected.runId || !current || !run || !transcriptId
      || expected.taskId !== request.taskId || expected.agentId !== request.executorAgentId
      || current.id !== expected.id || current.runId !== expected.runId
      || current.taskId !== expected.taskId || current.agentId !== expected.agentId
      || current.assignmentEpoch !== expected.assignmentEpoch
      || state?.status !== 'active' || state.activeConversationId !== conversationId
      || state.currentExecutorAgentId !== expected.agentId || state.assignmentEpoch !== expected.assignmentEpoch
      || run.id !== expected.runId || run.conversationId !== conversationId
      || (request.parameters.taskRunId && request.parameters.taskRunId !== run.id)
      || currentRequest?.requestId !== request.requestId || currentRequest.taskId !== expected.taskId
      || (currentRequest.parameters.taskRunId && currentRequest.parameters.taskRunId !== run.id)
      || readCurrentTranscriptId(getSqliteDatabase(), conversationId) !== transcriptId) {
      throw new Error('Personal request execution identity changed');
    }
    assertPersonalRequestAccountAccess(request);
  };
  authorize();
  return authorize;
}

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
