import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  ensureSessionRecord,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { GoalService } from '../../goals/index.js';
import { ProjectService } from '../project-service.js';

const SESSION_KEY = 'agent:main:webchat:default:direct:project-test';

describe('ProjectService', () => {
  let stateDir: string;
  let projects: ProjectService;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-projects-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    projects = new ProjectService();
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('creates unique slugs and lists projects', () => {
    const first = projects.create({ name: 'XOPC Project' });
    const second = projects.create({ name: 'XOPC Project' });

    expect(first.slug).toBe('xopc-project');
    expect(second.slug).toBe('xopc-project-2');
    expect(projects.getBySlug('xopc-project')?.id).toBe(first.id);
    expect(projects.list({ search: 'xopc' }).total).toBe(2);
  });

  it('stores and clears the project default agent id', () => {
    const project = projects.create({ name: 'Agent Project', defaultAgentId: 'coder' });

    expect(projects.get(project.id)?.defaultAgentId).toBe('coder');
    expect(projects.getWithDetails(project.id)?.defaultAgentId).toBe('coder');

    projects.update(project.id, { defaultAgentId: null });
    expect(projects.get(project.id)?.defaultAgentId).toBeUndefined();
  });

  it('binds sessions and goals without deleting them when project is deleted', () => {
    const project = projects.create({ name: 'Grouped Work' });
    ensureSessionRecord(SESSION_KEY, process.cwd());
    const goal = new GoalService().create({ title: 'Ship grouped work', sessionKey: SESSION_KEY });

    projects.attachSession(SESSION_KEY, project.id);
    projects.attachGoal(goal.id, project.id);

    const details = projects.getWithDetails(project.id);
    expect(details?.sessionCount).toBe(1);
    expect(details?.goalCount).toBe(1);
    expect(projects.listSessionKeys(project.id)).toEqual([SESSION_KEY]);
    expect(projects.listGoalIds(project.id)).toEqual([goal.id]);

    projects.delete(project.id);
    expect(projects.get(project.id)).toBeNull();
    expect(new GoalService().get(goal.id)?.projectId).toBeUndefined();
  });
});
