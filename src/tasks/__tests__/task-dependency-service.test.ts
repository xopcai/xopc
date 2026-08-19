import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import {
  TaskDependencyError,
  TaskDependencyService,
} from '../task-dependency-service.js';
import { TaskRepository } from '../task-repository.js';

describe('TaskDependencyService', () => {
  let stateDir: string;
  let tasks: TaskRepository;
  let dependencies: TaskDependencyService;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-task-dependencies-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    tasks = new TaskRepository();
    dependencies = new TaskDependencyService();
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('replaces dependencies and reports both directions', () => {
    const upstream = tasks.create({ id: 'upstream', objective: 'Prepare inputs', now: 100 });
    const dependent = tasks.create({ id: 'dependent', objective: 'Publish result', now: 100 });

    const updated = dependencies.replace({
      taskId: dependent.id,
      dependsOnTaskIds: [upstream.id, upstream.id],
      expectedUpdatedAt: dependent.updatedAt,
      now: 200,
    });

    expect(updated.updatedAt).toBe(200);
    expect(dependencies.listDependencies(dependent.id)).toEqual([
      { id: upstream.id, objective: upstream.objective, status: 'pending' },
    ]);
    expect(dependencies.listDependents(upstream.id)).toEqual([
      { id: dependent.id, objective: dependent.objective, status: 'pending' },
    ]);
  });

  it('rejects self references, missing tasks, cycles, and stale writes', () => {
    const first = tasks.create({ id: 'first', objective: 'First', now: 100 });
    const second = tasks.create({ id: 'second', objective: 'Second', now: 100 });

    expect(() => dependencies.replace({
      taskId: first.id,
      dependsOnTaskIds: [first.id],
      expectedUpdatedAt: first.updatedAt,
    })).toThrowError(expect.objectContaining<TaskDependencyError>({ code: 'invalid_dependency' }));

    expect(() => dependencies.replace({
      taskId: first.id,
      dependsOnTaskIds: ['missing'],
      expectedUpdatedAt: first.updatedAt,
    })).toThrowError(expect.objectContaining<TaskDependencyError>({ code: 'invalid_dependency' }));

    const changed = dependencies.replace({
      taskId: second.id,
      dependsOnTaskIds: [first.id],
      expectedUpdatedAt: second.updatedAt,
      now: 200,
    });
    expect(() => dependencies.replace({
      taskId: first.id,
      dependsOnTaskIds: [second.id],
      expectedUpdatedAt: first.updatedAt,
    })).toThrowError(expect.objectContaining<TaskDependencyError>({ code: 'cycle' }));
    expect(() => dependencies.replace({
      taskId: second.id,
      dependsOnTaskIds: [],
      expectedUpdatedAt: second.updatedAt,
    })).toThrowError(expect.objectContaining<TaskDependencyError>({ code: 'conflict' }));
    expect(changed.updatedAt).toBe(200);
  });

  it('only releases waiting dependents after every dependency completes', () => {
    const first = tasks.create({ id: 'first', objective: 'First', now: 100 });
    const second = tasks.create({ id: 'second', objective: 'Second', now: 100 });
    const dependent = tasks.create({ id: 'dependent', objective: 'Dependent', now: 100 });
    const linked = dependencies.replace({
      taskId: dependent.id,
      dependsOnTaskIds: [first.id, second.id],
      expectedUpdatedAt: dependent.updatedAt,
      now: 200,
    });
    tasks.update(dependent.id, { status: 'waiting_dependency', expectedUpdatedAt: linked.updatedAt, now: 300 });

    tasks.update(first.id, { status: 'completed' });
    expect(dependencies.listReadyDependents(first.id)).toEqual([]);

    tasks.update(second.id, { status: 'completed' });
    expect(dependencies.listReadyDependents(second.id)).toMatchObject([{ id: dependent.id }]);
  });
});
