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
    const run = this.runs.getActiveRoot(taskId);
    return run ? { ok: false, reason: 'active_run', run } : { ok: true, task };
  }

  delete(taskId: string): TaskDeletionInspection {
    const inspection = this.inspect(taskId);
    if (!inspection.ok) return inspection;
    return this.tasks.delete(taskId) ? inspection : { ok: false, reason: 'not_found' };
  }
}
