import { randomUUID } from 'node:crypto';

import { TaskExecutorSelectionSchema } from '@xopcai/gateway-contract';

import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { TaskApplicationService } from './task-application-service.js';
import { TaskRepository } from './task-repository.js';
import { TaskRunRepository } from './task-run-repository.js';

export class TaskSignalService {
  readonly #runs = new TaskRunRepository();
  readonly #tasks = new TaskRepository();
  readonly #application = new TaskApplicationService();

  constructor(private readonly dispatch?: () => void) {}

  dependencyClosed(dependencyTaskId: string): number {
    const rows = getSqliteDatabase().prepare(
      `SELECT wait_id FROM task_waits WHERE status = 'active' AND kind = 'dependency'
       AND json_extract(condition_json, '$.dependsOnTaskId') = ?`,
    ).all(dependencyTaskId) as Array<{ wait_id: string }>;
    return this.resolveAndResume(rows.map((row) => row.wait_id), { dependencyTaskId });
  }

  tick(now = Date.now()): number {
    const rows = getSqliteDatabase().prepare(
      `SELECT wait_id FROM task_waits WHERE status = 'active'
       AND kind IN ('scheduled_time', 'retry_backoff') AND resume_at <= ?`,
    ).all(now) as Array<{ wait_id: string }>;
    return this.resolveAndResume(rows.map((row) => row.wait_id), { resumedAt: now });
  }

  private resolveAndResume(waitIds: string[], resolution: unknown): number {
    const candidates = new Map<string, unknown>();
    for (const waitId of waitIds) {
      const wait = this.#runs.getWait(waitId);
      if (!wait) continue;
      candidates.set(wait.taskId, wait.condition.executor);
      this.#runs.resolveWait({ waitId, actor: { kind: 'system', id: 'task-signal' }, resolution });
    }
    let resumed = 0;
    for (const [taskId, rawExecutor] of candidates) {
      if (this.#runs.listActiveWaits(taskId).length > 0) continue;
      const activeRun = this.#runs.getActiveRoot(taskId);
      if (activeRun?.status === 'waiting') {
        resumed += 1;
        continue;
      }
      if (activeRun) continue;
      const task = this.#tasks.get(taskId);
      const executor = TaskExecutorSelectionSchema.safeParse(rawExecutor);
      if (!task || task.phase === 'closed' || !executor.success) continue;
      const result = this.#application.execute({
        taskId,
        expectedVersion: task.version,
        idempotencyKey: randomUUID(),
        command: { type: 'start', executor: executor.data },
        actor: { kind: 'system', id: 'task-signal' },
      });
      if (result.ok && result.runId) resumed += 1;
    }
    if (resumed > 0) this.dispatch?.();
    return resumed;
  }
}
