import type { ConnectionWait, TaskRetryResult, TaskRun } from '@xopcai/gateway-contract';

import type { ConnectionRecoveryService } from '../connectors/connection-recovery-service.js';
import { canAccessConnectorAccount } from '../connectors/account-access.js';
import { connectorPrincipalForSession } from '../connectors/principal.js';
import { isPersonalConversation } from '../personal-agent/repository.js';
import { getPersonalRequest, personalRequestForTask, updatePersonalRequest, type PersonalRequest } from '../personal-agent/request-repository.js';
import { waitForPersonalRequestConnection } from '../personal-agent/request-service.js';
import { getActiveConnectionWait, getConnectionWait, publishConnectionWait } from '../storage/sqlite/connection-wait-repository.js';
import { getConnectorAccount } from '../storage/sqlite/connector-account-repository.js';
import { getConnectorConnection, getConnectorInstallation, listConnectorConnections } from '../storage/sqlite/connector-repository.js';
import { readCurrentTranscriptId } from '../storage/sqlite/session-instance-repository.js';
import { getSessionInputById } from '../storage/sqlite/session-input-repository.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { TaskApplicationService } from './task-application-service.js';
import { TaskOriginRepository } from './task-origin-repository.js';
import { TaskRepository } from './task-repository.js';
import { TaskRunRepository } from './task-run-repository.js';
import { isReadOnlyRetryDecision, isReadOnlyTaskRetry } from './task-retry-policy.js';

export type TaskRetryInput = ({ taskId: string; requestId?: never } | { requestId: string; taskId?: never }) & {
  idempotencyKey: string;
  expectedRunId?: string;
  conversationId?: string;
};

function connectionReadiness(request: PersonalRequest): 'ready' | 'reconnect' | 'blocked' {
  const principal = connectorPrincipalForSession(request.conversationId);
  const account = request.accountId ? getConnectorAccount(request.accountId) : undefined;
  const installation = getConnectorInstallation(`${request.connectorId}-${principal.principalId}`);
  if (!principal.isLocalOwner || !account || !installation) return 'blocked';
  const current = account.currentConnectionId ? getConnectorConnection(account.currentConnectionId) : undefined;
  const connection = current ?? listConnectorConnections({ principalId: principal.principalId, connectorId: request.connectorId })
    .find(item => item.accountId === account.id);
  if (!connection || connection.accountId !== account.id
    || !canAccessConnectorAccount(connection, installation, principal.agentId)
    || !canAccessConnectorAccount(connection, installation, request.executorAgentId)) return 'blocked';
  return current?.status === 'active' && (!current.expiresAt || Date.parse(current.expiresAt) > Date.now())
    ? 'ready' : 'reconnect';
}

