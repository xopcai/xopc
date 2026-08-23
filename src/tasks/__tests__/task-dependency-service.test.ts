import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProjectService } from '../../projects/project-service.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { TaskApplicationService } from '../task-application-service.js';
import { TaskDependencyService } from '../task-dependency-service.js';

const contract = {
  objective: 'Test project dependency edges',
  expectedOutputs: [],
  acceptanceCriteria: [],
  constraints: [],
  nonGoals: [],
  risks: [],
  approvalRequired: [],
  acceptancePolicy: 'manual' as const,
  outputDestinations: [],
};

describe('TaskDependencyService project graph', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-task-dependencies-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('returns complete internal edges for one project only', () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Graph project' });
    const otherProject = projects.create({ name: 'Other project' });
    const tasks = new TaskApplicationService();
    const dependency = tasks.create({
      idempotencyKey: 'graph-dependency', projectId: project.id, title: 'Foundation', priority: 'normal',
      contract, dependencies: [], context: [], authorityGrants: [], activation: { mode: 'capture', phase: 'ready' },
    });
    const other = tasks.create({
      idempotencyKey: 'other-dependency', projectId: otherProject.id, title: 'External', priority: 'normal',
      contract, dependencies: [], context: [], authorityGrants: [], activation: { mode: 'capture', phase: 'ready' },
    });
    expect(dependency.ok && other.ok).toBe(true);
    if (!dependency.ok || !other.ok) return;
    const dependent = tasks.create({
      idempotencyKey: 'graph-dependent', projectId: project.id, title: 'Delivery', priority: 'normal',
      contract,
      dependencies: [dependency.model.task.id, other.model.task.id],
      context: [], authorityGrants: [], activation: { mode: 'capture', phase: 'ready' },
    });
    expect(dependent.ok).toBe(true);
    if (!dependent.ok) return;

    expect(new TaskDependencyService().listProjectEdges(project.id)).toEqual([{
      dependencyTaskId: dependency.model.task.id,
      dependentTaskId: dependent.model.task.id,
    }]);
  });
});
