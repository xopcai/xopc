import type { TaskDependencySummary } from '@xopcai/gateway-contract';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

import { TaskRepository, type TaskAggregate } from './task-repository.js';

type DependencyRow = {
  id: string;
  objective: string;
  status: TaskDependencySummary['status'];
};

export type TaskDependencyErrorCode =
  | 'not_found'
  | 'conflict'
  | 'invalid_dependency'
  | 'cycle';

export class TaskDependencyError extends Error {
  constructor(readonly code: TaskDependencyErrorCode, message: string) {
    super(message);
    this.name = 'TaskDependencyError';
  }
}

function toSummary(row: DependencyRow): TaskDependencySummary {
  return { id: row.id, objective: row.objective, status: row.status };
}

export class TaskDependencyService {
  readonly #tasks = new TaskRepository();

  listDependencies(taskId: string): TaskDependencySummary[] {
    const rows = getSqliteDatabase().prepare(
      `SELECT dependency.task_id AS id, dependency.objective, dependency.status
       FROM task_dependencies edge
       JOIN tasks dependency ON dependency.task_id = edge.depends_on_task_id
       WHERE edge.task_id = ?
       ORDER BY edge.created_at ASC, dependency.task_id ASC`,
    ).all(taskId) as DependencyRow[];
    return rows.map(toSummary);
  }

  listDependents(taskId: string): TaskDependencySummary[] {
    const rows = getSqliteDatabase().prepare(
      `SELECT dependent.task_id AS id, dependent.objective, dependent.status
       FROM task_dependencies edge
       JOIN tasks dependent ON dependent.task_id = edge.task_id
       WHERE edge.depends_on_task_id = ?
       ORDER BY edge.created_at ASC, dependent.task_id ASC`,
    ).all(taskId) as DependencyRow[];
    return rows.map(toSummary);
  }

  listBlocking(taskId: string): TaskDependencySummary[] {
    return this.listDependencies(taskId).filter((dependency) => dependency.status !== 'completed');
  }

  listReadyDependents(taskId: string): TaskAggregate[] {
    const rows = getSqliteDatabase().prepare(
      `SELECT dependent.task_id AS id
       FROM task_dependencies completed_edge
       JOIN tasks dependent ON dependent.task_id = completed_edge.task_id
       WHERE completed_edge.depends_on_task_id = ?
         AND dependent.status = 'waiting_dependency'
         AND NOT EXISTS (
           SELECT 1
           FROM task_dependencies edge
           JOIN tasks dependency ON dependency.task_id = edge.depends_on_task_id
           WHERE edge.task_id = dependent.task_id
             AND dependency.status <> 'completed'
         )
       ORDER BY dependent.created_at ASC`,
    ).all(taskId) as Array<{ id: string }>;
    return rows.flatMap((row) => {
      const task = this.#tasks.get(row.id);
      return task ? [task] : [];
    });
  }

  replace(input: {
    taskId: string;
    dependsOnTaskIds: string[];
    expectedUpdatedAt: number;
    now?: number;
  }): TaskAggregate {
    const dependencyIds = [...new Set(input.dependsOnTaskIds.map((id) => id.trim()).filter(Boolean))];
    if (dependencyIds.includes(input.taskId)) {
      throw new TaskDependencyError('invalid_dependency', 'A task cannot depend on itself');
    }

    runSqliteWriteTransaction((db) => {
      const task = db.prepare(
        'SELECT updated_at FROM tasks WHERE task_id = ?',
      ).get(input.taskId) as { updated_at: number } | undefined;
      if (!task) throw new TaskDependencyError('not_found', 'Task not found');
      if (task.updated_at !== input.expectedUpdatedAt) {
        throw new TaskDependencyError('conflict', 'Task changed before its dependencies were saved');
      }

      for (const dependencyId of dependencyIds) {
        const exists = db.prepare('SELECT 1 FROM tasks WHERE task_id = ?').get(dependencyId);
        if (!exists) {
          throw new TaskDependencyError('invalid_dependency', `Dependency task not found: ${dependencyId}`);
        }
      }

      db.prepare('DELETE FROM task_dependencies WHERE task_id = ?').run(input.taskId);
      const createsCycle = db.prepare(
        `WITH RECURSIVE dependencies(task_id) AS (
           SELECT ?
           UNION
           SELECT edge.depends_on_task_id
           FROM task_dependencies edge
           JOIN dependencies current ON current.task_id = edge.task_id
         )
         SELECT 1 FROM dependencies WHERE task_id = ? LIMIT 1`,
      );
      const insert = db.prepare(
        `INSERT INTO task_dependencies (task_id, depends_on_task_id, created_at)
         VALUES (?, ?, ?)`,
      );
      const now = Math.max(input.now ?? Date.now(), task.updated_at + 1);
      for (const dependencyId of dependencyIds) {
        if (createsCycle.get(dependencyId, input.taskId)) {
          throw new TaskDependencyError('cycle', 'Task dependencies must form an acyclic graph');
        }
        insert.run(input.taskId, dependencyId, now);
      }
      db.prepare('UPDATE tasks SET updated_at = ? WHERE task_id = ?').run(now, input.taskId);
    });

    return this.#tasks.get(input.taskId)!;
  }
}