/** Recheck a saved authorization wait, or create one new attempt of the latest failed run. */
export async function retryTask(input: TaskRetryInput, deps: {
  connectionRecovery: Pick<ConnectionRecoveryService, 'act' | 'snapshot'>;
  wake: () => void;
}): Promise<TaskRetryResult> {
  const tasks = new TaskRepository();
  const runs = new TaskRunRepository();
  const decision = runSqliteWriteTransaction<{ result: TaskRetryResult; wait?: ConnectionWait }>(db => {
    let request = input.taskId !== undefined ? personalRequestForTask(input.taskId) : getPersonalRequest(input.requestId);
    const taskId = input.taskId ?? request?.taskId;
    const task = taskId ? tasks.get(taskId) : undefined;
    const origin = request?.conversationId ?? (taskId ? new TaskOriginRepository().getConversationId(taskId) : undefined);
    const ids = { taskId, requestId: request?.requestId };
    const result = (status: TaskRetryResult['status'], run?: TaskRun, reason?: TaskRetryResult['reason']) =>
      ({ result: { ...ids, status, runId: run?.id, reason } satisfies TaskRetryResult });
    const withWait = (wait: ConnectionWait, run?: TaskRun) => ({ wait,
      result: { ...ids, status: 'waiting_connection', connectionConversationId: wait.conversationId, runId: run?.id } satisfies TaskRetryResult });

    if ((!task && !request) || (input.conversationId && origin !== input.conversationId)) return { result: { status: 'not_found' } as const };
    const personal = Boolean(request || (origin && isPersonalConversation(origin)));
    if (request && readCurrentTranscriptId(db, request.conversationId) !== request.transcriptId) return result('changed');
    const latest = taskId ? runs.getLatestRoot(taskId) : undefined;
    if (request?.state === 'cancelled' || task?.resolution === 'cancelled') return result('cancelled', latest);
    if (task?.phase === 'closed') {
      return result(task.resolution === 'done' && latest?.status === 'succeeded' ? 'succeeded' : 'not_retryable', latest);
    }
    const taskWaits = taskId ? runs.listActiveWaits(taskId) : [];
    const runWait = taskWaits.find(wait => wait.taskRunId === latest?.id && wait.condition.type === 'connection');
    const waitId = request?.state === 'waiting_connection' ? request.connectionWaitId : runWait?.condition.connectionWaitId;
    const wait = typeof waitId === 'string' ? getConnectionWait(waitId) : undefined;
    const key = `task-retry:${taskId}:${input.idempotencyKey}`;
    const previous = taskId ? runs.getByIdempotencyKey(key) : undefined;
    if (input.expectedRunId && latest?.id !== input.expectedRunId && latest?.retryOfRunId !== input.expectedRunId) return result('changed', latest);
    if (wait && wait.status !== 'closed') {
      if (readCurrentTranscriptId(db, wait.conversationId) !== wait.transcriptId) return result('changed', latest);
      return withWait(wait, latest);
    }
    if (previous) return result(previous.status, previous);
    if (!latest) return result('not_retryable');
    if (latest.status !== 'failed') return result(latest.status, latest);
    if (input.expectedRunId && latest.id !== input.expectedRunId) return result('changed', latest);
    if (!task || latest.contractVersion !== task.latestContractVersion || latest.executorKind !== 'agent'
      || typeof latest.executorRef.agentId !== 'string') return result('not_retryable', latest);
    const readOnly = !request && (personal || taskWaits.length > 0) && isReadOnlyTaskRetry(task, latest);
    if (personal && !request && !readOnly) return result('not_retryable', latest, 'read_scope_unverified');
    const decisionWaits = (request || readOnly) ? taskWaits.filter(wait =>
      wait.taskRunId === latest.id && isReadOnlyRetryDecision(wait.condition, Boolean(request))) : [];
    if (taskWaits.length !== decisionWaits.length || runs.getActiveRoot(task.id)) return result('blocked', latest, 'other_wait');

    const readiness = request ? connectionReadiness(request) : 'ready';
    if (readiness === 'blocked' || (request && request.executorAgentId !== latest.executorRef.agentId)) {
      return result('blocked', latest, 'account_unavailable');
    }
    if (readiness === 'reconnect' && request && getActiveConnectionWait(request.conversationId)) return result('blocked', latest, 'other_wait');
    const originInput = db.prepare('SELECT request_input_id FROM task_origin_links WHERE task_id = ?')
      .get(task.id) as { request_input_id: string | null } | undefined;
    const originalInputId = request?.inputId ?? originInput?.request_input_id;
    const originalRequestAt = origin
      ? (originalInputId ? getSessionInputById(origin, originalInputId)?.createdAtMs : undefined) ?? task.createdAt
      : undefined;
    const started = new TaskApplicationService().execute({
      taskId: task.id, expectedVersion: task.version, idempotencyKey: key,
      command: { type: 'start', executor: { kind: 'agent', agentId: latest.executorRef.agentId } },
      retry: { runId: latest.id, readOnly, originalRequestAt, decisionWaitIds: decisionWaits.map(wait => wait.id) },
      ...(latest.trigger.context && typeof latest.trigger.context === 'object' && !Array.isArray(latest.trigger.context)
        ? { triggerContext: latest.trigger.context as Record<string, unknown> } : {}),
    });
    if (!started.ok || !started.runId) return result('blocked', latest);
    const run = runs.require(started.runId);
    if (request) {
      request = updatePersonalRequest(request, { state: 'queued', connectionWaitId: undefined,
        parameters: { ...request.parameters, taskRunId: run.id } });
      db.prepare(`UPDATE personal_requests SET result_json = NULL, result_run_id = NULL, delivery_entry_id = NULL, notified_at = NULL,
        delivery_attempts = 0, delivery_next_attempt_at = 0, delivery_error = NULL WHERE request_id = ?`).run(request.requestId);
      if (readiness === 'reconnect') {
        const pending = waitForPersonalRequestConnection(request, run);
        return withWait(getConnectionWait(pending.connectionWaitId!)!, run);
      }
    }
    return result('queued', run);
  });

  if (decision.wait) {
    const { wait, result } = decision;
    publishConnectionWait(wait.conversationId);
    if (wait.status === 'open' && !wait.checking) {
      try {
        await deps.connectionRecovery.act(wait.conversationId, { waitId: wait.id, expectedTranscriptId: wait.transcriptId,
          expectedVersion: wait.version, idempotencyKey: `task-retry-check:${input.idempotencyKey}`, action: 'check',
          confirmUnchangedScope: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message === 'SESSION_CHANGED') return { ...result, status: 'changed' };
        if (message !== 'WAIT_CHANGED') return { ...result, reason: 'check_failed' };
      }
    }
    const current = getConnectionWait(wait.id);
    if (current?.resolution === 'continued' && (current.status === 'closed' || current.status === 'queued')) {
      const taskId = result.taskId ?? (result.requestId ? getPersonalRequest(result.requestId)?.taskId : undefined);
      const run = taskId ? runs.getLatestRoot(taskId) : undefined;
      deps.wake();
      const queued = current.status === 'queued' || (run?.status === 'waiting' && !runs.listActiveWaits(run.taskId).length);
      const status = queued ? 'queued' : run?.status ?? 'queued';
      return { taskId, requestId: result.requestId, runId: run?.id, status };
    }
    if (!current || current.status === 'closed' || readCurrentTranscriptId(getSqliteDatabase(), wait.conversationId) !== wait.transcriptId) {
      return { ...result, status: 'changed' };
    }
    const active = deps.connectionRecovery.snapshot(wait.conversationId).wait;
    return { ...result, connectionPhase: active?.id === wait.id ? active.phase : undefined };
  }
  if (decision.result.status === 'queued') deps.wake();
  return decision.result;
}
