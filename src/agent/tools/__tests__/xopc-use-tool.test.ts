import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActivityService } from '../../../activity/index.js';
import { NotesService, NotesStore } from '../../../notes/index.js';
import { ProjectService } from '../../../projects/index.js';
import {
  closeXopcDatabase,
  ensureSessionRecord,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../storage/sqlite/index.js';
import type { LocalAppService } from '../../../local-apps/index.js';
import { createXopcUseTool } from '../xopc-use-tool.js';

const SESSION_KEY = 'agent:main:tui:xopc-use';

function parseToolJson(result: Awaited<ReturnType<ReturnType<typeof createXopcUseTool>['execute']>>) {
  const text = result.content[0]?.type === 'text' ? result.content[0].text : '{}';
  return JSON.parse(text.split('\nOpen in xopc:')[0]) as Record<string, any>;
}

describe('xopc_use tool', () => {
  let stateDir: string;
  let projects: ProjectService;
  let notes: NotesService;
  let activity: ActivityService;

  beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-use-tool-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    ensureSessionRecord(SESSION_KEY, stateDir);
    projects = new ProjectService();
    notes = new NotesService(new NotesStore());
    await notes.initialize();
    activity = new ActivityService();
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('creates and updates a project through one entry point', async () => {
    const tool = createXopcUseTool({
      getCurrentAgentId: () => 'main',
      getProjectService: () => projects,
      getCurrentSessionKey: () => SESSION_KEY,
    });

    const created = parseToolJson(await tool.execute('call-1', {
      mode: 'project',
      command: 'create',
      args: { name: 'Agent Objects', brief: 'Let agent operate product objects' },
    }));

    expect(created.ok).toBe(true);
    expect(created.project.name).toBe('Agent Objects');
    const createdResult = await tool.execute('call-delivery', {
      mode: 'project',
      command: 'get',
      args: { projectId: created.project.id },
    });
    expect(createdResult.details.delivery).toMatchObject({
      version: 1,
      operation: 'opened',
      primary: {
        kind: 'project',
        id: created.project.id,
        capabilities: expect.arrayContaining(['open', 'continue_in_chat']),
      },
    });

    const updated = parseToolJson(await tool.execute('call-2', {
      mode: 'project',
      command: 'update',
      args: { projectId: created.project.id, status: 'paused', instructions: 'Use safe previews.' },
    }));

    expect(updated.project.status).toBe('paused');
    expect(updated.project.instructions).toBe('Use safe previews.');

    const page = activity.listForProject({ projectId: created.project.id });
    expect(page.items[0]).toMatchObject({
      type: 'project.status_changed',
      actor: { kind: 'agent', agentId: 'main', sessionKey: SESSION_KEY },
      initiator: { kind: 'user', sessionKey: SESSION_KEY },
      source: { kind: 'xopc_use', toolCallId: 'call-2' },
    });
  });

  it('resolves an existing workspace project', async () => {
    const workspaceRoot = mkdtempSync(join(stateDir, 'workspace-'));
    const project = projects.create({ name: 'Workspace Project', workspaceRoot });
    const tool = createXopcUseTool({
      getProjectService: () => projects,
      getCurrentSessionKey: () => SESSION_KEY,
    });

    const result = parseToolJson(await tool.execute('call-1', {
      mode: 'project',
      command: 'resolve_workspace',
      args: { workspacePath: workspaceRoot },
    }));

    expect(result.ok).toBe(true);
    expect(result.match.project.id).toBe(project.id);
    expect(result.match.created).toBe(false);
  });

  it('accepts path as a project workspace alias', async () => {
    const workspaceRoot = mkdtempSync(join(stateDir, 'workspace-'));
    const tool = createXopcUseTool({
      getProjectService: () => projects,
      getCurrentSessionKey: () => SESSION_KEY,
    });

    const created = parseToolJson(await tool.execute('call-1', {
      mode: 'project',
      command: 'create',
      args: { name: 'Path Alias Project', path: workspaceRoot },
    }));

    expect(created.ok).toBe(true);
    expect(realpathSync.native(created.project.workspaceRoot)).toBe(realpathSync.native(workspaceRoot));
  });

  it('creates and appends to a note', async () => {
    const tool = createXopcUseTool({
      getNotesService: () => notes,
      getCurrentSessionKey: () => SESSION_KEY,
    });

    const created = parseToolJson(await tool.execute('call-1', {
      mode: 'note',
      command: 'create',
      args: { title: 'Design', markdown: 'Initial idea', tags: ['agent'] },
    }));
    expect(created.note.title).toBe('Design');

    const appended = parseToolJson(await tool.execute('call-2', {
      mode: 'note',
      command: 'append',
      args: { noteId: created.note.id, heading: 'Review', content: 'Add preview before overwrite.' },
    }));

    expect(appended.note.markdown).toContain('Initial idea');
    expect(appended.note.markdown).toContain('## Review');
    expect(appended.note.markdown).toContain('Add preview before overwrite.');
  });

  it('previews a note edit without mutating the note', async () => {
    const note = await notes.createNote({
      title: 'Preview',
      markdown: 'First line\nSecond line',
      capturedVia: { channel: 'web' },
    });
    const tool = createXopcUseTool({
      getNotesService: () => notes,
      getCurrentSessionKey: () => SESSION_KEY,
    });

    const result = parseToolJson(await tool.execute('call-1', {
      mode: 'note',
      command: 'preview_edit',
      args: { noteId: note.id, instruction: '生成摘要' },
    }));

    const unchanged = await notes.getNote(note.id);
    expect(result.ok).toBe(true);
    expect(result.patch.operations[0].type).toBe('replaceRange');
    expect(result.patch.operations[0].markdown).toContain('[!SUMMARY]');
    expect(unchanged?.markdown).toBe('First line\nSecond line');
  });

  it('does not mutate on dryRun', async () => {
    const tool = createXopcUseTool({
      getProjectService: () => projects,
      getCurrentSessionKey: () => SESSION_KEY,
    });

    const result = parseToolJson(await tool.execute('call-1', {
      mode: 'project',
      command: 'create',
      dryRun: true,
      args: { name: 'Dry Run Project' },
    }));

    expect(result.dryRun).toBe(true);
    expect(projects.list({ search: 'Dry Run Project' }).items).toHaveLength(0);
  });

  it('captures a task by default and returns a task delivery reference', async () => {
    const project = projects.create({ name: 'Task Project' });
    const tool = createXopcUseTool({
      getCurrentAgentId: () => 'main',
      getCurrentSessionKey: () => SESSION_KEY,
      getProjectService: () => projects,
    });

    const result = await tool.execute('call-task-capture', {
      mode: 'task',
      command: 'create',
      args: {
        objective: 'Prepare the launch checklist',
        projectId: project.id,
        priority: 'high',
      },
    });
    const created = parseToolJson(result);

    expect(created).toMatchObject({
      ok: true,
      createMode: 'capture',
      task: {
        objective: 'Prepare the launch checklist',
        status: 'pending',
        priority: 'high',
      },
    });
    expect(result.details.delivery).toMatchObject({
      operation: 'created',
      primary: {
        kind: 'task',
        id: created.task.id,
        projectId: project.id,
        capabilities: expect.arrayContaining(['open', 'run']),
      },
    });
  });

  it('starts and pauses a task through task actions', async () => {
    const enqueueTask = vi.fn((taskId: string) => ({
      id: `queue:${taskId}`,
      taskId,
      status: 'queued' as const,
      attempts: 0,
      maxRetries: 2,
      enqueuedAt: Date.now(),
      source: 'api' as const,
    }));
    const tool = createXopcUseTool({
      getCurrentAgentId: () => 'main',
      getCurrentSessionKey: () => SESSION_KEY,
      enqueueTask,
    });

    const startedResult = await tool.execute('call-task-start', {
      mode: 'task',
      command: 'create',
      args: { objective: 'Run the launch review', createMode: 'start' },
    });
    const started = parseToolJson(startedResult);

    expect(started.task.status).toBe('planning');
    expect(started.activation).toMatchObject({ status: 'queued' });
    expect(enqueueTask).toHaveBeenCalledWith(started.task.id, expect.any(Object));

    const paused = parseToolJson(await tool.execute('call-task-pause', {
      mode: 'task',
      command: 'action',
      args: {
        taskId: started.task.id,
        action: 'pause',
        expectedUpdatedAt: started.task.updatedAt,
      },
    }));

    expect(paused).toMatchObject({ ok: true, action: 'pause', task: { status: 'paused' } });
  });

  it('updates task dependencies with optimistic concurrency', async () => {
    const tool = createXopcUseTool({
      getCurrentAgentId: () => 'main',
      getCurrentSessionKey: () => SESSION_KEY,
    });
    const dependency = parseToolJson(await tool.execute('call-dependency', {
      mode: 'task',
      command: 'create',
      args: { objective: 'Approve the research scope' },
    })).task;
    const task = parseToolJson(await tool.execute('call-dependent', {
      mode: 'task',
      command: 'create',
      args: { objective: 'Complete the research report' },
    })).task;

    const updated = parseToolJson(await tool.execute('call-task-dependencies', {
      mode: 'task',
      command: 'update_dependencies',
      args: {
        taskId: task.id,
        dependsOnTaskIds: [dependency.id],
        expectedUpdatedAt: task.updatedAt,
      },
    }));

    expect(updated).toMatchObject({
      ok: true,
      dependencies: [{ id: dependency.id, status: 'pending' }],
    });
    const detail = parseToolJson(await tool.execute('call-task-get', {
      mode: 'task',
      command: 'get',
      args: { taskId: task.id },
    }));
    expect(detail.dependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: dependency.id }),
    ]));
  });

  it('creates a local app and returns an inline delivery reference', async () => {
    const app = {
      id: 'app-1',
      projectId: 'project-1',
      name: 'Research Hub',
      idea: 'Keep sources together',
      installationState: 'draft',
      updatedAt: 123,
    };
    const localApps = {
      create: () => app,
      list: () => [app],
      get: (id: string) => id === app.id ? app : null,
      validate: () => ({ status: 'healthy' }),
    } as unknown as LocalAppService;
    const tool = createXopcUseTool({
      getLocalAppService: () => localApps,
      getCurrentSessionKey: () => SESSION_KEY,
    });

    const result = await tool.execute('call-local-app', {
      mode: 'local_app',
      command: 'create',
      args: { name: app.name, idea: app.idea },
    });

    expect(result.details.delivery).toMatchObject({
      operation: 'created',
      primary: {
        kind: 'local_app',
        id: app.id,
        projectId: app.projectId,
      },
    });
  });

  it('returns an exact settings jump target without changing config', async () => {
    const tool = createXopcUseTool({
      getProjectService: () => projects,
      getCurrentSessionKey: () => SESSION_KEY,
    });
    const result = await tool.execute('call-settings', {
      mode: 'settings',
      command: 'open',
      args: {
        section: 'credentials',
        title: 'Provider credentials',
        summary: 'Add the required API key.',
      },
    });

    expect(result.details.delivery).toMatchObject({
      operation: 'opened',
      primary: {
        kind: 'settings',
        id: 'credentials',
        title: 'Provider credentials',
      },
    });
  });

});
