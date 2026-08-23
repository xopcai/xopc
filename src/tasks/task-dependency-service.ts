import type { ProjectTaskDependencyEdge, TaskDependencySummary } from '@xopcai/gateway-contract';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

import { TaskReadModelProjector } from './task-read-model-projector.js';
import { TaskRepository, type TaskAggregate } from './task-repository.js';

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

export class TaskDependencyService {
  readonly #tasks = new TaskRepository();
  readonly #projector = new TaskReadModelProjector();

  listDependencies(taskId: string): TaskDependencySummary[] {
    return this.listRelated(
      `SELECT depends_on_task_id AS task_id FROM task_dependencies
       WHERE task_id = ? ORDER BY created_at ASC, depends_on_task_id ASC`,
      taskId,
    );
  }

  listDependents(taskId: string): TaskDependencySummary[] {
    return this.listRelated(
      `SELECT task_id FROM task_dependencies
       WHERE depends_on_task_id = ? ORDER BY created_at ASC, task_id ASC`,
      taskId,
    );
  }

  listBlocking(taskId: string): TaskDependencySummary[] {
    return this.listDependencies(taskId).filter((dependency) =>
      dependency.phase !== 'closed' || dependency.resolution !== 'done');
  }

  listProjectEdges(projectId: string): ProjectTaskDependencyEdge[] {
    return getSqliteDatabase().prepare(
      `SELECT edge.depends_on_task_id AS dependency_task_id,
              edge.task_id AS dependent_task_id
       FROM task_dependencies edge
       JOIN tasks dependency ON dependency.task_id = edge.depends_on_task_id
       JOIN tasks dependent ON dependent.task_id = edge.task_id
       WHERE dependency.project_id = ? AND dependent.project_id = ?
       ORDER BY edge.created_at ASC, edge.depends_on_task_id ASC, edge.task_id ASC`,
    ).all(projectId, projectId).map((row) => {
      const edge = row as { dependency_task_id: string; dependent_task_id: string };
      return {
        dependencyTaskId: edge.dependency_task_id,
        dependentTaskId: edge.dependent_task_id,
      };
    });
  }

  listReadyDependents(taskId: string): TaskAggregate[] {
    const rows = getSqliteDatabase().prepare(
      `SELECT dependent.task_id
       FROM task_dependencies completed_edge
       JOIN tasks dependent ON dependent.task_id = completed_edge.task_id
       WHERE completed_edge.depends_on_task_id = ?
         AND dependent.phase <> 'closed'
         AND NOT EXISTS (
           SELECT 1 FROM task_dependencies edge
           JOIN tasks dependency ON dependency.task_id = edge.depends_on_task_id
           WHERE edge.task_id = dependent.task_id
             AND NOT (dependency.phase = 'closed' AND dependency.resolution = 'done')
         )
       ORDER BY dependent.created_at ASC`,
    ).all(taskId) as Array<{ task_id: string }>;
    return rows.flatMap((row) => {
      const task = this.#tasks.get(row.task_id);
      return task ? [task] : [];
    });
  }

  replace(input: {
    taskId: string;
    dependsOnTaskIds: string[];
    expectedVersion: number;
    now?: number;
  }): TaskAggregate {
    const dependencyIds = [...new Set(input.dependsOnTaskIds.map((id) => id.trim()).filter(Boolean))];
    if (dependencyIds.includes(input.taskId)) {
      throw new TaskDependencyError('invalid_dependency', 'A task cannot depend on itself');
    }

    runSqliteWriteTransaction((db) => {
      const task = db.prepare(
        'SELECT version, updated_at FROM tasks WHERE task_id = ?',
      ).get(input.taskId) as { version: number; updated_at: number } | undefined;
      if (!task) throw new TaskDependencyError('not_found', 'Task not found');
      if (task.version !== input.expectedVersion) {
        throw new TaskDependencyError('conflict', 'Task changed before its dependencies were saved');
      }

      for (const dependencyId of dependencyIds) {
        if (!db.prepare('SELECT 1 FROM tasks WHERE task_id = ?').get(dependencyId)) {
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
        `INSERT INTO task_dependencies (
          task_id, depends_on_task_id, dependency_kind, created_at
        ) VALUES (?, ?, 'blocks', ?)`,
      );
      const now = Math.max(input.now ?? Date.now(), task.updated_at + 1);
      for (const dependencyId of dependencyIds) {
        if (createsCycle.get(dependencyId, input.taskId)) {
          throw new TaskDependencyError('cycle', 'Task dependencies must form an acyclic graph');
        }
        insert.run(input.taskId, dependencyId, now);
      }
      db.prepare(
        `UPDATE tasks SET version = version + 1, updated_at = ?
         WHERE task_id = ? AND version = ?`,
      ).run(now, input.taskId, input.expectedVersion);
    });

    return this.#tasks.require(input.taskId);
  }

  private listRelated(sql: string, taskId: string): TaskDependencySummary[] {
    const rows = getSqliteDatabase().prepare(sql).all(taskId) as Array<{ task_id: string }>;
    return rows.flatMap((row) => {
      const summary = this.#projector.summary(row.task_id);
      return summary ? [summary] : [];
    });
  }
}
