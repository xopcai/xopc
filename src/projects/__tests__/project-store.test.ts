import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  ensureSessionRecord,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { OutcomeExecutionService, OutcomeExecutionStateRepository, OutcomeRepository } from '../../work/index.js';
import { inferSuggestedProjectDefaultAgentId } from '../project-agent-suggestion.js';
import { inferProjectKind } from '../project-kind.js';
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

  it('searches projects through the project FTS index', () => {
    const first = projects.create({
      name: 'Compiler Renovation',
      brief: 'Replace fragile parser orchestration',
      instructions: 'Track symbol graph rebuild work',
      defaultAgentId: 'coder',
    });
    const second = projects.create({ name: 'Inbox Cleanup', brief: 'Triage daily messages' });

    expect(projects.list({ search: 'symbol graph' }).items.map((project) => project.id)).toEqual([first.id]);
    expect(projects.list({ search: 'daily messages' }).items.map((project) => project.id)).toEqual([second.id]);

    projects.update(first.id, { instructions: 'Archive the old parser plan' });
    expect(projects.list({ search: 'symbol graph' }).total).toBe(0);
    expect(projects.list({ search: 'old parser' }).items.map((project) => project.id)).toEqual([first.id]);

    projects.delete(first.id);
    expect(projects.list({ search: 'old parser' }).total).toBe(0);
  });

  it('uses the workspace folder name when project name is omitted', () => {
    const workspaceRoot = join(stateDir, 'folder-name-project');
    mkdirSync(workspaceRoot, { recursive: true });

    const project = projects.create({ workspaceRoot });

    expect(project.name).toBe('folder-name-project');
    expect(project.slug).toBe('folder-name-project');
  });

  it('requires confirmation before storing a missing workspace root', () => {
    const workspaceRoot = `~/.xopc-test-missing-workspace-root-${process.pid}-${Date.now()}`;
    expect(() => projects.create({ workspaceRoot })).toThrow('Workspace root does not exist');
  });

  it('creates and stores a user-relative workspace root as an absolute path when confirmed', () => {
    const workspaceName = `.xopc-test-created-workspace-root-${process.pid}-${Date.now()}`;
    const workspaceRoot = `~/${workspaceName}`;
    const absoluteRoot = join(homedir(), workspaceName);
    rmSync(absoluteRoot, { recursive: true, force: true });

    const project = projects.create({ workspaceRoot, createWorkspaceRoot: true });

    expect(project.workspaceRoot).toBe(absoluteRoot);
    expect(project.workspaceRoot).not.toContain('~');
    expect(isAbsolute(project.workspaceRoot ?? '')).toBe(true);
    expect(existsSync(absoluteRoot)).toBe(true);

    rmSync(absoluteRoot, { recursive: true, force: true });
  });

  it('stores a user-relative workspace root as an absolute path on update', () => {
    const workspaceName = `.xopc-test-updated-workspace-root-${process.pid}-${Date.now()}`;
    const workspaceRoot = join(homedir(), workspaceName);
    mkdirSync(workspaceRoot, { recursive: true });
    const project = projects.create({ name: 'Update Workspace Root' });

    const updated = projects.update(project.id, { workspaceRoot: `~/${workspaceName}` });

    expect(updated.workspaceRoot).toBe(workspaceRoot);
    expect(updated.workspaceRoot).not.toContain('~');
    expect(isAbsolute(updated.workspaceRoot ?? '')).toBe(true);

    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it('requires confirmation before updating to a missing workspace root', () => {
    const project = projects.create({ name: 'Missing Update Workspace Root' });
    const workspaceRoot = join(stateDir, 'missing-update-root');

    expect(() => projects.update(project.id, { workspaceRoot })).toThrow('Workspace root does not exist');
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

  it('infers coding project kind from workspace markers', () => {
    const workspaceRoot = join(stateDir, 'coding-root');
    mkdirSync(workspaceRoot, { recursive: true });
    writeFileSync(join(workspaceRoot, 'tsconfig.json'), '{}');

    const inference = inferProjectKind({ workspaceRoot });

    expect(inference.kind).toBe('coding');
    expect(inference.confidence).toBeGreaterThan(0.7);
  });

  it('does not treat version control metadata alone as a coding project', () => {
    const workspaceRoot = join(stateDir, 'notes-repository');
    mkdirSync(join(workspaceRoot, '.git'), { recursive: true });
    writeFileSync(join(workspaceRoot, 'README.md'), '# Team notes');

    expect(inferProjectKind({ workspaceRoot }).kind).toBe('general');
  });

  it('suggests coder for coding projects when the agent exists', () => {
    const config = {
      agents: {
        default: 'main',
        list: [
          { id: 'main', enabled: true },
          { id: 'coder', enabled: true },
        ],
      },
    };

    expect(inferSuggestedProjectDefaultAgentId({ config: config as never, projectKind: 'coding' })).toBe('coder');
    expect(inferSuggestedProjectDefaultAgentId({ config: config as never, projectKind: 'general' })).toBeUndefined();
  });

  it('auto-created coding workspace projects can default to coder without using the current session agent', () => {
    const workspaceRoot = join(stateDir, 'auto-coder-project');
    mkdirSync(workspaceRoot, { recursive: true });
    writeFileSync(join(workspaceRoot, 'package.json'), '{"name":"auto-coder-project"}');

    const created = projects.resolveOrCreateForWorkspacePath({
      workspacePath: workspaceRoot,
      agentId: 'main',
      defaultAgentId: 'coder',
      autoCreate: true,
    });

    expect(created?.created).toBe(true);
    expect(created?.project.defaultAgentId).toBe('coder');
  });

  it('auto-created general workspace projects can keep the global default dynamic', () => {
    const workspaceRoot = join(stateDir, 'auto-general-project');
    mkdirSync(workspaceRoot, { recursive: true });

    const created = projects.resolveOrCreateForWorkspacePath({
      workspacePath: workspaceRoot,
      agentId: 'main',
      defaultAgentId: undefined,
      autoCreate: true,
    });

    expect(created?.created).toBe(true);
    expect(created?.project.defaultAgentId).toBeUndefined();
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

  it('pins projects ahead of more recent sidebar projects', () => {
    const recent = projects.create({ name: 'Recent Sidebar Project' });
    const pinned = projects.create({ name: 'Pinned Sidebar Project' });
    ensureSessionRecord('agent:main:webchat:default:direct:recent-sidebar-project', process.cwd(), {
      projectId: recent.id,
    });
    ensureSessionRecord('agent:main:webchat:default:direct:pinned-sidebar-project', process.cwd(), {
      projectId: pinned.id,
    });

    projects.pin(pinned.id);

    const page = projects.listWithSidebarSessions({ status: 'active', limit: 10 });
    expect(page.items.map((project) => project.id).slice(0, 2)).toEqual([pinned.id, recent.id]);

    projects.unpin(pinned.id);
    expect(projects.get(pinned.id)?.pinnedAt).toBeUndefined();
  });

  it('binds sessions and outcomes without deleting them when project is deleted', () => {
    const project = projects.create({ name: 'Grouped Work' });
    ensureSessionRecord(SESSION_KEY, process.cwd());
    const execution = new OutcomeExecutionService().create({
      objective: 'Ship grouped work',
      sessionKey: SESSION_KEY,
      projectId: project.id,
    });

    projects.attachSession(SESSION_KEY, project.id);

    const details = projects.getWithDetails(project.id);
    expect(details?.sessionCount).toBe(1);
    expect(details?.outcomeCount).toBe(1);
    expect(projects.listSessionKeys(project.id)).toEqual([SESSION_KEY]);

    projects.delete(project.id);
    expect(projects.get(project.id)).toBeNull();
    expect(new OutcomeRepository().get(execution.outcomeId)).toBeDefined();
    expect(new OutcomeExecutionStateRepository().get(execution.outcomeId)?.projectId).toBeUndefined();
  });
});
