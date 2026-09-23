import { requireXopcDatabase as openFixtureDatabase } from '../../../storage/sqlite/connection.js';
import { ensureSessionRecord as ensureFixtureConversation } from '../../../storage/sqlite/session-repository.js';
function seedConversationFixtures(): void {
  openFixtureDatabase();
  ensureFixtureConversation("d2727fdb-ecad-4efa-86e1-46af39a71a2c", '', {"agentId":"main","sourceChannel":"tui","sourceChatId":"xopc-use","sessionType":"chat","routing":{"agentId":"main","source":"tui","accountId":"default","peerKind":"direct","peerId":"xopc-use"}});
}
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
import { ChatPreviewService } from '../../../chat-previews/index.js';
import { createXopcUseTool } from '../xopc-use-tool.js';
import { createProductDispatcher } from '../../../capabilities/runtime/product.js';

const CONVERSATION_ID = "d2727fdb-ecad-4efa-86e1-46af39a71a2c";

function parseToolJson(result: Awaited<ReturnType<ReturnType<typeof createXopcUseTool>['execute']>>) {
  const text = result.content[0]?.type === 'text' ? result.content[0].text : '{}';
  return JSON.parse(text.split('\nOpen in xopc:')[0].split('\nxopc-product-delivery:')[0]) as Record<string, any>;
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
    ensureSessionRecord(CONVERSATION_ID, stateDir, { agentId: "main" });
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

  it('executes a granted Local App write through the Agent boundary with stable replay and revocation', async () => {
    const dispatcher = createProductDispatcher(() => notes);
    const descriptor = dispatcher.describe('xopc.notes.create', { principalId: 'agent:main', scopes: ['gateway.admin'], surface: 'extension', authorize: () => true });
    const binding = { id: descriptor.id, majorVersion: descriptor.majorVersion, descriptorDigest: descriptor.descriptorDigest };
    const access = vi.fn(() => ({ releaseId: 'release', bindings: [binding] }));
    const tool = createXopcUseTool({ getNotesService: () => notes, getLocalAppService: () => ({ getCapabilityAccess: access,
      getUiGrant: () => ({ manifestDigest: 'b'.repeat(64) }) }) as unknown as LocalAppService });
    const discovered = parseToolJson(await tool.execute('discover', { mode: 'local_app', command: 'capabilities', args: { extensionId: 'fixture' } }));
    expect(discovered.manifestDigest).toBe('b'.repeat(64));
    expect(discovered.capabilities[0].id).toBe('xopc.notes.create');
    const input = { mode: 'local_app' as const, command: 'invoke', args: { extensionId: 'fixture', manifestDigest: 'b'.repeat(64),
      capabilityId: binding.id, call: { ...binding, input: { title: 'Local App note' }, idempotencyKey: 'intent' } } };
    const { id: _id, ...call } = input.args.call;
    const request = { ...input, args: { ...input.args, call } };
    const first = parseToolJson(await tool.execute('call-one', request));
    const second = parseToolJson(await tool.execute('call-two', request));
    expect(first).toMatchObject({ status: 'succeeded', data: { note: { title: 'Local App note' } } });
    expect(second).toEqual(first);
    expect((await notes.listNotes({})).items.filter(note => note.title === 'Local App note')).toHaveLength(1);
    access.mockImplementation(() => { throw new Error('Grant revoked'); });
    await expect(tool.execute('call-three', request)).rejects.toThrow('Grant revoked');
  });

  it('creates and updates a project through one entry point', async () => {
    seedConversationFixtures();
    const tool = createXopcUseTool({
      getCurrentAgentId: () => 'main',
      getProjectService: () => projects,
      getCurrentConversationId: () => CONVERSATION_ID,
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
      version: 2,
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
      actor: { kind: 'agent', agentId: 'main', conversationId: CONVERSATION_ID },
      initiator: { kind: 'user', conversationId: CONVERSATION_ID },
      source: { kind: 'xopc_use', toolCallId: 'call-2' },
    });
  });

  it('creates and lists automations in the current session project', async () => {
    seedConversationFixtures();
    const project = projects.create({ name: 'Automation Project' });
    const otherProject = projects.create({ name: 'Other Automation Project' });
    patchSessionMetadata(CONVERSATION_ID, { projectId: project.id });
    const tool = createXopcUseTool({
      getAutomationService: () => automations,
      getProjectService: () => projects,
      getCurrentConversationId: () => CONVERSATION_ID,
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
    expect(missingProject).toEqual({ ok: false, error: 'Project not found', code: 'NOT_FOUND' });
  });

  it('deletes an automation without delivering a stale product link', async () => {
    seedConversationFixtures();
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
    seedConversationFixtures();
    const workspaceRoot = mkdtempSync(join(stateDir, 'workspace-'));
    const project = projects.create({ name: 'Workspace Project', workspaceRoot });
    const tool = createXopcUseTool({
      getProjectService: () => projects,
      getCurrentConversationId: () => CONVERSATION_ID,
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
    seedConversationFixtures();
    const tool = createXopcUseTool({
      getCurrentAgentId: () => 'main',
      getCurrentConversationId: () => CONVERSATION_ID,
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
    seedConversationFixtures();
    const workspaceRoot = mkdtempSync(join(stateDir, 'workspace-'));
    const tool = createXopcUseTool({
      getProjectService: () => projects,
      getCurrentConversationId: () => CONVERSATION_ID,
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
    seedConversationFixtures();
    const tool = createXopcUseTool({
      getNotesService: () => notes,
      getCurrentConversationId: () => CONVERSATION_ID,
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
    seedConversationFixtures();
    const note = await notes.createNote({
      title: 'Disposable',
      markdown: 'Remove this note.',
      capturedVia: { channel: 'web' },
    });
    const tool = createXopcUseTool({
      getNotesService: () => notes,
      getCurrentConversationId: () => CONVERSATION_ID,
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
      args: { noteId: note.id, expectedRevision: note.remoteVersion ?? 1, idempotencyKey: 'delete-note' },
    });
    expect(parseToolJson(deletedResult)).toEqual({ ok: true, removed: true, noteId: note.id, revokedShares: 0 });
    expect(deletedResult.details.delivery).toBeUndefined();
    expect(await notes.getNote(note.id)).toBeNull();
    expect(parseToolJson(await tool.execute('call-note-delete-retry', {
      mode: 'note', command: 'delete', args: { noteId: note.id, expectedRevision: note.remoteVersion ?? 1, idempotencyKey: 'delete-note' },
    }))).toEqual(parseToolJson(deletedResult));

    const missing = parseToolJson(await tool.execute('call-note-delete-missing', {
      mode: 'note',
      command: 'delete',
      args: { noteId: note.id },
    }));
    expect(missing).toEqual({ ok: false, error: `Note not found: ${note.id}` });
  });

  it('creates and lists notes in the current session project', async () => {
    seedConversationFixtures();
    const project = projects.create({ name: 'Project Notes' });
    const otherProject = projects.create({ name: 'Other Notes' });
    patchSessionMetadata(CONVERSATION_ID, { projectId: project.id });
    const tool = createXopcUseTool({
      getNotesService: () => notes,
      getProjectService: () => projects,
      getCurrentConversationId: () => CONVERSATION_ID,
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
    seedConversationFixtures();
    const note = await notes.createNote({
      title: 'Preview',
      markdown: 'First line\nSecond line',
      capturedVia: { channel: 'web' },
    });
    const tool = createXopcUseTool({
      getNotesService: () => notes,
      getCurrentConversationId: () => CONVERSATION_ID,
    });

    const previewResult = await tool.execute('call-1', {
      mode: 'note',
      command: 'preview_edit',
      args: { noteId: note.id, instruction: '生成摘要' },
    });
    const result = parseToolJson(previewResult);
    expect(previewResult.details.delivery).toMatchObject({ presentation: { kind: 'diff', truncated: false,
      edits: [{ text: expect.stringContaining('[!SUMMARY]') }] } });
    const listed = await tool.execute('table', { mode: 'note', command: 'list', args: {} });
    expect(listed.details.delivery).toMatchObject({ presentation: { kind: 'table',
      items: [{ id: note.id, capabilities: ['open'] }], truncated: false } });

    const unchanged = await notes.getNote(note.id);
    expect(result.ok).toBe(true);
    expect(result.patch.operations[0].type).toBe('replaceRange');
    expect(result.patch.operations[0].markdown).toContain('[!SUMMARY]');
    expect(unchanged?.markdown).toBe('First line\nSecond line');
    const snapshot = { version: 1, clientInstanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      tabId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sequence: 1, surface: 'web', capturedAt: 1,
      resourceRefs: [{ kind: 'note', id: note.id, revision: String(note.remoteVersion ?? 1) }],
    };
    const context = parseToolJson(await tool.execute('context', { mode: 'context', command: 'resolve', args: snapshot }));
    expect(context.resources[0]).toMatchObject({ text: note.markdown, truncated: false });
    const denied = createXopcUseTool({ getNotesService: () => notes, authorizeCapability: id => id !== 'xopc.notes.get' });
    await expect(denied.execute('context-denied', { mode: 'context', command: 'resolve', args: snapshot }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('does not mutate on dryRun', async () => {
    seedConversationFixtures();
    const tool = createXopcUseTool({
      getProjectService: () => projects,
      getCurrentConversationId: () => CONVERSATION_ID,
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
    seedConversationFixtures();
    const project = projects.create({ name: 'Task Project' });
    const tool = createXopcUseTool({
      getCurrentAgentId: () => 'main',
      getCurrentConversationId: () => CONVERSATION_ID,
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
    seedConversationFixtures();
    const dispatchTaskEvents = vi.fn();
    const tool = createXopcUseTool({
      getCurrentAgentId: () => 'main',
      getCurrentConversationId: () => CONVERSATION_ID,
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

    await expect(tool.execute('call-task-delete-get', {
      mode: 'task',
      command: 'get',
      args: { taskId },
    })).rejects.toMatchObject({ code: 'NOT_FOUND', message: `Task not found: ${taskId}` });
  });

  it('cancels a TaskRun with optimistic concurrency and records a receipt', async () => {
    seedConversationFixtures();
    const tool = createXopcUseTool({
      getCurrentAgentId: () => 'main',
      getCurrentConversationId: () => CONVERSATION_ID,
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
    seedConversationFixtures();
    const dispatchTaskRuns = vi.fn();
    const tool = createXopcUseTool({
      getCurrentAgentId: () => 'main',
      getCurrentConversationId: () => CONVERSATION_ID,
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
    seedConversationFixtures();
    const tool = createXopcUseTool({
      getCurrentAgentId: () => 'main',
      getCurrentConversationId: () => CONVERSATION_ID,
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
    seedConversationFixtures();
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
      materializeSnapshot: () => ({ sourceHash: 'a'.repeat(64), status: 'ready' }),
    } as unknown as LocalAppService;
    const tool = createXopcUseTool({
      getLocalAppService: () => localApps,
      getCurrentConversationId: () => CONVERSATION_ID,
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
        revision: 'a'.repeat(64),
      },
      presentation: {
        kind: 'inline_app',
        preferredHeight: 480,
        reference: { kind: 'local_app', id: app.id },
        snapshot: { sourceHash: 'a'.repeat(64) },
      },
    });
  });

  it('creates a lightweight chat preview without creating a project', async () => {
    seedConversationFixtures();
    const previews = new ChatPreviewService();
    const tool = createXopcUseTool({
      getChatPreviewService: () => previews,
      getCurrentConversationId: () => CONVERSATION_ID,
    });

    const result = await tool.execute('call-chat-preview', {
      mode: 'chat_preview',
      command: 'create',
      args: {
        title: 'Login page',
        markup: '<main>Sign in</main>',
        styles: 'main { padding: 24px; }',
        script: '',
        preferredHeight: 420,
      },
    });

    expect(result.details.delivery).toMatchObject({
      version: 2,
      operation: 'created',
      primary: { kind: 'chat_preview', title: 'Login page' },
      presentation: {
        kind: 'inline_preview',
        preferredHeight: 420,
        reference: { kind: 'chat_preview' },
      },
    });
    expect(projects.list().items).toHaveLength(0);
  });

  it('returns an exact settings jump target without changing config', async () => {
    seedConversationFixtures();
    const tool = createXopcUseTool({
      getProjectService: () => projects,
      getCurrentConversationId: () => CONVERSATION_ID,
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
