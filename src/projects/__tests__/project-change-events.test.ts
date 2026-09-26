import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DomainOutboxDispatcher } from '../../infra/domain-outbox-dispatcher.js';
import { listAutomationEvents } from '../../automations/events/index.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { ProjectService } from '../project-service.js';

describe('project lifecycle resource events', () => {
  let directory: string;
  let projects: ProjectService;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'xopc-project-events-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(directory, 'xopc.db') });
    projects = new ProjectService();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(directory, { recursive: true, force: true });
  });

  function events() {
    return getSqliteDatabase().prepare("SELECT event_type, payload_json FROM domain_outbox WHERE subject_kind = 'project' ORDER BY rowid").all()
      .map(row => ({ type: row.event_type, ...JSON.parse(String(row.payload_json)) }));
  }
  function failEventWrites() {
    getSqliteDatabase().exec(`CREATE TRIGGER reject_project_event BEFORE INSERT ON domain_outbox
      WHEN NEW.subject_kind = 'project' BEGIN SELECT RAISE(ABORT, 'event failure'); END`);
  }

  it('persists create, edit, pin and delete with monotonic versions; repeated deletion emits nothing', () => {
    const project = projects.create({ name: 'Lifecycle' });
    projects.update(project.id, { name: 'Renamed' });
    projects.pin(project.id);
    projects.unpin(project.id);
    projects.delete(project.id);
    projects.delete(project.id);
    expect(events()).toEqual([
      { type: 'project.created', projectId: project.id, version: 1, changedFields: [] },
      { type: 'project.changed', projectId: project.id, version: 2, changedFields: ['name'] },
      { type: 'project.changed', projectId: project.id, version: 3, changedFields: ['pinnedAt'] },
      { type: 'project.changed', projectId: project.id, version: 4, changedFields: ['pinnedAt'] },
      { type: 'project.deleted', projectId: project.id, version: 5, changedFields: [] },
    ]);
  });

  it('rolls creation and its search index back when the event cannot be persisted', () => {
    failEventWrites();
    expect(() => projects.create({ name: 'Rollback create' })).toThrow('event failure');
    expect(projects.list().total).toBe(0);
    expect(projects.list({ search: 'Rollback' }).total).toBe(0);
    expect(events()).toEqual([]);
  });

  it('rolls update and deletion back with their version, search index and associations', () => {
    const project = projects.create({ name: 'Original' });
    const milestone = projects.createMilestone(project.id, { title: 'Ship' });
    const before = projects.get(project.id);
    const beforeEvents = events();
    failEventWrites();
    expect(() => projects.update(project.id, { name: 'Changed' })).toThrow('event failure');
    expect(() => projects.delete(project.id)).toThrow('event failure');
    expect(projects.get(project.id)).toEqual(before);
    expect(projects.list({ search: 'Original' }).total).toBe(1);
    expect(projects.list({ search: 'Changed' }).total).toBe(0);
    expect(projects.listMilestones(project.id)).toEqual([milestone]);
    expect(events()).toEqual(beforeEvents);
  });

  it('does not create directories for a missing project or remove workspace files on deletion', () => {
    const workspaceRoot = join(directory, 'workspace');
    expect(() => projects.update('missing', { workspaceRoot, createWorkspaceRoot: true })).toThrow('Project not found');
    expect(existsSync(workspaceRoot)).toBe(false);
    expect(events()).toEqual([]);
    const project = projects.create({ name: 'Workspace', workspaceRoot, createWorkspaceRoot: true });
    const file = join(workspaceRoot, 'keep.txt');
    writeFileSync(file, 'user content');
    projects.delete(project.id);
    expect(existsSync(file)).toBe(true);
  });

  it('recovers pending events after reopening the database and does not republish acknowledged events', () => {
    const project = projects.create({ name: 'Recovery' });
    getSqliteDatabase().exec(`CREATE TRIGGER reject_automation_event BEFORE INSERT ON automation_events
      BEGIN SELECT RAISE(ABORT, 'offline'); END`);
    expect(new DomainOutboxDispatcher().drain(100, 'project')).toBe(0);
    getSqliteDatabase().exec('DROP TRIGGER reject_automation_event');
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(directory, 'xopc.db') });
    const dispatcher = new DomainOutboxDispatcher();
    expect(dispatcher.drain(100, 'project')).toBe(1);
    expect(dispatcher.drain(100, 'project')).toBe(0);
    expect(listAutomationEvents({ source: 'projects' })).toContainEqual(expect.objectContaining({
      type: 'project.created', source: 'projects', payload: expect.objectContaining({ projectId: project.id, version: 1 }),
    }));
  });
});
