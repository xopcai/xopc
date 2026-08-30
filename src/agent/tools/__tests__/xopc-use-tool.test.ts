import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActivityService, ObjectLinkService } from '../../../activity/index.js';
import { AutomationService } from '../../../automations/index.js';
import { NotesService, NotesStore } from '../../../notes/index.js';
import { ProjectService } from '../../../projects/index.js';
import {
  closeXopcDatabase,
  ensureSessionRecord,
  openXopcDatabase,
  patchSessionMetadata,
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
  let automations: AutomationService;
  let notes: NotesService;
  let activity: ActivityService;

  beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-use-tool-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    ensureSessionRecord(SESSION_KEY, stateDir);
    projects = new ProjectService();
    automations = new AutomationService();
    await automations.initialize();
    notes = new NotesService(new NotesStore());
    await notes.initialize();
    activity = new ActivityService();
  });

  afterEach(async () => {
    await automations.stop();
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

  it('creates and lists automations in the current session project', async () => {
    const project = projects.create({ name: 'Automation Project' });
    const otherProject = projects.create({ name: 'Other Automation Project' });
    patchSessionMetadata(SESSION_KEY, { projectId: project.id });
    const tool = createXopcUseTool({
      getAutomationService: () => automations,
      getProjectService: () => projects,
      getCurrentSessionKey: () => SESSION_KEY,
    });

    const createdResult = await tool.execute('call-project-automation', {
      mode: 'automation',
      command: 'create',
      args: {
        name: 'Project review',
        trigger: { kind: 'manual' },
        action: { kind: 'agent', instruction: 'Review the project.' },
      },
    });
    const created = parseToolJson(createdResult);
    const other = parseToolJson(await tool.execute('call-other-project-automation', {
      mode: 'automation',
      command: 'create',
      args: {
        projectId: otherProject.id,
        automation: {
          name: 'Other project review',
          trigger: { kind: 'manual' },
          action: { kind: 'agent', instruction: 'Review the other project.' },
        },
      },
    }));

    expect(created).toMatchObject({
      ok: true,
      projectId: project.id,
      automation: { projectId: project.id },
    });
    expect(other.automation.projectId).toBe(otherProject.id);
    expect(createdResult.details.delivery).toMatchObject({
      operation: 'created',
      primary: {
        kind: 'automation',
        id: created.automation.id,
        projectId: project.id,
      },
    });

    const listed = parseToolJson(await tool.execute('call-project-automation-list', {
      mode: 'automation',
      command: 'list',
      args: {},
    }));
    expect(listed.projectId).toBe(project.id);
    expect(listed.items.map((automation: { id: string }) => automation.id)).toEqual([created.automation.id]);

    const missingProject = parseToolJson(await tool.execute('call-missing-project-automation', {
      mode: 'automation',
      command: 'create',
      args: {
        projectId: 'missing-project',
        name: 'Invalid project automation',
        trigger: { kind: 'manual' },
        action: { kind: 'agent', instruction: 'This must not be created.' },
      },
    }));
    expect(missingProject).toEqual({ ok: false, error: 'Project not found: missing-project' });
  });

  it('deletes an automation without delivering a stale product link', async () => {
    const automation = await automations.create({
      name: 'Disposable automation',
      trigger: { kind: 'manual' },
      action: { kind: 'agent', instruction: 'This automation will be deleted.' },
    });
    const tool = createXopcUseTool({ getAutomationService: () => automations });

    const result = await tool.execute('call-automation-delete', {
      mode: 'automation',
      command: 'delete',
      args: { automationId: automation.id },
    });

    expect(parseToolJson(result)).toMatchObject({
      ok: true,
      removed: true,
      automation: { id: automation.id },
    });
    expect(result.details.delivery).toBeUndefined();
    expect(await automations.get(automation.id)).toBeNull();
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

  it('operates project planning fields, milestones, and immutable updates', async () => {
    const tool = createXopcUseTool({
      getCurrentAgentId: () => 'main',
      getCurrentSessionKey: () => SESSION_KEY,
      getProjectService: () => projects,
    });
    const created = parseToolJson(await tool.execute('call-project-create', {
      mode: 'project',
      command: 'create',
      args: {
        name: 'Launch',
        outcome: 'Ship the release',
        successCriteria: ['Production is healthy'],
        scope: { surface: 'gateway' },
        nonGoals: ['Rewrite unrelated modules'],
        health: 'on_track',
      },
    })).project;

    expect(created).toMatchObject({
      outcome: 'Ship the release',
      successCriteria: ['Production is healthy'],
      scope: { surface: 'gateway' },
      health: 'on_track',
    });

    const milestone = parseToolJson(await tool.execute('call-milestone', {
      mode: 'project',
      command: 'create_milestone',
      args: { projectId: created.id, title: 'Release candidate', status: 'active' },
    })).milestone;
    expect(milestone).toMatchObject({ title: 'Release candidate', status: 'active' });

    const update = parseToolJson(await tool.execute('call-project-update', {
      mode: 'project',
      command: 'create_update',
      args: {
        projectId: created.id,
        health: 'at_risk',
        summary: 'One blocker remains',
        risks: ['Release gate is pending'],
      },
    })).update;
    expect(update).toMatchObject({ health: 'at_risk', summary: 'One blocker remains' });

    const detail = parseToolJson(await tool.execute('call-project-get', {
      mode: 'project',
      command: 'get',
      args: { projectId: created.id },
    }));
    expect(detail.project).toMatchObject({
      health: 'at_risk',
      milestones: [expect.objectContaining({ id: milestone.id })],
      recentUpdates: [expect.objectContaining({ id: update.id })],
    });
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

  it('previews and permanently deletes a note', async () => {
    const note = await notes.createNote({
      title: 'Disposable',
      markdown: 'Remove this note.',
      capturedVia: { channel: 'web' },
    });
    const tool = createXopcUseTool({
      getNotesService: () => notes,
      getCurrentSessionKey: () => SESSION_KEY,
    });

    const preview = parseToolJson(await tool.execute('call-note-delete-preview', {
      mode: 'note',
      command: 'delete',
      dryRun: true,
      args: { noteId: note.id },
    }));
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      action: 'delete_note',
      noteId: note.id,
      note: { id: note.id, title: 'Disposable' },
    });
    expect(await notes.getNote(note.id)).not.toBeNull();

    const deletedResult = await tool.execute('call-note-delete', {
      mode: 'note',
      command: 'delete',
      args: { noteId: note.id },
    });
    expect(parseToolJson(deletedResult)).toEqual({ ok: true, removed: true, noteId: note.id });
    expect(deletedResult.details.delivery).toBeUndefined();
    expect(await notes.getNote(note.id)).toBeNull();

    const missing = parseToolJson(await tool.execute('call-note-delete-missing', {
      mode: 'note',
      command: 'delete',
      args: { noteId: note.id },
    }));
    expect(missing).toEqual({ ok: false, error: `Note not found: ${note.id}` });
  });

  it('creates and lists notes in the current session project', async () => {
    const project = projects.create({ name: 'Project Notes' });
    const otherProject = projects.create({ name: 'Other Notes' });
    patchSessionMetadata(SESSION_KEY, { projectId: project.id });
    const tool = createXopcUseTool({
      getNotesService: () => notes,
      getProjectService: () => projects,
      getCurrentSessionKey: () => SESSION_KEY,
    });

    const createdResult = await tool.execute('call-project-note', {
      mode: 'note',
      command: 'create',
      args: { title: 'Project decision', markdown: 'Keep this with the project.' },
    });
    const created = parseToolJson(createdResult);
    await tool.execute('call-other-project-note', {
      mode: 'note',
      command: 'create',
      args: {
        title: 'Other project decision',
        markdown: 'Do not include this in the current project.',
        projectId: otherProject.id,
      },
    });

    expect(created).toMatchObject({ ok: true, projectId: project.id });
    expect(createdResult.details.delivery).toMatchObject({
      primary: { kind: 'note', id: created.note.id, projectId: project.id },
    });
    expect(new ObjectLinkService().listForObject({ kind: 'note', id: created.note.id })).toEqual([
      expect.objectContaining({
        relation: 'belongs_to',
        to: expect.objectContaining({ kind: 'project', id: project.id }),
      }),
    ]);

    const listed = parseToolJson(await tool.execute('call-project-note-list', {
      mode: 'note',
      command: 'list',
      args: {},
    }));
    expect(listed.projectId).toBe(project.id);
    expect(listed.items.map((note: { id: string }) => note.id)).toEqual([created.note.id]);
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
        title: 'Prepare the launch checklist',
        phase: 'backlog',
        priority: 'high',
      },
    });
    expect(result.details.delivery).toMatchObject({
      operation: 'created',
      primary: {
        kind: 'task',
        id: created.task.id,
        projectId: project.id,
        capabilities: expect.arrayContaining(['open', 'edit']),
      },
    });

    const context = parseToolJson(await tool.execute('call-task-context', {
      mode: 'task',
      command: 'add_context',
      args: {
        taskId: created.task.id,
        targetKind: 'file',
        targetId: '/workspace/launch.md',
        role: 'input',
        title: 'Launch plan',
        pinned: true,
      },
    }));
    expect(context).toMatchObject({
      ok: true,
      edge: {
        taskId: created.task.id,
        targetKind: 'file',
        targetId: '/workspace/launch.md',
        role: 'input',
        pinned: true,
      },
    });

    const detail = parseToolJson(await tool.execute('call-task-with-context', {
      mode: 'task',
      command: 'get',
      args: { taskId: created.task.id },
    }));
    expect(detail.context).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: context.edge.id, title: 'Launch plan' }),
    ]));
  });

  it('previews and permanently deletes an idle task', async () => {
    const dispatchTaskEvents = vi.fn();
    const tool = createXopcUseTool({
      getCurrentAgentId: () => 'main',
      getCurrentSessionKey: () => SESSION_KEY,
      dispatchTaskEvents,
    });
    const created = parseToolJson(await tool.execute('call-task-delete-create', {
      mode: 'task',
      command: 'create',
      args: { objective: 'Delete this captured Task' },
    }));
    const taskId = created.task.id as string;

    const preview = parseToolJson(await tool.execute('call-task-delete-preview', {
      mode: 'task',
      command: 'delete',
      dryRun: true,
      args: { taskId },
    }));
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      action: 'delete_task',
      taskId,
      task: { id: taskId },
    });
    dispatchTaskEvents.mockClear();

    const deletedResult = await tool.execute('call-task-delete', {
      mode: 'task',
      command: 'delete',
      args: { taskId },
    });
    expect(parseToolJson(deletedResult)).toEqual({ ok: true, removed: true, taskId });
    expect(deletedResult.details.delivery).toBeUndefined();
    expect(dispatchTaskEvents).toHaveBeenCalledOnce();

    const missing = parseToolJson(await tool.execute('call-task-delete-get', {
      mode: 'task',
      command: 'get',
      args: { taskId },
    }));
    expect(missing).toEqual({ ok: false, error: `Task not found: ${taskId}` });
  });

  it('cancels a TaskRun with optimistic concurrency and records a receipt', async () => {
    const tool = createXopcUseTool({
      getCurrentAgentId: () => 'main',
      getCurrentSessionKey: () => SESSION_KEY,
      dispatchTaskRuns: vi.fn(),
    });
    const started = parseToolJson(await tool.execute('call-start-for-cancel', {
      mode: 'task',
      command: 'create',
      args: { objective: 'Prepare a disposable draft', createMode: 'start' },
    }));
    const before = parseToolJson(await tool.execute('call-read-before-cancel', {
      mode: 'task_run',
      command: 'get',
      args: { runId: started.runId },
    }));

    const cancelledResult = await tool.execute('call-cancel-run', {
      mode: 'task_run',
      command: 'cancel',
      args: {
        runId: started.runId,
        expectedVersion: before.run.version,
        reason: 'The user no longer needs the draft',
      },
    });
    const cancelled = parseToolJson(cancelledResult);

    expect(cancelled).toMatchObject({
      ok: true,
      run: { id: started.runId, status: 'cancelled' },
      receipt: {
        status: 'cancelled',
        summary: 'The user no longer needs the draft',
        completionVerdict: 'not_achieved',
      },
    });
    expect(cancelledResult.details.delivery).toMatchObject({
      operation: 'updated',
      primary: { kind: 'task', id: started.task.id, status: 'cancelled' },
    });
  });

  it('starts a task and adds a wait through typed commands', async () => {
    const dispatchTaskRuns = vi.fn();
    const tool = createXopcUseTool({
      getCurrentAgentId: () => 'main',
      getCurrentSessionKey: () => SESSION_KEY,
      dispatchTaskRuns,
    });

    const startedResult = await tool.execute('call-task-start', {
      mode: 'task',
      command: 'create',
      args: { objective: 'Run the launch review', createMode: 'start' },
    });
    const started = parseToolJson(startedResult);

    expect(started.task.phase).toBe('active');
    expect(started.operationalState).toBe('queued');
    expect(started.runId).toBeTypeOf('string');
    expect(dispatchTaskRuns).toHaveBeenCalledOnce();

    const paused = parseToolJson(await tool.execute('call-task-pause', {
      mode: 'task',
      command: 'command',
      args: {
        taskId: started.task.id,
        type: 'add_wait',
        expectedVersion: started.task.version,
        commandArgs: { wait: { kind: 'paused', reason: 'Pause', condition: {} } },
      },
    }));

    expect(paused).toMatchObject({
      ok: true,
      command: { type: 'add_wait' },
      task: { phase: 'active' },
      operationalState: 'waiting',
    });

    const taskDetail = parseToolJson(await tool.execute('call-task-detail', {
      mode: 'task',
      command: 'get',
      args: { taskId: started.task.id },
    }));
    expect(taskDetail.model).toMatchObject({ operationalState: 'waiting' });

    const runList = parseToolJson(await tool.execute('call-task-runs', {
      mode: 'task_run',
      command: 'list',
      args: { taskId: started.task.id },
    }));
    expect(runList).toMatchObject({
      ok: true,
      items: [expect.objectContaining({ id: started.runId, taskId: started.task.id })],
      activeWaits: [expect.objectContaining({ kind: 'paused' })],
    });

    const runDetail = parseToolJson(await tool.execute('call-task-run', {
      mode: 'task_run',
      command: 'get',
      args: { runId: started.runId },
    }));
    expect(runDetail).toMatchObject({
      ok: true,
      run: { id: started.runId, taskId: started.task.id },
      activeWaits: [expect.objectContaining({ kind: 'paused' })],
    });
    expect(runDetail.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'task_run.wait_created' }),
    ]));
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
        expectedVersion: task.version,
      },
    }));

    expect(updated).toMatchObject({
      ok: true,
      dependencies: [{ id: dependency.id, phase: 'backlog' }],
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
