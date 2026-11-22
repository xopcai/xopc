import type { TaskRun } from '@xopcai/gateway-contract';

import { resolveConnectionCandidate } from '../connectors/connection-candidates.js';
import { connectorPrincipalForSession } from '../connectors/principal.js';
import { requireSessionConnection } from '../storage/sqlite/connection-wait-repository.js';
import { TaskCollaborationRepository } from '../tasks/task-collaboration-repository.js';
import { TaskRunRepository } from '../tasks/task-run-repository.js';
import { updatePersonalRequest, type PersonalRequest } from './request-repository.js';

/** Caller owns the write transaction that binds the request and its run. */
export function waitForPersonalRequestConnection(request: PersonalRequest, run: TaskRun): PersonalRequest {
  const principal = connectorPrincipalForSession(request.conversationId);
  const result = requireSessionConnection({ conversationId: request.conversationId, principalId: principal.principalId,
    agentId: principal.agentId!, summary: request.objective,
    origin: { inputId: request.inputId, runId: `personal-request:${request.requestId}` },
    needs: [{ ...resolveConnectionCandidate(request.connectorId), accountId: request.accountId, unavailable: true }],
    checkpoint: { completedSteps: [], pendingSteps: [request.objective], timeRange: request.parameters.timeRange } });
  if (result.status !== 'connection_required' || !result.waitId) throw new Error(`Connection request: ${result.status}`);
  const runs = new TaskRunRepository();
  if (!runs.listActiveWaits(run.taskId).some(wait => wait.condition.connectionWaitId === result.waitId)) {
    runs.createWait({ taskId: run.taskId, taskRunId: run.id, kind: 'user_input', reason: 'Reconnect the selected app account',
      condition: { type: 'connection', connectionWaitId: result.waitId } });
  }
  if (run.status !== 'waiting') runs.setStatus({ runId: run.id, expectedVersion: run.version, from: [run.status], to: 'waiting', actor: { kind: 'system' } });
  new TaskCollaborationRepository().append({ taskId: run.taskId, taskRunId: run.id,
    authorKind: 'system', authorId: 'personal-request', kind: 'progress',
    body: /[\u3400-\u9fff]/u.test(request.objective) ? '选定账户需要在主对话原连接界面重新授权。文字回答或补充指令不能解除此授权等待。' : 'Selected app account needs reconnection in the existing main connection UI. This authorization wait cannot be resolved by a text answer or instruction.',
    idempotencyKey: `personal-connection-wait:${result.waitId}` });
  return updatePersonalRequest(request, { state: 'waiting_connection', connectionWaitId: result.waitId,
    parameters: { ...request.parameters, taskRunId: run.id } });
}
