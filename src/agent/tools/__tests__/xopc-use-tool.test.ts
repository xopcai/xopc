import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ActivityService } from '../../../activity/index.js';
import { NotesService, NotesStore } from '../../../notes/index.js';
import { ProjectService } from '../../../projects/index.js';
import {
  closeXopcDatabase,
  ensureSessionRecord,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../storage/sqlite/index.js';
import { WorkItemService } from '../../../work-items/index.js';
import { createXopcUseTool } from '../xopc-use-tool.js';

const SESSION_KEY = 'agent:main:tui:xopc-use';

function parseToolJson(result: Awaited<ReturnType<ReturnType<typeof createXopcUseTool>['execute']>>) {
  const text = result.content[0]?.type === 'text' ? result.content[0].text : '{}';
  return JSON.parse(text) as Record<string, any>;
}

describe('xopc_use tool', () => {
  let stateDir: string;
  let projects: ProjectService;
  let notes: NotesService;
  let workItems: WorkItemService;
  let activity: ActivityService;

  beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-use-tool-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    ensureSessionRecord(SESSION_KEY, stateDir);
    projects = new ProjectService();
    notes = new NotesService(new NotesStore());
    await notes.initialize();
    workItems = new WorkItemService();
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

  it('creates a work item using the current session project binding', async () => {
    const project = projects.create({ name: 'Bound Project' });
    projects.attachSession(SESSION_KEY, project.id);
    const tool = createXopcUseTool({
      getProjectService: () => projects,
      getWorkItemService: () => workItems,
      getCurrentSessionKey: () => SESSION_KEY,
    });

    const created = parseToolJson(await tool.execute('call-1', {
      mode: 'work_item',
      command: 'create',
      args: { title: 'Implement xopc_use', priority: 'high' },
    }));

    expect(created.ok).toBe(true);
    expect(created.item.projectId).toBe(project.id);
    expect(created.item.title).toBe('Implement xopc_use');
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

  it('rejects invalid work item dates without creating an item', async () => {
    const project = projects.create({ name: 'Invalid Date Project' });
    const tool = createXopcUseTool({
      getWorkItemService: () => workItems,
      getCurrentSessionKey: () => SESSION_KEY,
    });

    const result = parseToolJson(await tool.execute('call-1', {
      mode: 'work_item',
      command: 'create',
      args: { projectId: project.id, title: 'Bad due date', dueAt: 'tomorrow-ish' },
    }));

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Invalid dueAt');
    expect(workItems.listProjectWorkItems(project.id).items).toHaveLength(0);
  });
});
