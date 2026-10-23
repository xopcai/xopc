import { abortEmbeddedRun } from '../agent/embedded/runs.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { TaskApplicationService } from '../tasks/task-application-service.js';
import { TaskAllocationRepository } from '../tasks/task-allocation-repository.js';
import { TaskOriginRepository } from '../tasks/task-origin-repository.js';
import { TaskRepository } from '../tasks/task-repository.js';
import { TaskRunRepository } from '../tasks/task-run-repository.js';
import { getSessionInputById, getSessionInputState } from '../storage/sqlite/session-input-repository.js';
import { getEmbeddedRunByConversationId } from '../agent/embedded/runs.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('PersonalTaskCancel');
const pendingStops = new Set<string>();

function finalizeCancellation(runId: string | undefined): void {
  const runs = new TaskRunRepository();
  const run = runId ? runs.get(runId) : undefined;
  if (!run || !['queued', 'running', 'waiting', 'verifying', 'cancelled'].includes(run.status)) return;
  runs.resolveCancelledRunWaits(run.id, { kind: 'user' });
  if (run.status === 'cancelled') return;
  const result = new TaskApplicationService().completeRun({ runId: run.id, expectedRunVersion: run.version,
    actor: { kind: 'user' }, terminalCode: 'cancelled_by_user', suppressAttention: true,
    receipt: { status: 'cancelled', summary: 'Task cancelled', changes: [], evidence: [],
      verification: { status: 'unverified', checks: [] }, remainingWork: [], needsUser: false, completionVerdict: 'not_achieved' } });
  if (!result.ok) throw new Error('Task changed while cancelling');
}

/** Close before aborting so a late router decision or receipt cannot restart the task. */
export async function cancelPersonalTask(taskId: string, conversationId: string, key: string) {
  if (!new TaskOriginRepository().owns(taskId, conversationId)) throw new Error('Task does not belong to this personal conversation');
  const runs = new TaskRunRepository();
  const { active, changed, targetKnown } = runSqliteWriteTransaction(() => {
    const previous = getSqliteDatabase().prepare(`SELECT subject_id, result_json FROM command_deduplication
      WHERE idempotency_key = ?`).get(`personal-cancel:${key}`) as { subject_id: string; result_json: string } | undefined;
    if (previous) {
      if (previous.subject_id !== taskId) throw new Error('Cancellation key belongs to another Task');
      const saved = JSON.parse(previous.result_json) as { cancellationRunId: string | null };
      if (!Object.hasOwn(saved, 'cancellationRunId')) throw new Error('Invalid cancellation receipt');
      const active = saved.cancellationRunId ? runs.get(saved.cancellationRunId) : undefined;
      finalizeCancellation(active?.id);
      return { active, changed: false, targetKnown: true };
    }
    const task = new TaskRepository().require(taskId);
    if (task.phase === 'closed' && task.resolution !== 'cancelled') throw new Error('Task is already closed');
    const run = runs.getActiveRoot(taskId) ?? (task.phase === 'closed' ? runs.getLatestRoot(taskId) : undefined);
    // Every accepted key needs a durable target, including retries while already closed.
    const result = new TaskApplicationService().execute({ taskId, expectedVersion: task.version,
      idempotencyKey: `personal-cancel:${key}`, command: { type: 'close', resolution: 'cancelled' }, actor: { kind: 'user' } });
    if (!result.ok) throw new Error('Task changed while cancelling');
    getSqliteDatabase().prepare(`UPDATE command_deduplication SET result_json = json_set(result_json, '$.cancellationRunId', ?)
      WHERE idempotency_key = ?`).run(run?.id ?? null, `personal-cancel:${key}`);
    getSqliteDatabase().prepare("UPDATE task_allocations SET status = 'cancelled', lease_token = NULL, updated_at = ? WHERE task_id = ? AND status != 'cancelled'").run(Date.now(), taskId);
    finalizeCancellation(run?.id);
    return { active: run, changed: task.phase !== 'closed', targetKnown: true };
  });
  let executionStopConfirmed = targetKnown && (!active || (!active.conversationId && !active.startedAt && ['queued', 'cancelled'].includes(active.status)));
  if (active?.conversationId) {
    // Abort acknowledgement does not certify that external side effects have stopped.
    const state = getSessionInputState(active.conversationId);
    const input = state.activeInputId ? getSessionInputById(active.conversationId, state.activeInputId) : undefined;
    const embedded = getEmbeddedRunByConversationId(active.conversationId);
    const executionId = input?.taskRunId === active.id ? state.activeRunId : embedded?.runId === active.id ? active.id : undefined;
    if (executionId && !pendingStops.has(executionId)) {
      pendingStops.add(executionId);
      void abortEmbeddedRun(active.conversationId, 'user_cancelled', executionId).catch(err => {
        log.warn({ err, taskId, runId: active.id, executionId }, 'Task cancelled; execution stop was not confirmed');
      }).finally(() => { pendingStops.delete(executionId); });
    }
    executionStopConfirmed = false;
  }
  if (changed && new TaskAllocationRepository().get(taskId)) {
    const zh = new TaskRepository().require(taskId).locale === 'zh';
    runSqliteWriteTransaction(() => new TaskAllocationRepository().publish(taskId, zh ? '任务已取消。' : 'Task cancelled.'));
  }
  return { ok: true, taskId, status: 'cancelled', executionStopConfirmed };
}
