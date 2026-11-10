import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import type { Task, TaskRun } from '@xopcai/gateway-contract';

import { TaskRepository } from './task-repository.js';
import { TaskRunRepository } from './task-run-repository.js';

export type TaskDeletionInspection =
  | { ok: true; task: Task }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'active_run'; run: TaskRun };

export class TaskDeletionService {
  constructor(
    private readonly tasks = new TaskRepository(),
    private readonly runs = new TaskRunRepository(),
  ) {}

  inspect(taskId: string): TaskDeletionInspection {
    const task = this.tasks.get(taskId);
    if (!task) return { ok: false, reason: 'not_found' };
    const related = getSqliteDatabase().prepare(`SELECT run.run_id FROM task_runs run JOIN home_followup_steps s ON s.task_id=run.task_id
      JOIN home_followups g ON g.id=s.followup_id WHERE (g.root_task_id=? OR g.id=(SELECT followup_id FROM home_followup_steps WHERE task_id=?))
      AND run.parent_run_id IS NULL AND run.status IN ('queued','running','waiting','verifying') LIMIT 1`).get(taskId,taskId) as {run_id:string}|undefined;
    const run = this.runs.getActiveRoot(taskId) ?? (related ? this.runs.get(related.run_id) : undefined);
    return run ? { ok: false, reason: 'active_run', run } : { ok: true, task };
  }

  delete(taskId: string): TaskDeletionInspection {
    const inspection = this.inspect(taskId);
    if (!inspection.ok) return inspection;
    return this.tasks.delete(taskId) ? inspection : { ok: false, reason: 'not_found' };
  }
}
