import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NotesService } from '../../notes/service.js';
import { ProjectService } from '../../projects/project-service.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { WorkItemService } from '../../work-items/work-item-service.js';
import { ActivityService } from '../service.js';

describe('domain activity integration', () => {
  let stateDir: string;
  let activity: ActivityService;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-domain-activity-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    activity = new ActivityService();
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('records project create and status update activity with stable project scope', () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Activity Project', brief: 'Activity rollout' });
    projects.update(project.id, { status: 'paused' });

    const page = activity.listForProject({ projectId: project.id });
    expect(page.items.map((item) => item.type).sort()).toEqual(['project.created', 'project.status_changed']);
    expect(page.items.find((item) => item.type === 'project.status_changed')?.payload)
      .toMatchObject({ from: 'active', to: 'paused' });
    expect(page.items.every((item) => item.scopes.some((scope) => scope.scopeKind === 'project' && scope.scopeId === project.id))).toBe(true);
  });

  it('records note create and update activity without requiring a project scope', async () => {
    const notes = new NotesService();
    const note = await notes.createNote({
      markdown: 'Activity note body',
      capturedVia: { channel: 'web' },
    });
    await notes.updateNote(note.id, { markdown: 'Updated activity note body' });

    const page = activity.listForObject({ object: { kind: 'note', id: note.id } });
    expect(page.items.map((item) => item.type)).toEqual(['note.updated', 'note.created']);
    expect(page.items[1]?.payload).toMatchObject({
      kind: 'thought',
      contentPreview: 'Activity note body',
      contentLength: 18,
    });
    expect(page.items.flatMap((item) => item.scopes)).toEqual([]);
  });

  it('records work item activity in the owning project timeline', () => {
    const projects = new ProjectService();
    const workItems = new WorkItemService();
    const project = projects.create({ name: 'Work Item Activity' });
    const item = workItems.createProjectWorkItem(project.id, {
      title: 'Implement activity timeline',
      status: 'todo',
      priority: 'high',
    });
    workItems.updateWorkItem(item.id, { status: 'in_progress' });
    workItems.addLink(item.id, { kind: 'note', targetId: 'note-1', title: 'Research note' });

    const page = activity.listForProject({ projectId: project.id });
    expect(page.items.map((activityItem) => activityItem.type).sort()).toEqual([
      'project.created',
      'work_item.created',
      'work_item.link_added',
      'work_item.status_changed',
    ]);
    expect(page.items.find((activityItem) => activityItem.type === 'work_item.status_changed')?.payload)
      .toMatchObject({ from: 'todo', to: 'in_progress' });
    expect(page.items.find((activityItem) => activityItem.type === 'work_item.link_added')?.payload).toMatchObject({
      target: { kind: 'note', id: 'note-1', title: 'Research note' },
    });
  });
});
