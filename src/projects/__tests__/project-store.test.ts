import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
import { canonicalWorkspacePath, ProjectWorkspaceConflictError } from '../workspace-project.js';

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

  it('uses the workspace folder name when project name is omitted', () => {
    const workspaceRoot = join(stateDir, 'folder-name-project');
    mkdirSync(workspaceRoot, { recursive: true });

    const project = projects.create({ workspaceRoot });

    expect(project.name).toBe('folder-name-project');
    expect(project.slug).toBe('folder-name-project');
  });

  it('prevents binding the same workspace root to multiple projects', () => {
    const workspaceRoot = join(stateDir, 'duplicate-root');
    mkdirSync(workspaceRoot, { recursive: true });
    const first = projects.create({ name: 'First', workspaceRoot });

    expect(() => projects.create({ name: 'Second', workspaceRoot })).toThrow(ProjectWorkspaceConflictError);
    expect(projects.findByWorkspaceRoot(workspaceRoot)?.id).toBe(first.id);
  });

  it('resolves or auto-creates a project for a TUI workspace path', () => {
    const workspaceRoot = join(stateDir, 'auto-project');
    const child = join(workspaceRoot, 'src');
    mkdirSync(child, { recursive: true });

    const created = projects.resolveOrCreateForWorkspacePath({ workspacePath: workspaceRoot, agentId: 'main', autoCreate: true });
    expect(created?.created).toBe(true);
    expect(created?.project.name).toBe('auto-project');

    const matched = projects.resolveOrCreateForWorkspacePath({ workspacePath: child, agentId: 'main', autoCreate: true });
    expect(matched?.created).toBe(false);
    expect(matched?.reason).toBe('contained');
    expect(matched?.project.id).toBe(created?.project.id);
  });

  it('auto-creates a project at the detected project root instead of the launch subdirectory', () => {
    const workspaceRoot = join(stateDir, 'repo-root');
    const child = join(workspaceRoot, 'src', 'feature');
    mkdirSync(child, { recursive: true });
    writeFileSync(join(workspaceRoot, 'package.json'), '{"name":"repo-root"}');

    const created = projects.resolveOrCreateForWorkspacePath({ workspacePath: child, agentId: 'main', autoCreate: true });

    expect(created?.created).toBe(true);
    expect(created?.project.name).toBe('repo-root');
    expect(created?.project.workspaceRoot).toBe(canonicalWorkspacePath(workspaceRoot));
  });

  it('checks duplicate workspace roots beyond the first project page', () => {
    const workspaceRoot = join(stateDir, 'paged-duplicate-root');
    mkdirSync(workspaceRoot, { recursive: true });
    const first = projects.create({ name: 'Paged Duplicate', workspaceRoot });
    for (let index = 0; index < 501; index += 1) {
      projects.create({ name: `Filler ${index}` });
    }

    expect(() => projects.create({ name: 'Paged Duplicate Again', workspaceRoot })).toThrow(ProjectWorkspaceConflictError);
    expect(projects.findByWorkspaceRoot(workspaceRoot)?.id).toBe(first.id);
  });

  it('returns an existing archived project for an occupied workspace instead of auto-creating a duplicate', () => {
    const workspaceRoot = join(stateDir, 'archived-root');
    mkdirSync(workspaceRoot, { recursive: true });
    const archived = projects.create({ name: 'Archived Workspace', workspaceRoot });
    projects.update(archived.id, { status: 'archived' });

    const match = projects.resolveOrCreateForWorkspacePath({ workspacePath: workspaceRoot, agentId: 'main', autoCreate: true });

    expect(match?.created).toBe(false);
    expect(match?.project.id).toBe(archived.id);
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
