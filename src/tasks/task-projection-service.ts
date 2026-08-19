import {
  listUnprojectedExecutionReceipts,
  markExecutionReceiptProjected,
  type ExecutionReceipt,
} from '../storage/sqlite/index.js';
import { TaskRepository } from './task-repository.js';

export const EXECUTION_RECEIPT_PROJECTION_VERSION = 4;
const MAX_AUTONOMOUS_ATTEMPTS = 3;

function canRecoverAutonomously(task: ExecutionReceipt): boolean {
  return task.status === 'failed'
    && task.attempt < MAX_AUTONOMOUS_ATTEMPTS
    && task.failure?.recoveryAction !== 'request_user_input'
    && task.failure?.recoveryAction !== 'none';
}

export class TaskProjectionService {
  readonly #tasks = new TaskRepository();

  project(task: ExecutionReceipt): ExecutionReceipt {
    if (task.status === 'running' || task.projectionVersion >= EXECUTION_RECEIPT_PROJECTION_VERSION) {
      return task;
    }
    const verdict = task.completionVerdict;
    const recovering = canRecoverAutonomously(task);

    if (task.context.taskId) {
      if (verdict === 'achieved') {
        this.#tasks.update(task.context.taskId, {
          status: 'completed',
          latestReceiptRunId: task.runId,
        });
      } else if (verdict === 'partial') {
        this.#tasks.update(task.context.taskId, {
          status: task.needsUser ? 'needs_user' : 'running',
          latestReceiptRunId: task.runId,
        });
      } else if (verdict === 'not_achieved') {
        this.#tasks.update(task.context.taskId, {
          status: task.status === 'cancelled' ? 'cancelled' : recovering ? 'running' : 'blocked',
          latestReceiptRunId: task.runId,
        });
      }
    }

    return markExecutionReceiptProjected({
      runId: task.runId,
      projectionVersion: EXECUTION_RECEIPT_PROJECTION_VERSION,
    }) ?? task;
  }

  reconcile(limit = 100): number {
    const pending = listUnprojectedExecutionReceipts({
      projectionVersion: EXECUTION_RECEIPT_PROJECTION_VERSION,
      limit,
    });
    for (const task of pending) this.project(task);
    return pending.length;
  }
}
