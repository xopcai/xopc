import { abortEmbeddedRun } from '../agent/embedded/runs.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { TaskApplicationService } from '../tasks/task-application-service.js';
import { TaskAllocationRepository } from '../tasks/task-allocation-repository.js';
import { TaskOriginRepository } from '../tasks/task-origin-repository.js';
import { TaskRepository } from '../tasks/task-repository.js';
import { TaskRunRepository } from '../tasks/task-run-repository.js';

/** Close before aborting so a late router decision or receipt cannot restart the task. */
export async function cancelPersonalTask(taskId: string, conversationId: string, key: string) {
  if (!new TaskOriginRepository().owns(taskId, conversationId)) throw new Error('Task does not belong to this personal conversation');
  const runs = new TaskRunRepository();
  const { active, changed } = runSqliteWriteTransaction(() => {
    const task = new TaskRepository().require(taskId);
    const run = runs.getActiveRoot(taskId);
    if (task.phase !== 'closed') {
      const result = new TaskApplicationService().execute({ taskId, expectedVersion: task.version,
        idempotencyKey: `personal-cancel:${key}`, command: { type: 'close', resolution: 'cancelled' }, actor: { kind: 'user' } });
      if (!result.ok) throw new Error('Task changed while cancelling');
    } else if (task.resolution !== 'cancelled') throw new Error('Task is already closed');
    getSqliteDatabase().prepare("UPDATE task_allocations SET status = 'cancelled', lease_token = NULL, updated_at = ? WHERE task_id = ? AND status != 'cancelled'").run(Date.now(), taskId);
    return { active: run, changed: task.phase !== 'closed' };
  });
  const latest = active ?? runs.getLatestRoot(taskId);
  let executionStopConfirmed = !latest || (!latest.conversationId && !latest.startedAt && ['queued', 'cancelled'].includes(latest.status));
  if (active?.conversationId) {
    // Abort acknowledgement does not certify that external side effects have stopped.
    await abortEmbeddedRun(active.conversationId);
    executionStopConfirmed = false;
  }
  const current = active ? runs.get(active.id) : undefined;
  if (current && runs.getActiveRoot(taskId)?.id === current.id) {
    new TaskApplicationService().completeRun({ runId: current.id, expectedRunVersion: current.version,
      actor: { kind: 'user' }, terminalCode: 'cancelled_by_user', suppressAttention: true,
      receipt: { status: 'cancelled', summary: 'Task cancelled', changes: [], evidence: [],
        verification: { status: 'unverified', checks: [] }, remainingWork: [], needsUser: false, completionVerdict: 'not_achieved' } });
  }
  if (changed && new TaskAllocationRepository().get(taskId)) {
    const zh = new TaskRepository().require(taskId).locale === 'zh';
    runSqliteWriteTransaction(() => new TaskAllocationRepository().publish(taskId, zh ? '任务已取消。' : 'Task cancelled.'));
  }
  return { ok: true, taskId, status: 'cancelled', executionStopConfirmed };
}
